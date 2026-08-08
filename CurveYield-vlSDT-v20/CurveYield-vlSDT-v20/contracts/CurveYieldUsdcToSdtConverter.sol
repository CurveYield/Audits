// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICompounderAdapter} from "./interfaces/ICompounderAdapter.sol";
import {
    ICurveTricryptoUsdcPool,
    ICurveTwoCryptoPool
} from "./interfaces/ICurveCryptoPools.sol";

/// @notice Fixed USDC -> wrapped WETH -> SDT adapter for CurveYieldRevenueConverter.
/// @dev The adapter returns SDT to the central RevenueConverter. The central converter then uses
///      its existing SDT path to mint cyvlSDT through the Locker for the compounder strategy.
contract CurveYieldUsdcToSdtConverter is ICompounderAdapter {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant ROUTE_SLIPPAGE_BPS = 199;
    uint256 internal constant USDC_TO_WAD_SCALE = 1e12;
    uint256 internal constant WAD = 1e18;

    address public immutable REVENUE_CONVERTER;
    IERC20 public immutable USDC;
    IERC20 public immutable WBTC;
    IERC20 public immutable WETH;
    IERC20 public immutable SDT;
    ICurveTricryptoUsdcPool public immutable TRICRYPTO_USDC;
    ICurveTwoCryptoPool public immutable SDT_WETH_POOL;

    error ZeroAddress();
    error OnlyRevenueConverter();
    error InvalidPair(address tokenIn, address tokenOut);
    error Expired();
    error ZeroAmount();
    error InvalidReceiver();
    error InvalidPoolCoins();
    error InvalidOracle();
    error InsufficientOutput(uint256 minimum, uint256 actual);

    constructor(
        address revenueConverter_,
        address usdc_,
        address wbtc_,
        address weth_,
        address sdt_,
        address tricryptoUsdc_,
        address sdtWethPool_
    ) {
        if (
            revenueConverter_ == address(0) || usdc_ == address(0) || wbtc_ == address(0)
                || weth_ == address(0) || sdt_ == address(0) || tricryptoUsdc_ == address(0)
                || sdtWethPool_ == address(0)
        ) revert ZeroAddress();

        REVENUE_CONVERTER = revenueConverter_;
        USDC = IERC20(usdc_);
        WBTC = IERC20(wbtc_);
        WETH = IERC20(weth_);
        SDT = IERC20(sdt_);
        TRICRYPTO_USDC = ICurveTricryptoUsdcPool(tricryptoUsdc_);
        SDT_WETH_POOL = ICurveTwoCryptoPool(sdtWethPool_);

        if (
            TRICRYPTO_USDC.coins(0) != usdc_ || TRICRYPTO_USDC.coins(1) != wbtc_
                || TRICRYPTO_USDC.coins(2) != weth_ || SDT_WETH_POOL.coins(0) != weth_
                || SDT_WETH_POOL.coins(1) != sdt_
        ) revert InvalidPoolCoins();
    }

    /// @notice Returns the executable minimum SDT output after one 199-bps route-level haircut.
    function quote(address tokenIn, address tokenOut, uint256 amountIn)
        external
        view
        override
        returns (uint256 amountOut)
    {
        _validatePair(tokenIn, tokenOut);
        if (amountIn == 0) return 0;
        uint256 oracleAmount = _oracleQuote(amountIn);
        amountOut = Math.mulDiv(oracleAmount, BPS - ROUTE_SLIPPAGE_BPS, BPS);
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address receiver,
        uint256 deadline
    ) external override returns (uint256 amountOut) {
        if (msg.sender != REVENUE_CONVERTER) revert OnlyRevenueConverter();
        _validatePair(tokenIn, tokenOut);
        if (block.timestamp > deadline) revert Expired();
        if (amountIn == 0) revert ZeroAmount();
        if (receiver != REVENUE_CONVERTER) revert InvalidReceiver();

        uint256 oracleMinimum = Math.mulDiv(
            _oracleQuote(amountIn),
            BPS - ROUTE_SLIPPAGE_BPS,
            BPS
        );
        uint256 effectiveMinimum = minimumAmountOut > oracleMinimum
            ? minimumAmountOut
            : oracleMinimum;

        uint256 wethPerSdt = SDT_WETH_POOL.price_oracle();
        if (wethPerSdt == 0) revert InvalidOracle();
        uint256 minimumWeth = Math.mulDiv(
            effectiveMinimum,
            wethPerSdt,
            WAD,
            Math.Rounding.Ceil
        );

        USDC.safeTransferFrom(msg.sender, address(this), amountIn);
        USDC.forceApprove(address(TRICRYPTO_USDC), amountIn);
        uint256 wethBefore = WETH.balanceOf(address(this));
        TRICRYPTO_USDC.exchange(0, 2, amountIn, minimumWeth, false, address(this));
        USDC.forceApprove(address(TRICRYPTO_USDC), 0);
        uint256 wethReceived = WETH.balanceOf(address(this)) - wethBefore;
        if (wethReceived < minimumWeth) revert InsufficientOutput(minimumWeth, wethReceived);

        WETH.forceApprove(address(SDT_WETH_POOL), wethReceived);
        uint256 sdtBefore = SDT.balanceOf(address(this));
        SDT_WETH_POOL.exchange(0, 1, wethReceived, effectiveMinimum, address(this));
        WETH.forceApprove(address(SDT_WETH_POOL), 0);
        amountOut = SDT.balanceOf(address(this)) - sdtBefore;
        if (amountOut < effectiveMinimum) {
            revert InsufficientOutput(effectiveMinimum, amountOut);
        }

        SDT.safeTransfer(receiver, amountOut);
    }

    function _oracleQuote(uint256 amountIn) internal view returns (uint256 amountOut) {
        uint256 wethPriceInUsdc = TRICRYPTO_USDC.price_oracle(1);
        uint256 wethPerSdt = SDT_WETH_POOL.price_oracle();
        if (wethPriceInUsdc == 0 || wethPerSdt == 0) revert InvalidOracle();

        uint256 expectedWeth = Math.mulDiv(
            amountIn,
            USDC_TO_WAD_SCALE * WAD,
            wethPriceInUsdc
        );
        amountOut = Math.mulDiv(expectedWeth, WAD, wethPerSdt);
    }

    function _validatePair(address tokenIn, address tokenOut) internal view {
        if (tokenIn != address(USDC) || tokenOut != address(SDT)) {
            revert InvalidPair(tokenIn, tokenOut);
        }
    }
}
