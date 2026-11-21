// SPDX-License-Identifier: MIT
pragma solidity ^0.8.31;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ZeroDrainVault
 * @notice Monad-native DeFi vault hardened against frontend/DNS hijacking:
 *         1) Sub-second on-chain circuit breaker degrading NORMAL -> PASSKEY_ONLY (never freezing funds).
 *         2) Passkey & recovery-address mutations are strictly frozen during PASSKEY_ONLY incidents
 *            so a compromised UI cannot trick users into overwriting their hardware key.
 *         3) Hardware escape (EIP-7951 0x0100) removes arbitrary frontend-supplied payout targets and
 *            pays strictly to msg.sender or a recovery address pre-bound during NORMAL mode,
 *            neutralizing pre-signing WYSIWYS recipient tampering.
 * @dev In production, `admin` should be a Safe Multisig + Timelock contract rather than a single EOA.
 */
contract ZeroDrainVault is ReentrancyGuard {
    enum SecurityMode {
        NORMAL,
        PASSKEY_ONLY
    }

    struct Passkey {
        bytes32 qx;
        bytes32 qy;
        bool registered;
    }

    bytes32 public constant RECOVERY_DOMAIN = keccak256("ZERODRAIN_RECOVERY_V2");

    address public admin;
    address public sentinel;
    SecurityMode public mode;

    bytes32 public trustedFrontendHash;
    bytes32 public lastMaliciousHash;
    uint256 public trippedAtBlock;
    uint256 public trippedAtTime;
    string public tripReason;

    uint256 public tripCount;
    uint256 public emergencyRecoveryCount;
    uint256 public totalDeposited;

    mapping(address => uint256) public balances;
    mapping(address => Passkey) public passkeys;
    mapping(address => address payable) public recoveryAddresses;
    mapping(address => uint256) public nonces;

    error Unauthorized();
    error InvalidAddress();
    error InvalidAmount();
    error InsufficientBalance();
    error InvalidPublicKey();
    error PasskeyNotRegistered();
    error PasskeyLockedDuringBreaker();
    error RecoveryAddressLockedDuringBreaker();
    error SignatureExpired();
    error InvalidPasskeySignature();
    error TransferFailed();
    error VaultInPasskeyOnlyMode(bytes32 maliciousHash, uint256 trippedBlock);

    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event PasskeyRegistered(address indexed user, bytes32 qx, bytes32 qy);
    event RecoveryAddressUpdated(address indexed user, address indexed recoveryAddress);
    event Withdrawn(address indexed user, address indexed recipient, uint256 amount);
    event BreakerTripped(
        address indexed triggeredBy, bytes32 indexed detectedHash, uint256 blockNumber, uint256 timestamp, string reason
    );
    event ModeRestored(address indexed restoredBy, bytes32 indexed trustedHash, uint256 blockNumber);
    event EmergencyWithdrawn(
        address indexed user,
        address indexed lockedRecipient,
        uint256 amount,
        uint256 nonce,
        string method,
        bool userVerified
    );

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlySentinelOrAdmin() {
        if (msg.sender != sentinel && msg.sender != admin) revert Unauthorized();
        _;
    }

    constructor(address _sentinel, bytes32 _trustedFrontendHash) {
        if (_sentinel == address(0)) revert InvalidAddress();
        admin = msg.sender;
        sentinel = _sentinel;
        trustedFrontendHash = _trustedFrontendHash;
        mode = SecurityMode.NORMAL;
    }

    function deposit() external payable {
        if (msg.value == 0) revert InvalidAmount();
        balances[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value, balances[msg.sender]);
    }

    function depositFor(address user) external payable {
        if (user == address(0)) revert InvalidAddress();
        if (msg.value == 0) revert InvalidAmount();
        balances[user] += msg.value;
        totalDeposited += msg.value;
        emit Deposited(user, msg.value, balances[user]);
    }

    /**
     * @notice Bind a NIST P-256 (secp256r1) public key.
     *         Strictly frozen during PASSKEY_ONLY incidents so a hijacked frontend cannot
     *         trick a victim into overwriting their hardware key.
     */
    function registerPasskey(bytes32 qx, bytes32 qy) external {
        if (mode == SecurityMode.PASSKEY_ONLY) revert PasskeyLockedDuringBreaker();
        if (!P256.isValidPublicKey(qx, qy)) revert InvalidPublicKey();
        passkeys[msg.sender] = Passkey({qx: qx, qy: qy, registered: true});
        emit PasskeyRegistered(msg.sender, qx, qy);
    }

    /**
     * @notice Optional cold recovery address pre-bound during NORMAL mode (defaults to msg.sender).
     *         Strictly frozen during PASSKEY_ONLY incidents.
     */
    function setRecoveryAddress(address payable _recovery) external {
        if (mode == SecurityMode.PASSKEY_ONLY) revert RecoveryAddressLockedDuringBreaker();
        recoveryAddresses[msg.sender] = _recovery;
        emit RecoveryAddressUpdated(msg.sender, _recovery);
    }

    /**
     * @notice Returns the immutable-during-incident payout address for hardware escape.
     */
    function getLockedRecoveryAddress(address user) public view returns (address payable) {
        address payable custom = recoveryAddresses[user];
        return custom != address(0) ? custom : payable(user);
    }

    /**
     * @notice Standard withdrawal path. Blocked on-chain when circuit breaker is in PASSKEY_ONLY mode.
     */
    function withdraw(address payable recipient, uint256 amount) external nonReentrant {
        if (mode == SecurityMode.PASSKEY_ONLY) {
            revert VaultInPasskeyOnlyMode(lastMaliciousHash, trippedAtBlock);
        }
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        balances[msg.sender] -= amount;
        totalDeposited -= amount;

        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, recipient, amount);
    }

    /**
     * @notice Sub-second on-chain circuit breaker degrading vault to PASSKEY_ONLY mode.
     */
    function tripBreaker(bytes32 detectedHash, string calldata reason) external onlySentinelOrAdmin {
        mode = SecurityMode.PASSKEY_ONLY;
        lastMaliciousHash = detectedHash;
        trippedAtBlock = block.number;
        trippedAtTime = block.timestamp;
        tripReason = reason;
        tripCount += 1;

        emit BreakerTripped(msg.sender, detectedHash, block.number, block.timestamp, reason);
    }

    /**
     * @notice Restore NORMAL operation after DNS/CDN integrity is verified clean.
     *         In production, `admin` is a Multisig + Timelock.
     */
    function restoreNormalMode(bytes32 newTrustedHash) external onlyAdmin {
        mode = SecurityMode.NORMAL;
        if (newTrustedHash != bytes32(0)) {
            trustedFrontendHash = newTrustedHash;
        }
        lastMaliciousHash = bytes32(0);
        tripReason = "";

        emit ModeRestored(msg.sender, trustedFrontendHash, block.number);
    }

    /**
     * @notice Deterministic domain-separated challenge bound to on-chain locked recovery recipient.
     */
    function computeRecoveryChallenge(address user, uint256 amount, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        address lockedRecipient = getLockedRecoveryAddress(user);
        return keccak256(
            abi.encode(RECOVERY_DOMAIN, block.chainid, address(this), user, lockedRecipient, amount, nonce, deadline)
        );
    }

    /**
     * @notice Plan A Hardware Escape Hatch: verifies real WebAuthn (TouchID/FaceID) via
     *         OpenZeppelin WebAuthn -> Monad native EIP-7951 (0x0100) precompile (6,900 gas).
     *         Payout target is strictly enforced on-chain as getLockedRecoveryAddress(msg.sender);
     *         frontend CANNOT inject an arbitrary recipient even before signing.
     */
    function emergencyWithdrawWithWebAuthn(uint256 amount, uint256 deadline, WebAuthn.WebAuthnAuth calldata auth)
        external
        nonReentrant
    {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (amount == 0) revert InvalidAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        Passkey memory pk = passkeys[msg.sender];
        if (!pk.registered) revert PasskeyNotRegistered();

        address payable lockedRecipient = getLockedRecoveryAddress(msg.sender);
        uint256 currentNonce = nonces[msg.sender];
        bytes32 challenge = computeRecoveryChallenge(msg.sender, amount, currentNonce, deadline);

        bool valid = WebAuthn.verify(abi.encodePacked(challenge), auth, pk.qx, pk.qy, false);
        if (!valid) revert InvalidPasskeySignature();

        bool uv = auth.authenticatorData.length > 32 && (auth.authenticatorData[32] & WebAuthn.AUTH_DATA_FLAGS_UV) != 0;

        nonces[msg.sender] = currentNonce + 1;
        emergencyRecoveryCount += 1;
        balances[msg.sender] -= amount;
        totalDeposited -= amount;

        (bool ok,) = lockedRecipient.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit EmergencyWithdrawn(msg.sender, lockedRecipient, amount, currentNonce, "WEBAUTHN_EIP7951_0x0100", uv);
    }

    /**
     * @notice Plan B Demo Fallback: verifies non-extractable WebCrypto ECDSA P-256 signature
     *         strictly via Monad native EIP-7951 (0x0100) precompile (`P256.verifyNative`).
     *         Payout target is strictly enforced on-chain as getLockedRecoveryAddress(msg.sender).
     */
    function emergencyWithdrawWithRawP256(uint256 amount, uint256 deadline, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        if (block.timestamp > deadline) revert SignatureExpired();
        if (amount == 0) revert InvalidAmount();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        Passkey memory pk = passkeys[msg.sender];
        if (!pk.registered) revert PasskeyNotRegistered();

        address payable lockedRecipient = getLockedRecoveryAddress(msg.sender);
        uint256 currentNonce = nonces[msg.sender];
        bytes32 challenge = computeRecoveryChallenge(msg.sender, amount, currentNonce, deadline);
        bytes32 digest = sha256(abi.encodePacked(challenge));

        bool valid = P256.verifyNative(digest, r, s, pk.qx, pk.qy);
        if (!valid) revert InvalidPasskeySignature();

        nonces[msg.sender] = currentNonce + 1;
        emergencyRecoveryCount += 1;
        balances[msg.sender] -= amount;
        totalDeposited -= amount;

        (bool ok,) = lockedRecipient.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit EmergencyWithdrawn(msg.sender, lockedRecipient, amount, currentNonce, "RAW_P256_EIP7951_0x0100", false);
    }

    function isNativeP256PrecompileActive() external view returns (bool) {
        return P256.verifyNative(
            0xbb5a52f42f9c9261ed4361f59422a1e30036e7c32b270c8807a419feca605023,
            0x0000000000000000000000000000000000000000000000000000000000000005,
            0x0000000000000000000000000000000000000000000000000000000000000001,
            0xa71af64de5126a4a4e02b7922d66ce9415ce88a4c9d25514d91082c8725ac957,
            0x5d47723c8fbe580bb369fec9c2665d8e30a435b9932645482e7c9f11e872296b
        );
    }

    function getVaultStatus()
        external
        view
        returns (
            SecurityMode currentMode,
            bytes32 trustedHash,
            bytes32 maliciousHash,
            uint256 trippedBlock,
            uint256 trippedTime,
            string memory reason,
            uint256 trips,
            uint256 recoveries,
            uint256 tvl
        )
    {
        return (
            mode,
            trustedFrontendHash,
            lastMaliciousHash,
            trippedAtBlock,
            trippedAtTime,
            tripReason,
            tripCount,
            emergencyRecoveryCount,
            totalDeposited
        );
    }

    receive() external payable {
        if (msg.value == 0) revert InvalidAmount();
        balances[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value, balances[msg.sender]);
    }
}
