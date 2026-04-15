// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NphOutcomeFundingVault
 * @notice ERC-20 funding vault for outcome-based milestone payouts.
 *
 *   • Holds stablecoin (USDC/USDT/DAI) in per-program treasuries.
 *   • Verifier-authorized payouts only — no clinical user touches a wallet.
 *   • Replay protection: each (programId, siteId, episodeRef, milestoneType)
 *     combination can pay out exactly once.
 *   • No PHI on-chain — only hashes, pseudo-references, and amounts.
 *
 * Roles:
 *   DEFAULT_ADMIN_ROLE  — can grant/revoke roles, pause/unpause, recover funds.
 *   PROGRAM_ADMIN_ROLE  — can create programs, configure milestones, deposit.
 *   VERIFIER_ROLE       — can call payMilestone after off-chain eligibility check.
 */
contract NphOutcomeFundingVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================
    // ROLES
    // ============================================================

    bytes32 public constant PROGRAM_ADMIN_ROLE = keccak256("PROGRAM_ADMIN_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    // ============================================================
    // ENUMS
    // ============================================================

    enum MilestoneType {
        SCREENING_COMPLETED,            // 0
        IMAGING_COMPLETED,              // 1
        SPECIALIST_REVIEW_COMPLETED,    // 2
        CSF_TEST_COMPLETED,             // 3
        SHUNT_PERFORMED,                // 4
        FOLLOWUP_3M_COMPLETED,          // 5
        VALIDATED_IMPROVEMENT_RECORDED  // 6
    }

    // ============================================================
    // STRUCTS
    // ============================================================

    struct Program {
        bytes32 programId;          // Deterministic ID (e.g. keccak256 of name + project).
        address token;              // ERC-20 stablecoin address.
        uint256 treasuryBalance;    // Current balance held for this program.
        uint256 totalDeposited;     // Lifetime deposited.
        uint256 totalPaidOut;       // Lifetime paid out.
        bool    active;             // Whether payouts are enabled.
        address admin;              // Program-level admin (can deposit, configure).
    }

    struct MilestonePayout {
        uint256 amount;             // Token amount (in token decimals).
        bool    enabled;            // Whether this milestone type pays out.
    }

    struct ClaimRecord {
        bytes32 claimId;            // Off-chain claim reference.
        bytes32 programId;
        bytes32 siteId;             // Pseudo site reference (not PHI).
        bytes32 episodeRef;         // Pseudo episode reference (not PHI).
        MilestoneType milestoneType;
        bytes32 attestationHash;    // The attestation payloadHash backing this claim.
        address recipient;          // Payout recipient address.
        uint256 amount;
        uint256 paidAt;             // Block timestamp of payout.
    }

    // ============================================================
    // STORAGE
    // ============================================================

    /// programId => Program
    mapping(bytes32 => Program) public programs;

    /// programId => milestoneType => MilestonePayout config
    mapping(bytes32 => mapping(MilestoneType => MilestonePayout)) public milestonePayouts;

    /// Replay protection: keccak256(programId, siteId, episodeRef, milestoneType) => paid
    mapping(bytes32 => bool) public claimPaid;

    /// Attestation hash replay protection: attestationHash => used
    mapping(bytes32 => bool) public attestationUsed;

    /// Sequential claim records for audit trail.
    ClaimRecord[] public claims;

    /// claimId => index in claims array (for lookup).
    mapping(bytes32 => uint256) public claimIndex;

    // ============================================================
    // EVENTS
    // ============================================================

    event ProgramCreated(
        bytes32 indexed programId,
        address indexed token,
        address indexed admin
    );

    event ProgramStatusChanged(
        bytes32 indexed programId,
        bool active
    );

    event MilestoneConfigured(
        bytes32 indexed programId,
        MilestoneType milestoneType,
        uint256 amount,
        bool enabled
    );

    event TreasuryDeposit(
        bytes32 indexed programId,
        address indexed depositor,
        uint256 amount
    );

    event MilestonePaid(
        bytes32 indexed programId,
        bytes32 indexed claimId,
        bytes32 indexed episodeRef,
        MilestoneType milestoneType,
        bytes32 attestationHash,
        address recipient,
        uint256 amount
    );

    event FundsRecovered(
        bytes32 indexed programId,
        address indexed recipient,
        uint256 amount
    );

    // ============================================================
    // ERRORS
    // ============================================================

    error ProgramAlreadyExists(bytes32 programId);
    error ProgramNotFound(bytes32 programId);
    error ProgramNotActive(bytes32 programId);
    error MilestoneNotEnabled(bytes32 programId, MilestoneType milestoneType);
    error InsufficientTreasury(bytes32 programId, uint256 required, uint256 available);
    error DuplicateClaim(bytes32 claimKey);
    error DuplicateAttestation(bytes32 attestationHash);
    error InvalidRecipient();
    error InvalidAmount();
    error InvalidToken();

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    constructor(address defaultAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(PROGRAM_ADMIN_ROLE, defaultAdmin);
        _grantRole(VERIFIER_ROLE, defaultAdmin);
    }

    // ============================================================
    // PROGRAM MANAGEMENT
    // ============================================================

    /**
     * @notice Create a new funding program with a specific ERC-20 token.
     * @param programId  Deterministic program identifier.
     * @param token      ERC-20 stablecoin address.
     */
    function createProgram(
        bytes32 programId,
        address token
    ) external onlyRole(PROGRAM_ADMIN_ROLE) {
        if (programs[programId].token != address(0)) revert ProgramAlreadyExists(programId);
        if (token == address(0)) revert InvalidToken();

        programs[programId] = Program({
            programId: programId,
            token: token,
            treasuryBalance: 0,
            totalDeposited: 0,
            totalPaidOut: 0,
            active: false,
            admin: msg.sender
        });

        emit ProgramCreated(programId, token, msg.sender);
    }

    /**
     * @notice Activate or deactivate a funding program.
     */
    function setProgramActive(
        bytes32 programId,
        bool active
    ) external onlyRole(PROGRAM_ADMIN_ROLE) {
        if (programs[programId].token == address(0)) revert ProgramNotFound(programId);
        programs[programId].active = active;
        emit ProgramStatusChanged(programId, active);
    }

    // ============================================================
    // MILESTONE CONFIGURATION
    // ============================================================

    /**
     * @notice Configure payout amount and enabled status for a milestone type.
     * @param programId      The program to configure.
     * @param milestoneType  Which milestone type.
     * @param amount         Payout amount in token decimals.
     * @param enabled        Whether this milestone pays out.
     */
    function configureMilestonePayout(
        bytes32 programId,
        MilestoneType milestoneType,
        uint256 amount,
        bool enabled
    ) external onlyRole(PROGRAM_ADMIN_ROLE) {
        if (programs[programId].token == address(0)) revert ProgramNotFound(programId);

        milestonePayouts[programId][milestoneType] = MilestonePayout({
            amount: amount,
            enabled: enabled
        });

        emit MilestoneConfigured(programId, milestoneType, amount, enabled);
    }

    // ============================================================
    // TREASURY
    // ============================================================

    /**
     * @notice Deposit ERC-20 tokens into a program’s treasury.
     *         Caller must have approved this contract for `amount` tokens.
     * @param programId  Target program.
     * @param amount     Token amount to deposit.
     */
    function depositToTreasury(
        bytes32 programId,
        uint256 amount
    ) external nonReentrant {
        if (programs[programId].token == address(0)) revert ProgramNotFound(programId);
        if (amount == 0) revert InvalidAmount();

        IERC20 token = IERC20(programs[programId].token);
        token.safeTransferFrom(msg.sender, address(this), amount);

        programs[programId].treasuryBalance += amount;
        programs[programId].totalDeposited += amount;

        emit TreasuryDeposit(programId, msg.sender, amount);
    }

    // ============================================================
    // PAYOUT
    // ============================================================

    /**
     * @notice Pay a verified milestone. Only callable by VERIFIER_ROLE.
     *
     *  Security checks:
     *    1. Program must exist and be active.
     *    2. Milestone type must be enabled with amount > 0.
     *    3. Treasury must have sufficient balance.
     *    4. The (programId, siteId, episodeRef, milestoneType) tuple
     *       must not have been paid before (duplicate prevention).
     *    5. The attestationHash must not have been used before (replay protection).
     *    6. Recipient must not be the zero address.
     *
     * @param claimId          Off-chain claim reference.
     * @param programId        Funding program.
     * @param siteId           Pseudo site reference.
     * @param episodeRef       Pseudo episode reference.
     * @param milestoneType    Which milestone was achieved.
     * @param attestationHash  Hash of the attestation proving the milestone.
     * @param recipient        Address to receive the payout.
     */
    function payMilestone(
        bytes32 claimId,
        bytes32 programId,
        bytes32 siteId,
        bytes32 episodeRef,
        MilestoneType milestoneType,
        bytes32 attestationHash,
        address recipient
    ) external onlyRole(VERIFIER_ROLE) whenNotPaused nonReentrant {
        // 1. Program checks
        Program storage prog = programs[programId];
        if (prog.token == address(0)) revert ProgramNotFound(programId);
        if (!prog.active) revert ProgramNotActive(programId);

        // 2. Milestone config checks
        MilestonePayout storage mp = milestonePayouts[programId][milestoneType];
        if (!mp.enabled) revert MilestoneNotEnabled(programId, milestoneType);
        uint256 amount = mp.amount;
        if (amount == 0) revert InvalidAmount();

        // 3. Treasury balance check
        if (prog.treasuryBalance < amount) {
            revert InsufficientTreasury(programId, amount, prog.treasuryBalance);
        }

        // 4. Duplicate claim prevention
        bytes32 claimKey = keccak256(
            abi.encodePacked(programId, siteId, episodeRef, milestoneType)
        );
        if (claimPaid[claimKey]) revert DuplicateClaim(claimKey);

        // 5. Attestation replay protection
        if (attestationUsed[attestationHash]) revert DuplicateAttestation(attestationHash);

        // 6. Recipient validation
        if (recipient == address(0)) revert InvalidRecipient();

        // Execute payout
        claimPaid[claimKey] = true;
        attestationUsed[attestationHash] = true;
        prog.treasuryBalance -= amount;
        prog.totalPaidOut += amount;

        // Record claim for audit
        uint256 idx = claims.length;
        claims.push(ClaimRecord({
            claimId: claimId,
            programId: programId,
            siteId: siteId,
            episodeRef: episodeRef,
            milestoneType: milestoneType,
            attestationHash: attestationHash,
            recipient: recipient,
            amount: amount,
            paidAt: block.timestamp
        }));
        claimIndex[claimId] = idx;

        // Transfer tokens
        IERC20(prog.token).safeTransfer(recipient, amount);

        emit MilestonePaid(
            programId,
            claimId,
            episodeRef,
            milestoneType,
            attestationHash,
            recipient,
            amount
        );
    }

    // ============================================================
    // RECOVERY
    // ============================================================

    /**
     * @notice Recover unused funds from a program’s treasury.
     *         Only callable by DEFAULT_ADMIN_ROLE.
     * @param programId  Source program.
     * @param recipient  Where to send the recovered funds.
     * @param amount     Amount to recover.
     */
    function recoverUnusedFunds(
        bytes32 programId,
        address recipient,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        Program storage prog = programs[programId];
        if (prog.token == address(0)) revert ProgramNotFound(programId);
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0 || amount > prog.treasuryBalance) revert InvalidAmount();

        prog.treasuryBalance -= amount;
        IERC20(prog.token).safeTransfer(recipient, amount);

        emit FundsRecovered(programId, recipient, amount);
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    /**
     * @notice Get the total number of claims recorded.
     */
    function totalClaims() external view returns (uint256) {
        return claims.length;
    }

    /**
     * @notice Check if a specific milestone has been paid for an episode.
     */
    function isMilestonePaid(
        bytes32 programId,
        bytes32 siteId,
        bytes32 episodeRef,
        MilestoneType milestoneType
    ) external view returns (bool) {
        bytes32 claimKey = keccak256(
            abi.encodePacked(programId, siteId, episodeRef, milestoneType)
        );
        return claimPaid[claimKey];
    }

    /**
     * @notice Check if an attestation hash has already been used.
     */
    function isAttestationUsed(
        bytes32 attestationHash
    ) external view returns (bool) {
        return attestationUsed[attestationHash];
    }

    // ============================================================
    // PAUSABLE
    // ============================================================

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
