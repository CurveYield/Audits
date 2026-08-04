#!/usr/bin/env node
"use strict";

const fs = require("fs");

function read(file) { return fs.readFileSync(file, "utf8"); }
function requireText(file, fragments) {
  const source = read(file);
  for (const fragment of fragments) {
    if (!source.includes(fragment)) throw new Error(`${file} missing required fragment: ${fragment}`);
  }
}
function forbidText(file, fragments) {
  const source = read(file);
  for (const fragment of fragments) {
    if (source.includes(fragment)) throw new Error(`${file} contains forbidden fragment: ${fragment}`);
  }
}

requireText("contracts/CurveYieldVlSDTLocker.sol", [
  "function forwardMarketplaceRevenue(address paymentToken)",
  "amount = IERC20(paymentToken).balanceOf(address(this));",
  "_forwardRevenue(paymentToken, amount);",
  "ICurveYieldVlSDTRevenueStaking(revenueStaking).notifyReward(paymentToken, amount, 0)"
]);
forbidText("contracts/CurveYieldVlSDTLocker.sol", [
  "CurveYieldRevenueConverter",
  "revenueConverter"
]);
requireText("contracts/CurveYieldUsdcToSdtConverter.sol", [
  "contract CurveYieldUsdcToSdtConverter",
  "ROUTE_SLIPPAGE_BPS = 199",
  "TRICRYPTO_USDC.price_oracle(1)",
  "SDT_WETH_POOL.price_oracle()",
  "TRICRYPTO_USDC.exchange(0, 2, amountIn, minimumWeth, false, address(this))",
  "SDT_WETH_POOL.exchange(0, 1, wethReceived, effectiveMinimum, address(this))",
  "SDT.safeTransfer(receiver, amountOut)"
]);
forbidText("contracts/CurveYieldUsdcToSdtConverter.sol", [
  "LOCKER.deposit",
  "CYVLSDT"
]);
requireText("contracts/CurveYieldRevenueConverter.sol", [
  "usdcAdapter.quote(tokenIn, address(SDT), amountIn)",
  "uint256 sdtBefore = SDT.balanceOf(address(this));",
  "address(this)",
  "_convertSdt(sdtReceived, minimumAmountOut, recipient, deadline)",
  "amountOut = LOCKER.deposit(amountIn, recipient)"
]);
requireText("deployment-v18/simulate-marketplace-revenue-cycle-v18.9.js", [
  "CurveYieldUsdcToSdtConverter",
  "forwardMarketplaceRevenue(address)",
  "Revenue Staking received no USDC",
  "RevenueConverter balance changed during forwarding",
  "Revenue Strategy harvest"
]);
console.log("Minimal marketplace-route source checks passed.");
