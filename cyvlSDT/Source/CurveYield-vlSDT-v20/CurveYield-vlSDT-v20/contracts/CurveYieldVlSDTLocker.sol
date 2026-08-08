// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/**
 * @title CurveYield System Component
 * @notice CurveYield is a decentralized NGO building optimized DeFi systems for the good of all.
 *
 * @dev CurveYield integrates specialized AMM infrastructure, tokenized yield strategies, credit
 * markets, and protocol-owned liquidity into a unified, capital-efficient liquidity stack governed
 * by an open, international DAO community.
 *
 * Protocol operations are enhanced by cross-chain bridging and messaging, MEV capture systems,
 * off-chain to on-chain automation, and peer-to-peer data networks.
 *
 * This contract is one component of the CurveYield system.
 *
 * CurveYield uses proven DeFi primitives where possible and adds targeted coordination and
 * capital-efficiency-enhancing contracts where needed. Users and integrators must review
 * CurveYield documentation before use.
 *
 * Learn more:
 * Documentation: https://docs.curveyield.com
 * dApp: https://curveyield.online
 * GitHub: https://github.com/curveyield
 *
 * Decentralized links may have limited or delayed availability during periods of high network activity:
 * https://curveyield.eth.limo
 * https://curveyield.dao
 *
 * Note: curveyield.dao may require a Brave Browser or an Unstoppable Domains browser plugin to use.
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    IVlSDT,
    IVlBoost,
    IFeeDistributor,
    IStakeDaoRouter,
    IBoostMarketplace
} from "./interfaces/IStakeDao.sol";
import {
    ICurveYieldVlSDTToken,
    ICurveYieldVlSDTRevenueStaking
} from "./interfaces/ICurveYield.sol";

