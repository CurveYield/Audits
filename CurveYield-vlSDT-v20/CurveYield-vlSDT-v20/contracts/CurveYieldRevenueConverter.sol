// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ICurveYieldVlSDTLocker} from "./interfaces/ICurveYield.sol";
import {ICurveYieldRevenueConverter} from "./interfaces/ICurveYieldRevenueConverter.sol";
import {ICompounderAdapter} from "./interfaces/ICompounderAdapter.sol";

/// @notice Route-extensible revenue converter used by the Beefy-style Revenue Strategy.
/// @dev SDT can always be deposited through the Locker one-for-one. Optional SDT market and
///      USDC routes can be enabled or replaced immediately by the owner without a waiting period.
contract CurveYieldRevenueConverter is ICurveYieldRevenueConverter, Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable SDT;
    IERC20 public immutable CYVLSDT;
    ICurveYieldVlSDTLocker public immutable LOCKER;

    ICompounderAdapter public sdtSwapAdapter;
    IERC20 public usdc;
    ICompounderAdapter public usdcAdapter;

    error ZeroAddress();
    error InvalidAdapter();
    error UnsupportedToken();
    error Expired();
    error ZeroAmount();
    error InsufficientOutput(uint256 minimum, uint256 actual);

    event SdtSwapAdapterSet(address indexed adapter);
    event UsdcRouteSet(address indexed usdc, address indexed adapter);

    constructor(address initialOwner_, address sdt_, address cyvlSdt_, address locker_)
        Ownable(initialOwner_)
    {
        if (
            initialOwner_ == address(0) || sdt_ == address(0) || cyvlSdt_ == address(0)
                || locker_ == address(0)
        ) revert ZeroAddress();
        SDT = IERC20(sdt_);
        CYVLSDT = IERC20(cyvlSdt_);
        LOCKER = ICurveYieldVlSDTLocker(locker_);
    }

    function outputToken() external view returns (address) {
        return address(CYVLSDT);
    }

    /// @notice Enables, replaces, or disables the optional SDT market route immediately.
    /// @dev A zero adapter disables the market route and leaves Locker deposit as the SDT route.
    function setSdtSwapAdapter(address adapter) external onlyOwner {
        if (adapter != address(0) && adapter.code.length == 0) revert InvalidAdapter();
        sdtSwapAdapter = ICompounderAdapter(adapter);
        emit SdtSwapAdapterSet(adapter);
    }

    /// @notice Enables, replaces, or disables the USDC route immediately.
    /// @dev Both values must be zero to disable; both must be valid to enable.
    function setUsdcRoute(address usdc_, address adapter) external onlyOwner {
        if ((usdc_ == address(0)) != (adapter == address(0))) revert ZeroAddress();
        if (adapter != address(0) && adapter.code.length == 0) revert InvalidAdapter();
        usdc = IERC20(usdc_);
        usdcAdapter = ICompounderAdapter(adapter);
        emit UsdcRouteSet(usdc_, adapter);
    }

    function supportsToken(address tokenIn) external view returns (bool) {
        if (tokenIn == address(SDT)) return true;
        return tokenIn != address(0) && tokenIn == address(usdc) && address(usdcAdapter) != address(0);
    }

    function quote(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        if (tokenIn == address(SDT)) return _quoteSdt(amountIn);
        if (tokenIn == address(usdc) && address(usdcAdapter) != address(0)) {
            try usdcAdapter.quote(tokenIn, address(SDT), amountIn) returns (uint256 quoted) {
                return quoted;
            } catch {
                return 0;
            }
        }
        return 0;
    }

    function convert(
        address tokenIn,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external returns (uint256 amountOut) {
        if (recipient == address(0)) revert ZeroAddress();
        if (amountIn == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert Expired();

        if (tokenIn == address(SDT)) {
            SDT.safeTransferFrom(msg.sender, address(this), amountIn);
            amountOut = _convertSdt(amountIn, minimumAmountOut, recipient, deadline);
        } else if (tokenIn == address(usdc) && address(usdcAdapter) != address(0)) {
            IERC20 input = usdc;
            input.safeTransferFrom(msg.sender, address(this), amountIn);
            input.forceApprove(address(usdcAdapter), amountIn);
            uint256 sdtBefore = SDT.balanceOf(address(this));
            usdcAdapter.swap(
                tokenIn,
                address(SDT),
                amountIn,
                minimumAmountOut,
                address(this),
                deadline
            );
            input.forceApprove(address(usdcAdapter), 0);
            uint256 sdtReceived = SDT.balanceOf(address(this)) - sdtBefore;
            if (sdtReceived < minimumAmountOut) {
                revert InsufficientOutput(minimumAmountOut, sdtReceived);
            }
            amountOut = _convertSdt(sdtReceived, minimumAmountOut, recipient, deadline);
        } else {
            revert UnsupportedToken();
        }

        if (amountOut < minimumAmountOut) revert InsufficientOutput(minimumAmountOut, amountOut);
    }

    function _quoteSdt(uint256 amountIn) internal view returns (uint256 amountOut) {
        amountOut = amountIn;
        ICompounderAdapter adapter = sdtSwapAdapter;
        if (address(adapter) == address(0)) return amountOut;
        try adapter.quote(address(SDT), address(CYVLSDT), amountIn) returns (uint256 quoted) {
            if (quoted > amountOut) amountOut = quoted;
        } catch {}
    }

    function _convertSdt(
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        ICompounderAdapter adapter = sdtSwapAdapter;
        uint256 marketQuote;
        if (address(adapter) != address(0)) {
            try adapter.quote(address(SDT), address(CYVLSDT), amountIn) returns (uint256 quoted) {
                marketQuote = quoted;
            } catch {}
        }

        if (marketQuote > amountIn && marketQuote >= minimumAmountOut) {
            SDT.forceApprove(address(adapter), amountIn);
            amountOut = adapter.swap(
                address(SDT),
                address(CYVLSDT),
                amountIn,
                minimumAmountOut,
                recipient,
                deadline
            );
            SDT.forceApprove(address(adapter), 0);
            return amountOut;
        }

        SDT.forceApprove(address(LOCKER), amountIn);
        amountOut = LOCKER.deposit(amountIn, recipient);
        SDT.forceApprove(address(LOCKER), 0);
    }
}
