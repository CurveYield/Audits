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

interface IMintableCyvlV17 { function mint(address receiver, uint256 amount) external; }

contract MockLockerForCompounderV17 {
    IERC20 public immutable SDT;
    IMintableCyvlV17 public immutable CYVLSDT;
    uint256 public deposits;
    constructor(address sdt_, address cyvlSdt_) { SDT = IERC20(sdt_); CYVLSDT = IMintableCyvlV17(cyvlSdt_); }
    function deposit(uint256 amount, address receiver) external returns (uint256) {
        SDT.transferFrom(msg.sender, address(this), amount);
        CYVLSDT.mint(receiver, amount);
        deposits += amount;
        return amount;
    }
    function delegateBoost(uint256, uint256, address) external {}
    function totalVlSDT() external pure returns (uint256) { return 0; }
    function delegableBoost() external pure returns (uint256) { return 0; }
    function marketplaceCreateListing(uint256,uint256,uint256,uint256,address,uint256) external pure returns(uint256){return 1;}
    function marketplaceUpdateListing(uint256,uint256,uint256) external {}
    function marketplaceCancelListing(uint256) external {}
    function marketplaceAcceptOffer(uint256,uint256,uint256,uint256,address) external pure returns(uint256){return 0;}
}
