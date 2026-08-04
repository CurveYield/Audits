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
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockVlSDTV17 is ERC20 {
    IERC20 public immutable SDT;
    uint256 public nextRequestId = 1;
    mapping(uint256 => uint256) public unstakeAmount;
    mapping(uint256 => address) public unstakeOwner;
    constructor(address sdt_) ERC20("Mock vlSDT", "mvlSDT") { SDT = IERC20(sdt_); }
    function stake(uint256 amount, address recipient) external {
        SDT.transferFrom(msg.sender, address(this), amount);
        _mint(recipient, amount);
    }
    function unstake(uint256 amount) external returns (uint256 id) {
        _burn(msg.sender, amount);
        id = nextRequestId++;
        unstakeAmount[id] = amount;
        unstakeOwner[id] = msg.sender;
    }
    function withdraw(uint256 id, address recipient) external {
        require(unstakeOwner[id] == msg.sender, "owner");
        uint256 amount = unstakeAmount[id];
        require(amount != 0, "request");
        delete unstakeAmount[id];
        delete unstakeOwner[id];
        SDT.transfer(recipient, amount);
    }
}
