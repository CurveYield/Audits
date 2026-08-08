// SPDX-License-Identifier: UNLICENSED
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
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ICurveYieldStrategy} from "./interfaces/ICurveYieldStrategy.sol";

interface IYieldBoostingTokenReceiver {
    function donateYieldBoostingTokens(uint256 pid, uint256 amount) external;
}

contract CurveYieldVaultV7 is ERC20, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CONFIG_CHANGE_DELAY = 10 days;
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint16 public constant MAX_WITHDRAW_FEE_BPS = 150;

    ICurveYieldStrategy public strategy;
    uint256 public ownershipTransferReadyAt;
    bool public ownershipTransferDelayInitialized;
    uint8 private immutable vaultDecimals;
    uint16 public withdrawFeeBps;
    address public withdrawFeeReceiver;
    uint256 public withdrawFeeBoostHubPid;
    uint16 public pendingWithdrawFeeBps;
    address public pendingWithdrawFeeReceiver;
    uint256 public pendingWithdrawFeeBoostHubPid;
    uint256 public pendingWithdrawFeeReadyAt;
    bool public withdrawFeeDelayInitialized;
    bool public pendingWithdrawFeeSet;

    constructor(string memory name_, string memory symbol_, address owner_, uint8 decimals_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        if (owner_ == address(0)) revert ZeroAddress();
        vaultDecimals = decimals_;
    }

    error ZeroAddress();
    error ZeroAmount();
    error InvalidStrategy();
    error StrategyAlreadySet();
    error StrategyNotSet();
    error NoShares();
    error TimelockNotReady();
    error InvalidFee();
    error NoPendingChange();

    event WithdrawFeeConfigSet(uint16 withdrawFeeBps, address indexed receiver, uint256 boostHubPid);
    event WithdrawFeeConfigQueued(uint16 withdrawFeeBps, address indexed receiver, uint256 boostHubPid, uint256 readyAt);

    function decimals() public view override returns (uint8) {
        return vaultDecimals;
    }

    function _assetDecimals() internal view returns (uint8) {
        try IERC20Metadata(address(want())).decimals() returns (uint8 assetDecimals) {
            return assetDecimals;
        } catch {
            return vaultDecimals;
        }
    }

    function _assetsToShares(uint256 assets) internal view returns (uint256) {
        uint8 assetDecimals = _assetDecimals();
        if (vaultDecimals == assetDecimals) return assets;
        if (vaultDecimals > assetDecimals) {
            return assets * 10 ** uint256(vaultDecimals - assetDecimals);
        }
        return assets / 10 ** uint256(assetDecimals - vaultDecimals);
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        super.transferOwnership(newOwner);
        if (!ownershipTransferDelayInitialized) {
            ownershipTransferDelayInitialized = true;
            ownershipTransferReadyAt = 0;
        } else {
            ownershipTransferReadyAt = newOwner == address(0) ? 0 : block.timestamp + CONFIG_CHANGE_DELAY;
        }
    }

    function acceptOwnership() public override {
        if (block.timestamp < ownershipTransferReadyAt) revert TimelockNotReady();
        super.acceptOwnership();
        ownershipTransferReadyAt = 0;
    }

    function setStrategy(ICurveYieldStrategy strategy_) external onlyOwner {
        _setStrategy(strategy_);
    }

    function setWithdrawFeeConfig(uint16 withdrawFeeBps_, address receiver, uint256 boostHubPid) external onlyOwner {
        _setWithdrawFeeConfig(withdrawFeeBps_, receiver, boostHubPid);
    }

    function setInitialVaultConfig(
        ICurveYieldStrategy strategy_,
        uint16 withdrawFeeBps_,
        address receiver,
        uint256 boostHubPid
    ) external onlyOwner {
        _setStrategy(strategy_);
        _setWithdrawFeeConfig(withdrawFeeBps_, receiver, boostHubPid);
    }

    function _setStrategy(ICurveYieldStrategy strategy_) internal {
        if (address(strategy) != address(0)) revert StrategyAlreadySet();
        if (address(strategy_) == address(0)) revert ZeroAddress();
        if (strategy_.vault() != address(this)) revert InvalidStrategy();
        strategy = strategy_;
    }

    function _setWithdrawFeeConfig(uint16 withdrawFeeBps_, address receiver, uint256 boostHubPid) internal {
        if (withdrawFeeBps_ > MAX_WITHDRAW_FEE_BPS) revert InvalidFee();
        if (withdrawFeeBps_ > 0 && receiver == address(0)) revert ZeroAddress();

        if (!withdrawFeeDelayInitialized) {
            withdrawFeeDelayInitialized = true;
            withdrawFeeBps = withdrawFeeBps_;
            withdrawFeeReceiver = receiver;
            withdrawFeeBoostHubPid = boostHubPid;
            emit WithdrawFeeConfigSet(withdrawFeeBps_, receiver, boostHubPid);
        } else {
            pendingWithdrawFeeBps = withdrawFeeBps_;
            pendingWithdrawFeeReceiver = receiver;
            pendingWithdrawFeeBoostHubPid = boostHubPid;
            pendingWithdrawFeeReadyAt = block.timestamp + CONFIG_CHANGE_DELAY;
            pendingWithdrawFeeSet = true;
            emit WithdrawFeeConfigQueued(withdrawFeeBps_, receiver, boostHubPid, pendingWithdrawFeeReadyAt);
        }
    }

    function applyWithdrawFeeConfig() external {
        if (!pendingWithdrawFeeSet) revert NoPendingChange();
        if (block.timestamp < pendingWithdrawFeeReadyAt) revert TimelockNotReady();

        withdrawFeeBps = pendingWithdrawFeeBps;
        withdrawFeeReceiver = pendingWithdrawFeeReceiver;
        withdrawFeeBoostHubPid = pendingWithdrawFeeBoostHubPid;
        delete pendingWithdrawFeeBps;
        delete pendingWithdrawFeeReceiver;
        delete pendingWithdrawFeeBoostHubPid;
        delete pendingWithdrawFeeReadyAt;
        delete pendingWithdrawFeeSet;
        emit WithdrawFeeConfigSet(withdrawFeeBps, withdrawFeeReceiver, withdrawFeeBoostHubPid);
    }

    function want() public view returns (IERC20) {
        ICurveYieldStrategy activeStrategy = strategy;
        if (address(activeStrategy) == address(0)) revert StrategyNotSet();
        return IERC20(activeStrategy.want());
    }

    function balance() public view returns (uint256) {
        return want().balanceOf(address(this)) + strategy.balanceOf();
    }

    function available() public view returns (uint256) {
        return want().balanceOf(address(this));
    }

    function getPricePerFullShare() public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? 1e18 : _assetsToShares(balance()) * 1e18 / supply;
    }

    function estimatedTokenAprBps() external view returns (uint256) {
        ICurveYieldStrategy activeStrategy = strategy;
        if (address(activeStrategy) == address(0)) return 0;
        return activeStrategy.estimatedTokenAprBps();
    }

    function depositAll() external {
        deposit(want().balanceOf(msg.sender));
    }

    function deposit(uint256 amount) public nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();

        strategy.beforeDeposit();

        uint256 pool = balance();
        want().safeTransferFrom(msg.sender, address(this), amount);
        earn();
        uint256 afterBalance = balance();
        amount = afterBalance - pool;

        uint256 shares = totalSupply() == 0 ? _assetsToShares(amount) : amount * totalSupply() / pool;
        if (shares == 0) revert NoShares();
        _mint(msg.sender, shares);
    }

    function earn() public whenNotPaused {
        uint256 bal = available();
        if (bal == 0) return;
        want().safeTransfer(address(strategy), bal);
        strategy.deposit();
    }

    function withdrawAll() external {
        withdraw(balanceOf(msg.sender));
    }

    function withdraw(uint256 shares) public nonReentrant {
        if (shares == 0) revert ZeroAmount();

        uint256 amount = balance() * shares / totalSupply();
        _burn(msg.sender, shares);

        uint256 bal = want().balanceOf(address(this));
        if (bal < amount) {
            uint256 withdrawAmount = amount - bal;
            strategy.withdraw(withdrawAmount);
            uint256 afterBalance = want().balanceOf(address(this));
            uint256 diff = afterBalance - bal;
            if (diff < withdrawAmount) {
                amount = bal + diff;
            }
        }

        uint256 fee = amount * withdrawFeeBps / FEE_DENOMINATOR;
        if (fee > 0) {
            amount -= fee;
            _sendWithdrawFee(fee);
        }

        want().safeTransfer(msg.sender, amount);
    }

    function _sendWithdrawFee(uint256 fee) internal {
        IERC20 wantToken = want();
        address receiver = withdrawFeeReceiver;
        if (receiver == address(0)) revert ZeroAddress();

        if (receiver.code.length != 0) {
            wantToken.forceApprove(receiver, fee);
            try IYieldBoostingTokenReceiver(receiver).donateYieldBoostingTokens(withdrawFeeBoostHubPid, fee) {
                wantToken.forceApprove(receiver, 0);
                return;
            } catch {
                wantToken.forceApprove(receiver, 0);
            }
        }

        wantToken.safeTransfer(receiver, fee);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
        earn();
    }

    function inCaseTokensGetStuck(address token) external onlyOwner {
        if (token == address(want())) revert InvalidStrategy();
        IERC20(token).safeTransfer(msg.sender, IERC20(token).balanceOf(address(this)));
    }
}
