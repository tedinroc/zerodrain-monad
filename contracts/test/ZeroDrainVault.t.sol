// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {Test} from "forge-std/Test.sol";
import {ZeroDrainVault} from "../src/ZeroDrainVault.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

contract ZeroDrainVaultTest is Test {
    ZeroDrainVault public vault;

    address public admin = address(this);
    address public sentinel = makeAddr("sentinel");
    address payable public user = payable(makeAddr("user"));
    address payable public drainer = payable(makeAddr("drainer"));

    bytes32 public constant TRUSTED_HASH =
        sha256("zerodrain-monad-staking-ui:v1.0.0:action=withdraw(self):integrity=verified");
    bytes32 public constant MALICIOUS_HASH =
        sha256("zerodrain-monad-staking-ui:v1.0.0:action=withdraw(0xDrainer):HIJACKED");

    uint256 internal constant P256_PRIV_KEY = 0x123456789abcdef123456789abcdef123456789abcdef123456789abcdef1234;
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant P256_HALF_N = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8;

    bytes32 internal pubQx;
    bytes32 internal pubQy;

    function setUp() public {
        vault = new ZeroDrainVault(sentinel, TRUSTED_HASH);
        vm.deal(user, 10 ether);

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

    function test_DepositAndNormalWithdraw() public {
        vm.startPrank(user);
        vault.deposit{value: 2 ether}();
        assertEq(vault.balances(user), 2 ether);

        vault.withdraw(user, 0.5 ether);
        assertEq(vault.balances(user), 1.5 ether);
        assertEq(user.balance, 8.5 ether);
        vm.stopPrank();
    }

    function test_TripBreakerBlocksHijackedWithdraw() public {
        vm.prank(user);
        vault.deposit{value: 2 ether}();

        vm.prank(sentinel);
        vault.tripBreaker(MALICIOUS_HASH, "SRI_MISMATCH_AND_DRAINER_DETECTED");

        assertEq(uint256(vault.mode()), uint256(ZeroDrainVault.SecurityMode.PASSKEY_ONLY));
        assertEq(vault.lastMaliciousHash(), MALICIOUS_HASH);
        assertEq(vault.tripCount(), 1);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                ZeroDrainVault.VaultInPasskeyOnlyMode.selector,
                MALICIOUS_HASH,
                block.number
            )
        );
        vault.withdraw(drainer, 2 ether);

        assertEq(drainer.balance, 0);
        assertEq(vault.balances(user), 2 ether);
    }

    function test_UnauthorizedCannotTripBreaker() public {
        bytes32 badHash = MALICIOUS_HASH;
        vm.prank(drainer);
        vm.expectRevert(ZeroDrainVault.Unauthorized.selector);
        vault.tripBreaker(badHash, "FAKE");
    }

    function test_EmergencyWithdrawWithWebAuthnOn0x0100() public {
        vm.startPrank(user);
        vault.deposit{value: 2 ether}();
        vault.registerPasskey(pubQx, pubQy);
        vm.stopPrank();

        vm.prank(sentinel);
        vault.tripBreaker(MALICIOUS_HASH, "DNS_HIJACK_DETECTED");

        uint256 deadline = block.timestamp + 300;
        uint256 nonce = vault.nonces(user);
        bytes32 challenge = vault.computeRecoveryChallenge(user, user, 1.5 ether, nonce, deadline);

        // Construct realistic WebAuthn assertion (TouchID UP + UV flags = 0x05)
        bytes memory authData = abi.encodePacked(
            sha256("zerodrain.monad.app"),
            bytes1(0x05),
            bytes4(uint32(1))
        );
        string memory challengeB64 = Base64.encodeURL(abi.encodePacked(challenge));
        string memory clientDataJSON = string.concat(
            '{"type":"webauthn.get","challenge":"',
            challengeB64,
            '","origin":"https://zerodrain.pages.dev"}'
        );

        bytes32 messageHash = sha256(abi.encodePacked(authData, sha256(bytes(clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(P256_PRIV_KEY, messageHash);
        s = _normalizeLowS(s);

        WebAuthn.WebAuthnAuth memory auth = WebAuthn.WebAuthnAuth({
            r: r,
            s: s,
            challengeIndex: 23,
            typeIndex: 1,
            authenticatorData: authData,
            clientDataJSON: clientDataJSON
        });

        uint256 balanceBefore = user.balance;
        vm.prank(user);
        vault.emergencyWithdrawWithWebAuthn(user, 1.5 ether, deadline, auth);

        assertEq(user.balance, balanceBefore + 1.5 ether);
        assertEq(vault.balances(user), 0.5 ether);
        assertEq(vault.nonces(user), 1);
        assertEq(vault.emergencyRecoveryCount(), 1);
    }

    function test_EmergencyWithdrawWithRawP256On0x0100() public {
        vm.startPrank(user);
        vault.deposit{value: 2 ether}();
        vault.registerPasskey(pubQx, pubQy);
        vm.stopPrank();

        vm.prank(sentinel);
        vault.tripBreaker(MALICIOUS_HASH, "DNS_HIJACK_DETECTED");

        uint256 deadline = block.timestamp + 300;
        bytes32 challenge = vault.computeRecoveryChallenge(user, user, 1 ether, 0, deadline);
        bytes32 digest = sha256(abi.encodePacked(challenge));

        (bytes32 r, bytes32 s) = vm.signP256(P256_PRIV_KEY, digest);
        s = _normalizeLowS(s);

        vm.prank(user);
        vault.emergencyWithdrawWithRawP256(user, 1 ether, deadline, r, s);

        assertEq(vault.balances(user), 1 ether);
        assertEq(vault.nonces(user), 1);
    }

    function test_TamperedRecipientAndReplayFail() public {
        vm.startPrank(user);
        vault.deposit{value: 2 ether}();
        vault.registerPasskey(pubQx, pubQy);
        vm.stopPrank();

        uint256 deadline = block.timestamp + 300;
        // User signed to recover to their OWN address (user)
        bytes32 challenge = vault.computeRecoveryChallenge(user, user, 1 ether, 0, deadline);
        bytes32 digest = sha256(abi.encodePacked(challenge));
        (bytes32 r, bytes32 s) = vm.signP256(P256_PRIV_KEY, digest);
        s = _normalizeLowS(s);

        // Attacker tries to substitute `drainer` as recipient with user's signature -> MUST REVERT
        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.InvalidPasskeySignature.selector);
        vault.emergencyWithdrawWithRawP256(drainer, 1 ether, deadline, r, s);

        // Legitimate call succeeds once
        vm.prank(user);
        vault.emergencyWithdrawWithRawP256(user, 1 ether, deadline, r, s);

        // Replaying the exact same signature fails because nonce incremented
        vm.prank(user);
        vm.expectRevert(ZeroDrainVault.InvalidPasskeySignature.selector);
        vault.emergencyWithdrawWithRawP256(user, 1 ether, deadline, r, s);
    }

    function test_RestoreNormalModeResetsState() public {
        vm.prank(sentinel);
        vault.tripBreaker(MALICIOUS_HASH, "TEST");
        assertEq(uint256(vault.mode()), uint256(ZeroDrainVault.SecurityMode.PASSKEY_ONLY));

        vault.restoreNormalMode(TRUSTED_HASH);
        assertEq(uint256(vault.mode()), uint256(ZeroDrainVault.SecurityMode.NORMAL));
        assertEq(vault.lastMaliciousHash(), bytes32(0));
    }

    function test_Native0x0100PrecompileActive() public view {
        assertTrue(vault.isNativeP256PrecompileActive());
    }
}