contract CurveYieldVlSDTLocker is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant DAO_BOOST_BPS = 2_000;
    uint256 public constant ADMIN_BOOST_BPS = 500;
    uint256 public constant WEEK = 7 days;
    uint8 public constant CLAIM_FEE_DISTRIBUTORS_MODULE = 0x0c;
    uint8 public constant SWEEP_TOKENS_MODULE = 0x07;
    bytes4 public constant CLAIM_FEE_DISTRIBUTORS_SELECTOR = 0xb38aab9d;
    bytes4 public constant SWEEP_TOKENS_SELECTOR = 0x780469bb;

    IERC20 public immutable SDT;
    IERC20 public immutable USDC_REWARD_TOKEN;
    IVlSDT public immutable VLSDT;
    IVlBoost public immutable VLBOOST;
    IStakeDaoRouter public immutable STAKE_DAO_ROUTER;
    IFeeDistributor public immutable VLSDT_FEE_DISTRIBUTOR_USDC;
    IFeeDistributor public immutable VLSDT_FEE_DISTRIBUTOR_SDT;
    IBoostMarketplace public immutable BOOST_MARKETPLACE;
    ICurveYieldVlSDTToken public immutable CYVLSDT;
    address public treasuryReceiver;

    address public revenueStaking;
    address public boostStaking;
    address public boostMerchant;
    bool public systemConfigured;

    struct DaoBoostCommitment {
        uint128 amount;
        uint64 endtime;
        bool active;
    }

    struct ModuleBoostCommitment {
        address module;
        uint128 amount;
        uint64 endtime;
        bool active;
    }

    struct EmergencyWithdrawal {
        address owner;
        uint128 amount;
        uint256 vlSdtRequestId;
        bool completed;
    }

    uint256 public daoCommittedBoost;
    uint256 public daoBoostReleasedToModules;
    uint256 public nextDaoBoostCommitmentId = 1;
    mapping(uint256 => DaoBoostCommitment) public daoBoostCommitments;

    uint256 public adminCommittedBoost;
    uint256 public nextAdminBoostCommitmentId = 1;
    mapping(uint256 => DaoBoostCommitment) public adminBoostCommitments;

    uint16 public merchantReserveBps;
    uint16 public boostStakingReserveBps;
    uint256 public merchantAbsoluteBoostReserve;
    uint256 public boostStakingAbsoluteBoostReserve;

    uint256 public boostMerchantCommittedBoost;
    uint256 public boostStakingCommittedBoost;
    uint256 public nextModuleBoostCommitmentId = 1;
    mapping(uint256 => ModuleBoostCommitment) public moduleBoostCommitments;

    bool public emergencyWithdrawPermanentlyDisabled;
    uint256 public nextEmergencyWithdrawalId = 1;
    mapping(uint256 => EmergencyWithdrawal) public emergencyWithdrawals;

    error ZeroAddress();
    error ZeroAmount();
    error SystemAlreadyConfigured();
    error SystemNotConfigured();
    error OnlyBoostModule();
    error OnlyBoostMerchant();
    error OnlyAdmin();
    error NonOneToOneStake(uint256 expected, uint256 actual);
    error InvalidFeeDistributorRewardToken(
        address distributor, address actualRewardToken, address expectedRewardToken
    );
    error NoRewardClaimed();
    error NoVlSDTSupply();
    error InsufficientModuleBoostCapacity();
    error DaoBoostAllocationExceeded();
    error InvalidDaoBoostRelease();
    error ReleasedDaoBoostInUse();
    error InvalidModuleReserveBps();
    error InvalidModuleReserveConfiguration();
    error InsufficientUnreservedBoost();
    error InvalidAbsoluteReserveRelease();
    error InvalidModuleBoostCommitment();
    error ModuleBoostStillActive();
    error InvalidDaoBoostCommitment();
    error DaoBoostStillActive();
    error AdminBoostAllocationExceeded();
    error InvalidAdminBoostCommitment();
    error AdminBoostStillActive();
    error EmergencyWithdrawDisabled();
    error InvalidEmergencyWithdrawal();
    error ValueTooLarge();
    error NonExactEmergencyWithdrawal(uint256 expected, uint256 actual);

    event SystemConfigured(address revenueStaking, address boostStaking, address boostMerchant);
    event TreasuryReceiverSet(address indexed oldReceiver, address indexed newReceiver);
    event Deposited(address indexed caller, address indexed receiver, uint256 amount);
    event VlSDTRewardClaimed(address indexed rewardToken, uint256 amount, uint256 baseRewardPerVlSDT);
    event BoostDelegated(address indexed module, address indexed recipient, uint256 amount, uint256 endtime);
    event MarketplaceOperatorSet(bool approved);
    event MarketplaceRevenueForwarded(address indexed token, uint256 amount);
    event DaoBoostDelegated(
        uint256 indexed id, address indexed recipient, uint256 amount, uint256 endtime, bool marketplaceSale
    );
    event DaoBoostCommitmentReleased(uint256 indexed id, uint256 amount);
    event DaoBoostReleasedToModulesSet(uint256 oldAmount, uint256 newAmount);
    event ModuleBoostReserveBpsSet(
        uint256 oldMerchantBps,
        uint256 oldBoostStakingBps,
        uint256 newMerchantBps,
        uint256 newBoostStakingBps
    );
    event CurrentAvailableBoostReserved(
        uint256 merchantAmount,
        uint256 boostStakingAmount,
        uint256 merchantAbsoluteReserve,
        uint256 boostStakingAbsoluteReserve
    );
    event CurrentAvailableBoostReserveReleased(
        uint256 merchantAmount,
        uint256 boostStakingAmount,
        uint256 merchantAbsoluteReserve,
        uint256 boostStakingAbsoluteReserve
    );
    event ModuleBoostCommitmentCreated(
        uint256 indexed id,
        address indexed module,
        address indexed recipient,
        uint256 amount,
        uint256 endtime
    );
    event ModuleBoostCommitmentReleased(uint256 indexed id, address indexed module, uint256 amount);
    event DaoMarketplaceRevenue(address indexed paymentToken, uint256 amount);
    event AdminBoostDelegated(uint256 indexed id, address indexed recipient, uint256 amount, uint256 endtime);
    event AdminBoostCommitmentReleased(uint256 indexed id, uint256 amount);
    event EmergencyWithdrawalRequested(
        uint256 indexed id, address indexed owner, uint256 amount, uint256 vlSdtRequestId
    );
    event EmergencyWithdrawalCompleted(
        uint256 indexed id, address indexed owner, address indexed receiver, uint256 amount
    );
    event EmergencyWithdrawDisabledForever();

    constructor(
        address initialOwner_,
        address initialTreasuryReceiver_,
        address sdt_,
        address vlSdt_,
        address vlBoost_,
        address stakeDaoRouter_,
        address vlSdtFeeDistributorUsdc_,
        address vlSdtFeeDistributorSdt_,
        address boostMarketplace_,
        address cyvlSdt_
    ) Ownable(initialOwner_) {
        if (
            initialOwner_ == address(0) || initialTreasuryReceiver_ == address(0)
                || sdt_ == address(0) || vlSdt_ == address(0) || vlBoost_ == address(0)
                || stakeDaoRouter_ == address(0) || vlSdtFeeDistributorUsdc_ == address(0)
                || vlSdtFeeDistributorSdt_ == address(0)
                || boostMarketplace_ == address(0) || cyvlSdt_ == address(0)
        ) revert ZeroAddress();

        address usdcRewardToken = IFeeDistributor(vlSdtFeeDistributorUsdc_).REWARD_TOKEN();
        address sdtRewardToken = IFeeDistributor(vlSdtFeeDistributorSdt_).REWARD_TOKEN();
        if (usdcRewardToken == address(0)) {
            revert InvalidFeeDistributorRewardToken(
                vlSdtFeeDistributorUsdc_, address(0), address(0)
            );
        }
        if (sdtRewardToken != sdt_) {
            revert InvalidFeeDistributorRewardToken(
                vlSdtFeeDistributorSdt_, sdtRewardToken, sdt_
            );
        }

        treasuryReceiver = initialTreasuryReceiver_;
        SDT = IERC20(sdt_);
        USDC_REWARD_TOKEN = IERC20(usdcRewardToken);
        VLSDT = IVlSDT(vlSdt_);
        VLBOOST = IVlBoost(vlBoost_);
        STAKE_DAO_ROUTER = IStakeDaoRouter(stakeDaoRouter_);
        VLSDT_FEE_DISTRIBUTOR_USDC = IFeeDistributor(vlSdtFeeDistributorUsdc_);
        VLSDT_FEE_DISTRIBUTOR_SDT = IFeeDistributor(vlSdtFeeDistributorSdt_);
        BOOST_MARKETPLACE = IBoostMarketplace(boostMarketplace_);
        CYVLSDT = ICurveYieldVlSDTToken(cyvlSdt_);
        emit TreasuryReceiverSet(address(0), initialTreasuryReceiver_);
    }

    modifier configured() {
        if (!systemConfigured) revert SystemNotConfigured();
        _;
    }

    modifier onlyBoostModule() {
        if (msg.sender != boostStaking && msg.sender != boostMerchant) revert OnlyBoostModule();
        _;
    }

    modifier onlyMerchant() {
        if (msg.sender != boostMerchant) revert OnlyBoostMerchant();
        _;
    }

    modifier onlyAdmin() {
        if (!systemConfigured) revert SystemNotConfigured();
        if (msg.sender != ICurveYieldVlSDTRevenueStaking(revenueStaking).admin()) revert OnlyAdmin();
        _;
    }

    function setTreasuryReceiver(address newReceiver) external onlyOwner {
        if (newReceiver == address(0)) revert ZeroAddress();
        emit TreasuryReceiverSet(treasuryReceiver, newReceiver);
        treasuryReceiver = newReceiver;
    }

    function configureSystem(address revenueStaking_, address boostStaking_, address boostMerchant_)
        external
        onlyOwner
    {
        if (systemConfigured) revert SystemAlreadyConfigured();
        if (
            revenueStaking_ == address(0) || boostStaking_ == address(0)
                || boostMerchant_ == address(0)
        ) revert ZeroAddress();

        revenueStaking = revenueStaking_;
        boostStaking = boostStaking_;
        boostMerchant = boostMerchant_;
        systemConfigured = true;
        emit SystemConfigured(revenueStaking_, boostStaking_, boostMerchant_);
    }

    function deposit(uint256 amount, address receiver)
        external
        nonReentrant
        configured
        returns (uint256 minted)
    {
        if (amount == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        SDT.safeTransferFrom(msg.sender, address(this), amount);
        SDT.forceApprove(address(VLSDT), amount);

        uint256 beforeBalance = VLSDT.balanceOf(address(this));
        VLSDT.stake(amount, address(this));
        SDT.forceApprove(address(VLSDT), 0);

        minted = VLSDT.balanceOf(address(this)) - beforeBalance;
        if (minted != amount) revert NonOneToOneStake(amount, minted);

        CYVLSDT.mint(receiver, minted);
        emit Deposited(msg.sender, receiver, minted);
    }

    function claimVlSDTRewards()
        external
        nonReentrant
        configured
        returns (uint256 usdcClaimed, uint256 sdtClaimed)
    {
        uint256 usdcBefore = USDC_REWARD_TOKEN.balanceOf(address(this));
        uint256 sdtBefore = SDT.balanceOf(address(this));

        address[] memory distributors = new address[](2);
        distributors[0] = address(VLSDT_FEE_DISTRIBUTOR_USDC);
        distributors[1] = address(VLSDT_FEE_DISTRIBUTOR_SDT);
        address[] memory tokens = new address[](2);
        tokens[0] = address(USDC_REWARD_TOKEN);
        tokens[1] = address(SDT);

        bytes[] memory calls = new bytes[](2);
        calls[0] = bytes.concat(
            bytes1(CLAIM_FEE_DISTRIBUTORS_MODULE),
            abi.encodeWithSelector(CLAIM_FEE_DISTRIBUTORS_SELECTOR, distributors)
        );
        calls[1] = bytes.concat(
            bytes1(SWEEP_TOKENS_MODULE),
            abi.encodeWithSelector(SWEEP_TOKENS_SELECTOR, tokens)
        );
        STAKE_DAO_ROUTER.execute(calls);

        usdcClaimed = USDC_REWARD_TOKEN.balanceOf(address(this)) - usdcBefore;
        sdtClaimed = SDT.balanceOf(address(this)) - sdtBefore;
        if (usdcClaimed == 0 && sdtClaimed == 0) revert NoRewardClaimed();
        uint256 supply = VLSDT.balanceOf(address(this));
        if (supply == 0) revert NoVlSDTSupply();
        _forwardVlSDTReward(address(USDC_REWARD_TOKEN), usdcClaimed, supply);
        _forwardVlSDTReward(address(SDT), sdtClaimed, supply);
    }

    function _forwardVlSDTReward(address rewardToken, uint256 claimed, uint256 supply) private {
        if (claimed == 0) return;
        uint256 baseRewardPerVlSDT = Math.mulDiv(claimed, PRECISION, supply);
        IERC20(rewardToken).forceApprove(revenueStaking, claimed);
        ICurveYieldVlSDTRevenueStaking(revenueStaking).notifyReward(
            rewardToken,
            claimed,
            baseRewardPerVlSDT
        );
        IERC20(rewardToken).forceApprove(revenueStaking, 0);
        emit VlSDTRewardClaimed(rewardToken, claimed, baseRewardPerVlSDT);
    }

    function delegateBoost(uint256 amount, uint256 endtime, address recipient)
        external
        nonReentrant
        configured
        onlyBoostModule
        returns (uint256 commitmentId)
    {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        uint256 available = msg.sender == boostMerchant
            ? boostMerchantDelegableBoost()
            : boostStakingDelegableBoost();
        if (amount > available) revert InsufficientModuleBoostCapacity();
        if (amount > type(uint128).max || endtime > type(uint64).max) revert ValueTooLarge();

        commitmentId = nextModuleBoostCommitmentId++;
        moduleBoostCommitments[commitmentId] =
            ModuleBoostCommitment(msg.sender, uint128(amount), uint64(endtime), true);
        if (msg.sender == boostMerchant) boostMerchantCommittedBoost += amount;
        else boostStakingCommittedBoost += amount;

        VLBOOST.boost(address(this), amount, endtime, recipient);
        emit ModuleBoostCommitmentCreated(commitmentId, msg.sender, recipient, amount, endtime);
        emit BoostDelegated(msg.sender, recipient, amount, endtime);
    }

    function releaseModuleBoostCommitment(uint256 id) external {
        ModuleBoostCommitment storage commitment = moduleBoostCommitments[id];
        if (!commitment.active) revert InvalidModuleBoostCommitment();
        if (block.timestamp < commitment.endtime) revert ModuleBoostStillActive();
        commitment.active = false;
        if (commitment.module == boostMerchant) boostMerchantCommittedBoost -= commitment.amount;
        else if (commitment.module == boostStaking) boostStakingCommittedBoost -= commitment.amount;
        else revert InvalidModuleBoostCommitment();
        emit ModuleBoostCommitmentReleased(id, commitment.module, commitment.amount);
    }

    function totalVlSDT() external view returns (uint256) {
        return VLSDT.balanceOf(address(this));
    }

    function daoBoostAllocation() public view returns (uint256) {
        return Math.mulDiv(VLSDT.balanceOf(address(this)), DAO_BOOST_BPS, BPS);
    }

    function daoDelegableBoost() public view returns (uint256 available) {
        uint256 allocation = daoBoostAllocation();
        uint256 unavailable = daoCommittedBoost + daoBoostReleasedToModules;
        if (unavailable >= allocation) return 0;
        available = allocation - unavailable;
        uint256 rawAvailable = VLBOOST.delegableBalance(address(this));
        if (available > rawAvailable) available = rawAvailable;
    }

    /// @notice Current self-administered protocol admin read from Revenue Staking.
    function admin() public view returns (address) {
        if (!systemConfigured) return address(0);
        return ICurveYieldVlSDTRevenueStaking(revenueStaking).admin();
    }

    /// @notice Compatibility alias for integrations that previously read an uppercase ADMIN getter.
    function ADMIN() external view returns (address) {
        return admin();
    }

    function adminBoostAllocation() public view returns (uint256) {
        return Math.mulDiv(VLSDT.balanceOf(address(this)), ADMIN_BOOST_BPS, BPS);
    }

    function adminDelegableBoost() public view returns (uint256 available) {
        uint256 allocation = adminBoostAllocation();
        if (adminCommittedBoost >= allocation) return 0;
        available = allocation - adminCommittedBoost;
        uint256 rawAvailable = VLBOOST.delegableBalance(address(this));
        if (available > rawAvailable) available = rawAvailable;
    }

    function baseModuleBoostAllocation() public view returns (uint256) {
        return Math.mulDiv(
            VLSDT.balanceOf(address(this)), BPS - DAO_BOOST_BPS - ADMIN_BOOST_BPS, BPS
        );
    }

    function moduleBoostAllocation() public view returns (uint256) {
        return baseModuleBoostAllocation() + daoBoostReleasedToModules;
    }

    function moduleDelegatedBoost() public view returns (uint256 moduleDelegated) {
        uint256 total = VLSDT.balanceOf(address(this));
        uint256 rawAvailable = VLBOOST.delegableBalance(address(this));
        uint256 totalDelegated = total > rawAvailable ? total - rawAvailable : 0;
        uint256 reservedDelegated = daoCommittedBoost + adminCommittedBoost;
        moduleDelegated = totalDelegated > reservedDelegated ? totalDelegated - reservedDelegated : 0;
    }

    /// @notice Unfilled Boost Marketplace sell listings owned by the Locker.
    /// @dev These listings reserve Merchant capacity before an external buyer fills them.
    function marketplaceCommittedBoost() public view returns (uint256) {
        return BOOST_MARKETPLACE.committedBalance(address(this));
    }

    /// @notice Marketplace-filled delegations inferred from live vlBoost delegation not recorded by direct module calls.
    function marketplaceFilledBoost() public view returns (uint256 filled) {
        uint256 rawModuleDelegated = moduleDelegatedBoost();
        uint256 directlyTracked = boostMerchantCommittedBoost + boostStakingCommittedBoost;
        if (rawModuleDelegated > directlyTracked) filled = rawModuleDelegated - directlyTracked;
    }

    function boostMerchantBoostUsed() public view returns (uint256) {
        return boostMerchantCommittedBoost + marketplaceFilledBoost() + marketplaceCommittedBoost();
    }

    function boostStakingBoostUsed() public view returns (uint256) {
        return boostStakingCommittedBoost;
    }

    /// @notice Total shared module capacity consumed by Merchant and Boost Staking commitments.
    function moduleBoostUsed() public view returns (uint256) {
        return boostMerchantBoostUsed() + boostStakingBoostUsed();
    }

    /// @notice Lends an exact unused portion of the DAO's protected twenty-percent reserve to the shared module pool.
    /// @dev The DAO can reclaim released capacity only when current commitments and configured reserves remain valid.
    function setDaoBoostReleasedToModules(uint256 amount) external onlyOwner {
        uint256 allocation = daoBoostAllocation();
        if (amount + daoCommittedBoost > allocation) revert InvalidDaoBoostRelease();

        uint256 newModuleCap = baseModuleBoostAllocation() + amount;
        if (moduleBoostUsed() > newModuleCap) revert ReleasedDaoBoostInUse();
        _validateModuleCapacity(
            newModuleCap,
            _merchantEffectiveReserve(newModuleCap),
            _boostStakingEffectiveReserve(newModuleCap)
        );

        uint256 oldAmount = daoBoostReleasedToModules;
        daoBoostReleasedToModules = amount;
        emit DaoBoostReleasedToModulesSet(oldAmount, amount);
    }

    /// @notice Sets persistent reserve floors as portions of the entire shared module pool.
    /// @dev The two BPS values may reserve either, both, or neither module, but their sum cannot exceed 100%.
    function setModuleBoostReserveBps(uint256 merchantBps, uint256 stakingBps) external onlyOwner {
        if (merchantBps + stakingBps > BPS || merchantBps > type(uint16).max || stakingBps > type(uint16).max) {
            revert InvalidModuleReserveBps();
        }
        uint256 capacity = moduleBoostAllocation();
        uint256 merchantReserve = _max(
            Math.mulDiv(capacity, merchantBps, BPS), merchantAbsoluteBoostReserve
        );
        uint256 stakingReserve = _max(
            Math.mulDiv(capacity, stakingBps, BPS), boostStakingAbsoluteBoostReserve
        );
        _validateModuleCapacity(capacity, merchantReserve, stakingReserve);

        emit ModuleBoostReserveBpsSet(
            merchantReserveBps,
            boostStakingReserveBps,
            merchantBps,
            stakingBps
        );
        merchantReserveBps = uint16(merchantBps);
        boostStakingReserveBps = uint16(stakingBps);
    }

    /// @notice Permanently earmarks exact amounts from capacity that is currently free and unreserved.
    /// @dev Each input is an additional vlBoost amount. The resulting absolute floor starts above current use,
    ///      so the newly reserved amount protects future capacity instead of relabeling existing commitments.
    function reserveCurrentAvailableBoost(uint256 merchantAmount, uint256 stakingAmount) external onlyOwner {
        if (merchantAmount == 0 && stakingAmount == 0) revert ZeroAmount();
        if (merchantAmount + stakingAmount > currentUnreservedBoost()) revert InsufficientUnreservedBoost();

        uint256 capacity = moduleBoostAllocation();
        if (merchantAmount != 0) {
            merchantAbsoluteBoostReserve = _max(
                _max(merchantAbsoluteBoostReserve, merchantStandingBoostReserve()),
                boostMerchantBoostUsed()
            ) + merchantAmount;
        }
        if (stakingAmount != 0) {
            boostStakingAbsoluteBoostReserve = _max(
                _max(boostStakingAbsoluteBoostReserve, boostStakingStandingBoostReserve()),
                boostStakingBoostUsed()
            ) + stakingAmount;
        }
        _validateModuleCapacity(capacity, merchantBoostReserve(), boostStakingBoostReserve());
        emit CurrentAvailableBoostReserved(
            merchantAmount,
            stakingAmount,
            merchantAbsoluteBoostReserve,
            boostStakingAbsoluteBoostReserve
        );
    }

    /// @notice Releases exact amounts from the absolute reserve floors created from current available capacity.
    function releaseCurrentAvailableBoostReserve(uint256 merchantAmount, uint256 stakingAmount)
        external
        onlyOwner
    {
        if (merchantAmount == 0 && stakingAmount == 0) revert ZeroAmount();
        if (
            merchantAmount > merchantAbsoluteBoostReserve
                || stakingAmount > boostStakingAbsoluteBoostReserve
        ) revert InvalidAbsoluteReserveRelease();

        merchantAbsoluteBoostReserve -= merchantAmount;
        boostStakingAbsoluteBoostReserve -= stakingAmount;
        emit CurrentAvailableBoostReserveReleased(
            merchantAmount,
            stakingAmount,
            merchantAbsoluteBoostReserve,
            boostStakingAbsoluteBoostReserve
        );
    }

    function merchantStandingBoostReserve() public view returns (uint256) {
        return Math.mulDiv(moduleBoostAllocation(), merchantReserveBps, BPS);
    }

    function boostStakingStandingBoostReserve() public view returns (uint256) {
        return Math.mulDiv(moduleBoostAllocation(), boostStakingReserveBps, BPS);
    }

    function merchantBoostReserve() public view returns (uint256) {
        return _max(merchantStandingBoostReserve(), merchantAbsoluteBoostReserve);
    }

    function boostStakingBoostReserve() public view returns (uint256) {
        return _max(boostStakingStandingBoostReserve(), boostStakingAbsoluteBoostReserve);
    }

    /// @notice Maximum capacity the Merchant can access after preserving Boost Staking's reserve.
    function boostMerchantBoostCapacity() public view returns (uint256) {
        uint256 capacity = moduleBoostAllocation();
        uint256 reserve = boostStakingBoostReserve();
        return reserve >= capacity ? 0 : capacity - reserve;
    }

    /// @notice Maximum capacity Boost Staking can access after preserving the Merchant's reserve.
    function boostStakingBoostCapacity() public view returns (uint256) {
        uint256 capacity = moduleBoostAllocation();
        uint256 reserve = merchantBoostReserve();
        return reserve >= capacity ? 0 : capacity - reserve;
    }

    /// @notice Total module capacity that is free after live commitments, without assigning it to either module.
    function delegableBoost() public view returns (uint256 available) {
        uint256 capacity = moduleBoostAllocation();
        uint256 used = moduleBoostUsed();
        if (used >= capacity) return 0;
        available = capacity - used;
        uint256 rawAvailable = VLBOOST.delegableBalance(address(this));
        if (available > rawAvailable) available = rawAvailable;
    }

    /// @notice Merchant-accessible free capacity after protecting unused Boost Staking reserves.
    function boostMerchantDelegableBoost() public view returns (uint256 available) {
        available = delegableBoost();
        uint256 stakingReserve = boostStakingBoostReserve();
        uint256 stakingUsed = boostStakingBoostUsed();
        uint256 unusedStakingReserve = stakingReserve > stakingUsed ? stakingReserve - stakingUsed : 0;
        if (unusedStakingReserve >= available) return 0;
        available -= unusedStakingReserve;
    }

    /// @notice Boost-Staking-accessible free capacity after protecting unused Merchant reserves.
    function boostStakingDelegableBoost() public view returns (uint256 available) {
        available = delegableBoost();
        uint256 merchantReserve = merchantBoostReserve();
        uint256 merchantUsed = boostMerchantBoostUsed();
        uint256 unusedMerchantReserve = merchantReserve > merchantUsed ? merchantReserve - merchantUsed : 0;
        if (unusedMerchantReserve >= available) return 0;
        available -= unusedMerchantReserve;
    }

    /// @notice Capacity that remains free after subtracting both modules' unused protected reserves.
    function currentUnreservedBoost() public view returns (uint256 unreserved) {
        unreserved = delegableBoost();
        uint256 merchantReserve = merchantBoostReserve();
        uint256 merchantUsed = boostMerchantBoostUsed();
        uint256 stakingReserve = boostStakingBoostReserve();
        uint256 stakingUsed = boostStakingBoostUsed();
        uint256 protectedUnused = (merchantReserve > merchantUsed ? merchantReserve - merchantUsed : 0)
            + (stakingReserve > stakingUsed ? stakingReserve - stakingUsed : 0);
        if (protectedUnused >= unreserved) return 0;
        unreserved -= protectedUnused;
    }

    function delegateAdminBoost(uint256 amount, uint256 endtime, address recipient)
        external
        onlyAdmin
        nonReentrant
        returns (uint256 id)
    {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount > adminDelegableBoost()) revert AdminBoostAllocationExceeded();
        if (amount > type(uint128).max || endtime > type(uint64).max) revert ValueTooLarge();

        id = nextAdminBoostCommitmentId++;
        adminBoostCommitments[id] = DaoBoostCommitment(uint128(amount), uint64(endtime), true);
        adminCommittedBoost += amount;
        VLBOOST.boost(address(this), amount, endtime, recipient);
        emit AdminBoostDelegated(id, recipient, amount, endtime);
    }

    function releaseAdminBoostCommitment(uint256 id) external {
        DaoBoostCommitment storage commitment = adminBoostCommitments[id];
        if (!commitment.active) revert InvalidAdminBoostCommitment();
        if (block.timestamp < commitment.endtime) revert AdminBoostStillActive();
        commitment.active = false;
        adminCommittedBoost -= commitment.amount;
        emit AdminBoostCommitmentReleased(id, commitment.amount);
    }

    function delegateDaoBoost(uint256 amount, uint256 endtime, address recipient)
        external
        onlyOwner
        nonReentrant
        returns (uint256 id)
    {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (amount > daoDelegableBoost()) revert DaoBoostAllocationExceeded();
        id = _recordDaoBoost(amount, endtime, false);
        VLBOOST.boost(address(this), amount, endtime, recipient);
        emit BoostDelegated(msg.sender, recipient, amount, endtime);
    }

    function releaseDaoBoostCommitment(uint256 id) external {
        DaoBoostCommitment storage commitment = daoBoostCommitments[id];
        if (!commitment.active) revert InvalidDaoBoostCommitment();
        if (block.timestamp < commitment.endtime) revert DaoBoostStillActive();
        commitment.active = false;
        daoCommittedBoost -= commitment.amount;
        emit DaoBoostCommitmentReleased(id, commitment.amount);
    }

    function acceptDaoMarketplaceOffer(
        uint256 offerId,
        uint256 fillAmount,
        uint256 minTotalPayment,
        uint256 maxEffectiveDuration
    ) external onlyOwner nonReentrant returns (uint256 revenueAmount, uint256 commitmentId) {
        IBoostMarketplace.BuyOffer memory offer = BOOST_MARKETPLACE.getOffer(offerId);
        if (fillAmount == 0) revert ZeroAmount();
        if (fillAmount > daoDelegableBoost()) revert DaoBoostAllocationExceeded();

        uint256 beforeBalance = IERC20(offer.paymentToken).balanceOf(address(this));
        BOOST_MARKETPLACE.acceptOffer(offerId, fillAmount, minTotalPayment, maxEffectiveDuration);
        revenueAmount = IERC20(offer.paymentToken).balanceOf(address(this)) - beforeBalance;

        uint256 endtime = Math.ceilDiv(block.timestamp + uint256(offer.duration) * WEEK, WEEK) * WEEK;
        commitmentId = _recordDaoBoost(fillAmount, endtime, true);
        if (revenueAmount != 0) IERC20(offer.paymentToken).safeTransfer(treasuryReceiver, revenueAmount);
        emit DaoMarketplaceRevenue(offer.paymentToken, revenueAmount);
    }

    function setMarketplaceOperator(bool approved) external onlyOwner {
        VLBOOST.setOperator(address(BOOST_MARKETPLACE), approved);
        emit MarketplaceOperatorSet(approved);
    }

    function marketplaceCreateListing(
        uint256 amount,
        uint256 pricePerWeek,
        uint256 minDuration,
        uint256 maxDuration,
        address paymentToken,
        uint256 expiry
    ) external configured onlyMerchant returns (uint256 listingId) {
        if (amount == 0) revert ZeroAmount();
        if (amount > boostMerchantDelegableBoost()) revert InsufficientModuleBoostCapacity();
        listingId = BOOST_MARKETPLACE.createListing(
            amount,
            pricePerWeek,
            minDuration,
            maxDuration,
            paymentToken,
            expiry
        );
    }

    function marketplaceUpdateListing(uint256 listingId, uint256 newAmount, uint256 newPricePerWeek)
        external
        configured
        onlyMerchant
    {
        BOOST_MARKETPLACE.updateListing(listingId, newAmount, newPricePerWeek);
        if (boostMerchantBoostUsed() > boostMerchantBoostCapacity()) {
            revert InsufficientModuleBoostCapacity();
        }
    }

    function marketplaceCancelListing(uint256 listingId) external configured onlyMerchant {
        BOOST_MARKETPLACE.cancelListing(listingId);
    }

    function marketplaceAcceptOffer(
        uint256 offerId,
        uint256 fillAmount,
        uint256 minTotalPayment,
        uint256 maxEffectiveDuration,
        address paymentToken
    ) external nonReentrant configured onlyMerchant returns (uint256 revenueAmount) {
        if (fillAmount > boostMerchantDelegableBoost()) revert InsufficientModuleBoostCapacity();
        uint256 beforeBalance = IERC20(paymentToken).balanceOf(address(this));
        BOOST_MARKETPLACE.acceptOffer(
            offerId,
            fillAmount,
            minTotalPayment,
            maxEffectiveDuration
        );
        revenueAmount = IERC20(paymentToken).balanceOf(address(this)) - beforeBalance;
        _forwardRevenue(paymentToken, revenueAmount);
    }

    function forwardMarketplaceRevenue(address paymentToken)
        external
        nonReentrant
        configured
        returns (uint256 amount)
    {
        amount = IERC20(paymentToken).balanceOf(address(this));
        _forwardRevenue(paymentToken, amount);
    }

    function forwardMarketplaceRevenue(address paymentToken, uint256 amount)
        external
        nonReentrant
        configured
        onlyMerchant
    {
        _forwardRevenue(paymentToken, amount);
    }

    function requestEmergencyWithdrawal(uint256 amount)
        external
        nonReentrant
        configured
        returns (uint256 id, uint256 vlSdtRequestId)
    {
        if (emergencyWithdrawPermanentlyDisabled) revert EmergencyWithdrawDisabled();
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint128).max) revert ValueTooLarge();

        IERC20(address(CYVLSDT)).safeTransferFrom(msg.sender, address(this), amount);
        CYVLSDT.burn(amount);
        vlSdtRequestId = VLSDT.unstake(amount);

        id = nextEmergencyWithdrawalId++;
        emergencyWithdrawals[id] = EmergencyWithdrawal(msg.sender, uint128(amount), vlSdtRequestId, false);
        emit EmergencyWithdrawalRequested(id, msg.sender, amount, vlSdtRequestId);
    }

    function completeEmergencyWithdrawal(uint256 id, address receiver)
        external
        nonReentrant
        returns (uint256 amount)
    {
        if (receiver == address(0)) revert ZeroAddress();
        EmergencyWithdrawal storage request = emergencyWithdrawals[id];
        if (request.owner != msg.sender || request.completed || request.amount == 0) {
            revert InvalidEmergencyWithdrawal();
        }

        request.completed = true;
        amount = request.amount;
        uint256 beforeBalance = SDT.balanceOf(address(this));
        VLSDT.withdraw(request.vlSdtRequestId, address(this));
        uint256 received = SDT.balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert NonExactEmergencyWithdrawal(amount, received);
        SDT.safeTransfer(receiver, amount);
        emit EmergencyWithdrawalCompleted(id, msg.sender, receiver, amount);
    }

    function disableEmergencyWithdrawForever() external onlyOwner {
        if (emergencyWithdrawPermanentlyDisabled) revert EmergencyWithdrawDisabled();
        emergencyWithdrawPermanentlyDisabled = true;
        emit EmergencyWithdrawDisabledForever();
    }

    function _merchantEffectiveReserve(uint256 capacity) internal view returns (uint256) {
        return _max(Math.mulDiv(capacity, merchantReserveBps, BPS), merchantAbsoluteBoostReserve);
    }

    function _boostStakingEffectiveReserve(uint256 capacity) internal view returns (uint256) {
        return _max(Math.mulDiv(capacity, boostStakingReserveBps, BPS), boostStakingAbsoluteBoostReserve);
    }

    function _validateModuleCapacity(
        uint256 capacity,
        uint256 merchantReserve,
        uint256 stakingReserve
    ) internal view {
        if (merchantReserve + stakingReserve > capacity) revert InvalidModuleReserveConfiguration();
        if (boostMerchantBoostUsed() > capacity - stakingReserve) {
            revert InvalidModuleReserveConfiguration();
        }
        if (boostStakingBoostUsed() > capacity - merchantReserve) {
            revert InvalidModuleReserveConfiguration();
        }
    }

    function _max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    function _recordDaoBoost(uint256 amount, uint256 endtime, bool marketplaceSale)
        internal
        returns (uint256 id)
    {
        if (amount > type(uint128).max || endtime > type(uint64).max) revert ValueTooLarge();
        id = nextDaoBoostCommitmentId++;
        daoBoostCommitments[id] = DaoBoostCommitment(uint128(amount), uint64(endtime), true);
        daoCommittedBoost += amount;
        emit DaoBoostDelegated(id, address(0), amount, endtime, marketplaceSale);
    }

    function _forwardRevenue(address paymentToken, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        IERC20(paymentToken).forceApprove(revenueStaking, amount);
        ICurveYieldVlSDTRevenueStaking(revenueStaking).notifyReward(paymentToken, amount, 0);
        IERC20(paymentToken).forceApprove(revenueStaking, 0);
        emit MarketplaceRevenueForwarded(paymentToken, amount);
    }
}
