// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ICurveYieldGovernanceToken} from "./interfaces/ICurveYield.sol";
import {ICurveYieldGovernanceMintReceiver} from "./interfaces/ICurveYieldGovernanceMintController.sol";

/// @notice External governance-mint reservation and scheduling controller for Governance Staking.
/// @dev This contract, not Governance Staking, must receive the Governance Staking minter allocation.
contract CurveYieldGovernanceMintController is Ownable2Step {
    uint256 public constant MINT_TIMELOCK_ACTIVATION_DELAY = 7 days;
    uint256 public constant MINT_APPROVAL_DELAY = 7 days;

    address public immutable governanceStaking;
    address public immutable governanceToken;
    ICurveYieldGovernanceToken public immutable GOVERNANCE_MINTER;
    uint64 public immutable mintTimelocksActiveAt;

    uint256 public pendingOneTimeGovernanceMint;
    uint256 public oneTimeGovernanceMintReadyAt;
    uint256 public oneTimeGovernanceMintReservationId;

    uint256 public periodicGovernanceMintAmount;
    uint256 public periodicGovernanceMintInterval;
    uint256 public nextPeriodicGovernanceMintAt;
    uint256 public periodicGovernanceMintReservationId;

    uint256 public pendingPeriodicGovernanceMintAmount;
    uint256 public pendingPeriodicGovernanceMintInterval;
    uint256 public pendingPeriodicGovernanceMintReservationId;
    uint256 public periodicGovernanceMintConfigReadyAt;

    error ZeroAddress();
    error ZeroAmount();
    error MintApprovalNotPending();
    error MintApprovalNotReady();
    error PeriodicMintNotReady();
    error InvalidPeriodicMintConfig();
    error MintApprovalAlreadyPending();
    error PeriodicMintReservationMissing();

    event OneTimeGovernanceMintQueued(uint256 amount, uint256 readyAt);
    event OneTimeGovernanceMintCancelled(uint256 amount);
    event OneTimeGovernanceMintExecuted(uint256 amount, uint256 nextCycleReadyAt);
    event PeriodicGovernanceMintConfigQueued(uint256 amount, uint256 interval, uint256 readyAt);
    event PeriodicGovernanceMintConfigCancelled(uint256 amount, uint256 interval);
    event PeriodicGovernanceMintConfigSet(uint256 amount, uint256 interval, uint256 nextMintAt);
    event PeriodicGovernanceMintExecuted(uint256 amount, uint256 nextMintAt, uint256 nextCycleReadyAt);
    event PeriodicGovernanceMintReservationUnavailable(uint256 amount, uint256 nextMintAt);

    constructor(address initialOwner_, address governanceToken_, address governanceStaking_)
        Ownable(initialOwner_)
    {
        if (
            initialOwner_ == address(0) || governanceToken_ == address(0)
                || governanceStaking_ == address(0)
        ) revert ZeroAddress();
        governanceToken = governanceToken_;
        governanceStaking = governanceStaking_;
        GOVERNANCE_MINTER = ICurveYieldGovernanceToken(governanceToken_);
        mintTimelocksActiveAt = uint64(block.timestamp + MINT_TIMELOCK_ACTIVATION_DELAY);
    }

    function proposeOneTimeGovernanceMint(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp < mintTimelocksActiveAt) {
            uint256 cycleReadyAt = _mintAndQueueParticipationReward(amount, 0);
            emit OneTimeGovernanceMintExecuted(amount, cycleReadyAt);
            return;
        }
        if (oneTimeGovernanceMintReadyAt != 0) revert MintApprovalAlreadyPending();
        uint256 readyAt = block.timestamp + MINT_APPROVAL_DELAY;
        uint256 reservationId = GOVERNANCE_MINTER.reserveMint(amount, readyAt);
        pendingOneTimeGovernanceMint = amount;
        oneTimeGovernanceMintReadyAt = readyAt;
        oneTimeGovernanceMintReservationId = reservationId;
        emit OneTimeGovernanceMintQueued(amount, readyAt);
    }

    function executeOneTimeGovernanceMint() external {
        uint256 readyAt = oneTimeGovernanceMintReadyAt;
        if (readyAt == 0) revert MintApprovalNotPending();
        if (block.timestamp < readyAt) revert MintApprovalNotReady();
        uint256 amount = pendingOneTimeGovernanceMint;
        uint256 reservationId = oneTimeGovernanceMintReservationId;
        uint256 cycleReadyAt = _mintAndQueueParticipationReward(amount, reservationId);
        delete pendingOneTimeGovernanceMint;
        delete oneTimeGovernanceMintReadyAt;
        delete oneTimeGovernanceMintReservationId;
        emit OneTimeGovernanceMintExecuted(amount, cycleReadyAt);
    }

    function cancelOneTimeGovernanceMint() external onlyOwner {
        if (oneTimeGovernanceMintReadyAt == 0) revert MintApprovalNotPending();
        uint256 amount = pendingOneTimeGovernanceMint;
        GOVERNANCE_MINTER.cancelMintReservation(oneTimeGovernanceMintReservationId);
        delete pendingOneTimeGovernanceMint;
        delete oneTimeGovernanceMintReadyAt;
        delete oneTimeGovernanceMintReservationId;
        emit OneTimeGovernanceMintCancelled(amount);
    }

    function proposePeriodicGovernanceMint(uint256 amount, uint256 interval) external onlyOwner {
        _validatePeriodicMintConfig(amount, interval);
        if (block.timestamp < mintTimelocksActiveAt) {
            _applyPeriodicGovernanceMintConfig(amount, interval, 0);
            return;
        }
        if (periodicGovernanceMintConfigReadyAt != 0) revert MintApprovalAlreadyPending();
        uint256 readyAt = block.timestamp + MINT_APPROVAL_DELAY;
        uint256 reservationId;
        if (amount != 0) reservationId = GOVERNANCE_MINTER.reserveMint(amount, readyAt + interval);
        pendingPeriodicGovernanceMintAmount = amount;
        pendingPeriodicGovernanceMintInterval = interval;
        pendingPeriodicGovernanceMintReservationId = reservationId;
        periodicGovernanceMintConfigReadyAt = readyAt;
        emit PeriodicGovernanceMintConfigQueued(amount, interval, readyAt);
    }

    function executePeriodicGovernanceMintConfig() external {
        uint256 readyAt = periodicGovernanceMintConfigReadyAt;
        if (readyAt == 0) revert MintApprovalNotPending();
        if (block.timestamp < readyAt) revert MintApprovalNotReady();
        uint256 amount = pendingPeriodicGovernanceMintAmount;
        uint256 interval = pendingPeriodicGovernanceMintInterval;
        uint256 reservationId = pendingPeriodicGovernanceMintReservationId;
        delete pendingPeriodicGovernanceMintAmount;
        delete pendingPeriodicGovernanceMintInterval;
        delete pendingPeriodicGovernanceMintReservationId;
        delete periodicGovernanceMintConfigReadyAt;
        _applyPeriodicGovernanceMintConfig(amount, interval, reservationId);
    }

    function cancelPeriodicGovernanceMintConfig() external onlyOwner {
        if (periodicGovernanceMintConfigReadyAt == 0) revert MintApprovalNotPending();
        uint256 amount = pendingPeriodicGovernanceMintAmount;
        uint256 interval = pendingPeriodicGovernanceMintInterval;
        uint256 reservationId = pendingPeriodicGovernanceMintReservationId;
        if (reservationId != 0) GOVERNANCE_MINTER.cancelMintReservation(reservationId);
        delete pendingPeriodicGovernanceMintAmount;
        delete pendingPeriodicGovernanceMintInterval;
        delete pendingPeriodicGovernanceMintReservationId;
        delete periodicGovernanceMintConfigReadyAt;
        emit PeriodicGovernanceMintConfigCancelled(amount, interval);
    }

    function executePeriodicGovernanceMint() external returns (uint256 amount) {
        amount = periodicGovernanceMintAmount;
        if (amount == 0 || block.timestamp < nextPeriodicGovernanceMintAt) {
            revert PeriodicMintNotReady();
        }
        uint256 reservationId = periodicGovernanceMintReservationId;
        if (reservationId == 0) revert PeriodicMintReservationMissing();
        uint256 nextMintAt = block.timestamp + periodicGovernanceMintInterval;
        uint256 nextReservationId = GOVERNANCE_MINTER.mintReservedAndReserveNext(
            reservationId, governanceStaking, amount, nextMintAt
        );
        periodicGovernanceMintReservationId = nextReservationId;
        nextPeriodicGovernanceMintAt = nextMintAt;
        uint256 cycleReadyAt =
            ICurveYieldGovernanceMintReceiver(governanceStaking).queueMintedParticipationReward(amount);
        if (nextReservationId == 0) {
            emit PeriodicGovernanceMintReservationUnavailable(amount, nextMintAt);
        }
        emit PeriodicGovernanceMintExecuted(amount, nextMintAt, cycleReadyAt);
    }

    function reserveNextPeriodicGovernanceMint() external returns (uint256 reservationId) {
        uint256 amount = periodicGovernanceMintAmount;
        if (amount == 0) revert InvalidPeriodicMintConfig();
        if (periodicGovernanceMintReservationId != 0) return periodicGovernanceMintReservationId;
        uint256 executableAt = nextPeriodicGovernanceMintAt > block.timestamp
            ? nextPeriodicGovernanceMintAt
            : block.timestamp;
        reservationId = GOVERNANCE_MINTER.reserveMint(amount, executableAt);
        periodicGovernanceMintReservationId = reservationId;
    }

    function governanceMintCapacity() external view returns (uint256) {
        return GOVERNANCE_MINTER.availableMintableFor(address(this));
    }

    function _validatePeriodicMintConfig(uint256 amount, uint256 interval) internal pure {
        if ((amount == 0) != (interval == 0)) revert InvalidPeriodicMintConfig();
    }

    function _applyPeriodicGovernanceMintConfig(
        uint256 amount,
        uint256 interval,
        uint256 suppliedReservationId
    ) internal {
        uint256 oldReservationId = periodicGovernanceMintReservationId;
        if (oldReservationId != 0 && oldReservationId != suppliedReservationId) {
            GOVERNANCE_MINTER.cancelMintReservation(oldReservationId);
        }
        periodicGovernanceMintAmount = amount;
        periodicGovernanceMintInterval = interval;
        nextPeriodicGovernanceMintAt = amount == 0 ? 0 : block.timestamp + interval;
        uint256 reservationId = suppliedReservationId;
        if (amount != 0 && reservationId == 0) {
            reservationId = GOVERNANCE_MINTER.reserveMint(amount, nextPeriodicGovernanceMintAt);
        }
        periodicGovernanceMintReservationId = reservationId;
        emit PeriodicGovernanceMintConfigSet(amount, interval, nextPeriodicGovernanceMintAt);
    }

    function _mintAndQueueParticipationReward(uint256 amount, uint256 reservationId)
        internal
        returns (uint256 readyAt)
    {
        if (reservationId == 0) {
            GOVERNANCE_MINTER.mint(governanceStaking, amount);
        } else {
            GOVERNANCE_MINTER.mintReserved(reservationId, governanceStaking, amount);
        }
        readyAt =
            ICurveYieldGovernanceMintReceiver(governanceStaking).queueMintedParticipationReward(amount);
    }
}
