// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {ZeroDrainVault} from "../src/ZeroDrainVault.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

contract ZeroDrainVaultTest is Test {
    ZeroDrainVault public vault;

    address public sentinel = makeAddr("sentinel");
    address payable public user = payable(makeAddr("user"));
    address payable public coldWallet = payable(makeAddr("coldWallet"));
    address payable public drainer = payable(makeAddr("drainer"));

    // Exact SHA-256 of web/public/bundles/vault-action.clean.js
    bytes32 public constant TRUSTED_HASH = 0x578f2ffb3fca186b9319a589d4f92909e77689fd2125623965d10f8fc7323207;
    // Exact SHA-256 of web/public/bundles/vault-action.hijacked.js
    bytes32 public constant MALICIOUS_HASH = 0x53b33e32d70791be49ca51e15bf99c97987c43813dab21ec2f380a6181b80805;

    uint256 internal constant P256_PRIV_KEY = 0x123456789abcdef123456789abcdef123456789abcdef123456789abcdef1234;
    uint256 internal constant ATTACKER_P256_KEY = 0x999999999abcdef123456789abcdef123456789abcdef123456789abcdef9999;
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant P256_HALF_N = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8;

    bytes32 internal pubQx;
    bytes32 internal pubQy;

    function setUp() public {
        vault = new ZeroDrainVault(sentinel, TRUSTED_HASH);
        vm.deal(user, 10 ether);
        vm.deal(drainer, 5 ether);

        (uint256 qx, uint256 qy) = vm.publicKeyP256(P256_PRIV_KEY);
        pubQx = bytes32(qx);
        pubQy = bytes32(qy);
    }

    function _normalizeLowS(bytes32 s) internal pure returns (bytes32) {
        uint256 sVal = uint256(s);
        if (sVal > P256_HALF_N) {
            return bytes32(P256_N - sVal);
        }
        return s;
    }

    function test_01_ConstructorRejectsZeroSentinel() public {
        vm.expectRevert(ZeroDrainVault.InvalidAddress.selector);
        new ZeroDrainVault(address(0), TRUSTED_HASH);
    }

    function test_02_DepositDepositForAndReceiveAccounting() public {
        vm.prank(user);
        vault.deposit{value: 1 ether}();
        assertEq(vault.balances(user), 1 ether);

        vm.prank(drainer);
        vault.depositFor{value: 0.5 ether}(user);
        assertEq(vault.balances(user), 1.5 ether);

        vm.prank(user);
        (bool sent,) = address(vault).call{value: 0.25 ether}("");
        assertTrue(sent);
        assertEq(vault.balances(user), 1.75 ether);
        assertEq(vault.totalDeposited(), 1.75 ether);
    }

    function test_03_DepositValidationReverts() public {
        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.InvalidAmount.selector);
        vault.deposit{value: 0}();

        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.InvalidAddress.selector);
        vault.depositFor{value: 1 ether}(address(0));

        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.InvalidAmount.selector);
        vault.depositFor{value: 0}(user);
    }

    function test_04_NormalWithdrawAndValidationReverts() public {
        vm.startPrank(user);
        vault.deposit{value: 2 ether}();

        vm.expectRevert(ZeroDrainVault.InvalidAddress.selector);
        vault.withdraw(payable(address(0)), 0.5 ether);

        vm.expectRevert(ZeroDrainVault.InvalidAmount.selector);
        vault.withdraw(user, 0);

        vm.expectRevert(ZeroDrainVault.InsufficientBalance.selector);
        vault.withdraw(user, 3 ether);

        vault.withdraw(user, 0.5 ether);
        assertEq(vault.balances(user), 1.5 ether);
        assertEq(user.balance, 8.5 ether);
        vm.stopPrank();
    }

    function test_05_RejectInvalidP256PublicKey() public {
        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.InvalidPublicKey.selector);
        vault.registerPasskey(bytes32(uint256(1)), bytes32(uint256(2)));
    }

    function test_06_TripBreakerBlocksHijackedWithdraw() public {
        vm.prank(user);
        vault.deposit{value: 2 ether}();

        vm.prank(sentinel);
        vault.tripBreaker(MALICIOUS_HASH, "SRI_MISMATCH_AND_DRAINER_DETECTED");

        assertEq(uint256(vault.mode()), uint256(ZeroDrainVault.SecurityMode.PASSKEY_ONLY));

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(ZeroDrainVault.VaultInPasskeyOnlyMode.selector, MALICIOUS_HASH, block.number)
        );
        vault.withdraw(drainer, 2 ether);

        assertEq(drainer.balance, 5 ether);
        assertEq(vault.balances(user), 2 ether);
    }

    function test_07_CannotOverwritePasskeyOrRecoveryDuringBreaker() public {
        vm.startPrank(user);
        vault.deposit{value: 2 ether}();
        vault.registerPasskey(pubQx, pubQy);
        vm.stopPrank();

        vm.prank(sentinel);
        vault.tripBreaker(MALICIOUS_HASH, "HIJACK");

        (uint256 attQx, uint256 attQy) = vm.publicKeyP256(ATTACKER_P256_KEY);

        // Hijacked UI attempts to trick victim into overwriting Passkey mid-incident -> MUST REVERT
        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.PasskeyLockedDuringBreaker.selector);
        vault.registerPasskey(bytes32(attQx), bytes32(attQy));

        // Hijacked UI attempts to swap recoveryAddress to drainer mid-incident -> MUST REVERT
        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.RecoveryAddressLockedDuringBreaker.selector);
        vault.setRecoveryAddress(drainer);
    }

    function test_08_UnauthorizedCannotTripOrRestoreBreaker() public {
        vm.prank(drainer);
        vm.expectRevert(ZeroDrainVault.Unauthorized.selector);
        vault.tripBreaker(MALICIOUS_HASH, "FAKE");

        vm.prank(sentinel);
        vault.tripBreaker(MALICIOUS_HASH, "REAL");

        // Sentinel cannot unilaterally restore NORMAL mode; only admin can
        vm.prank(sentinel);
        vm.expectRevert(ZeroDrainVault.Unauthorized.selector);
        vault.restoreNormalMode(TRUSTED_HASH);

        vm.prank(drainer);
        vm.expectRevert(ZeroDrainVault.Unauthorized.selector);
        vault.restoreNormalMode(TRUSTED_HASH);
    }

    function test_09_EmergencyWithdrawWithWebAuthnOn0x0100PaysSelfOnly() public {
        vm.startPrank(user);
        vault.deposit{value: 2 ether}();
        vault.registerPasskey(pubQx, pubQy);
        vm.stopPrank();

        vm.prank(sentinel);
        vault.tripBreaker(MALICIOUS_HASH, "DNS_HIJACK_DETECTED");

        uint256 deadline = block.timestamp + 300;
        uint256 nonce = vault.nonces(user);
        bytes32 challenge = vault.computeRecoveryChallenge(user, 1.5 ether, nonce, deadline);

        bytes memory authData = abi.encodePacked(sha256("zerodrain-monad.pages.dev"), bytes1(0x05), bytes4(uint32(1)));
        string memory challengeB64 = Base64.encodeURL(abi.encodePacked(challenge));
        string memory clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"', challengeB64, '","origin":"https://zerodrain-monad.pages.dev"}'
        );

        bytes32 messageHash = sha256(abi.encodePacked(authData, sha256(bytes(clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(P256_PRIV_KEY, messageHash);
        s = _normalizeLowS(s);

        WebAuthn.WebAuthnAuth memory auth = WebAuthn.WebAuthnAuth({
            r: r, s: s, challengeIndex: 23, typeIndex: 1, authenticatorData: authData, clientDataJSON: clientDataJSON
        });

        uint256 balanceBefore = user.balance;
        vm.prank(user);
        vault.emergencyWithdrawWithWebAuthn(1.5 ether, deadline, auth);

        assertEq(user.balance, balanceBefore + 1.5 ether);
        assertEq(vault.balances(user), 0.5 ether);
        assertEq(vault.nonces(user), 1);
    }

    function test_10_PreBoundColdRecoveryAddressPaidOnEscape() public {
        vm.startPrank(user);
        vault.deposit{value: 2 ether}();
        vault.registerPasskey(pubQx, pubQy);
        vault.setRecoveryAddress(coldWallet);
        vm.stopPrank();

        assertEq(vault.getLockedRecoveryAddress(user), coldWallet);

        vm.prank(sentinel);
        vault.tripBreaker(MALICIOUS_HASH, "DNS_HIJACK_DETECTED");

        uint256 deadline = block.timestamp + 300;
        bytes32 challenge = vault.computeRecoveryChallenge(user, 1 ether, 0, deadline);
        bytes32 digest = sha256(abi.encodePacked(challenge));
        (bytes32 r, bytes32 s) = vm.signP256(P256_PRIV_KEY, digest);
        s = _normalizeLowS(s);

        vm.prank(user);
        vault.emergencyWithdrawWithRawP256(1 ether, deadline, r, s);

        assertEq(coldWallet.balance, 1 ether);
        assertEq(vault.balances(user), 1 ether);
    }

    function test_11_TamperedAmountAndReplayFail() public {
        vm.startPrank(user);
        vault.deposit{value: 2 ether}();
        vault.registerPasskey(pubQx, pubQy);
        vm.stopPrank();

        uint256 deadline = block.timestamp + 300;
        bytes32 challenge = vault.computeRecoveryChallenge(user, 1 ether, 0, deadline);
        bytes32 digest = sha256(abi.encodePacked(challenge));
        (bytes32 r, bytes32 s) = vm.signP256(P256_PRIV_KEY, digest);
        s = _normalizeLowS(s);

        // Tampered amount must fail
        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.InvalidPasskeySignature.selector);
        vault.emergencyWithdrawWithRawP256(2 ether, deadline, r, s);

        // Legitimate call succeeds once
        vm.prank(user);
        vault.emergencyWithdrawWithRawP256(1 ether, deadline, r, s);

        // Replay must fail because nonce incremented
        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.InvalidPasskeySignature.selector);
        vault.emergencyWithdrawWithRawP256(1 ether, deadline, r, s);
    }

    function test_12_ExpiredSignatureReverts() public {
        vm.startPrank(user);
        vault.deposit{value: 1 ether}();
        vault.registerPasskey(pubQx, pubQy);
        vm.stopPrank();

        uint256 pastDeadline = block.timestamp - 1;
        bytes32 challenge = vault.computeRecoveryChallenge(user, 0.5 ether, 0, pastDeadline);
        bytes32 digest = sha256(abi.encodePacked(challenge));
        (bytes32 r, bytes32 s) = vm.signP256(P256_PRIV_KEY, digest);
        s = _normalizeLowS(s);

        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.SignatureExpired.selector);
        vault.emergencyWithdrawWithRawP256(0.5 ether, pastDeadline, r, s);
    }

    function test_13_WrongPasskeySignerAndUnregisteredUserRevert() public {
        vm.prank(user);
        vault.deposit{value: 1 ether}();

        uint256 deadline = block.timestamp + 300;
        bytes32 challenge = vault.computeRecoveryChallenge(user, 0.5 ether, 0, deadline);
        bytes32 digest = sha256(abi.encodePacked(challenge));
        (bytes32 r, bytes32 s) = vm.signP256(ATTACKER_P256_KEY, digest);
        s = _normalizeLowS(s);

        // Before registering any Passkey -> PasskeyNotRegistered
        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.PasskeyNotRegistered.selector);
        vault.emergencyWithdrawWithRawP256(0.5 ether, deadline, r, s);

        // After registering user's real Passkey -> attacker's P-256 signature must revert
        vm.prank(user);
        vault.registerPasskey(pubQx, pubQy);

        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.InvalidPasskeySignature.selector);
        vault.emergencyWithdrawWithRawP256(0.5 ether, deadline, r, s);
    }

    function test_14_RestoreNormalModeResetsStateAndTelemetry() public {
        vm.prank(sentinel);
        vault.tripBreaker(MALICIOUS_HASH, "TEST_REASON");

        (
            ZeroDrainVault.SecurityMode currentMode,
            bytes32 trustedHash,
            bytes32 maliciousHash,
            uint256 trippedBlock,,
            string memory reason,
            uint256 trips,,
        ) = vault.getVaultStatus();

        assertEq(uint256(currentMode), uint256(ZeroDrainVault.SecurityMode.PASSKEY_ONLY));
        assertEq(trustedHash, TRUSTED_HASH);
        assertEq(maliciousHash, MALICIOUS_HASH);
        assertEq(trippedBlock, block.number);
        assertEq(reason, "TEST_REASON");
        assertEq(trips, 1);

        vault.restoreNormalMode(TRUSTED_HASH);
        assertEq(uint256(vault.mode()), uint256(ZeroDrainVault.SecurityMode.NORMAL));
        assertEq(vault.lastMaliciousHash(), bytes32(0));
        assertEq(bytes(vault.tripReason()).length, 0);
    }

    function test_15_Native0x0100PrecompileActive() public view {
        assertTrue(vault.isNativeP256PrecompileActive());
    }
}
