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

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract CurveYieldVlSDTToken is ERC20, ERC20Burnable, Ownable2Step {
    address public locker;

    error ZeroAddress();
    error LockerAlreadySet();
    error OnlyLocker();

    event LockerSet(address indexed locker);

    constructor(address initialOwner_) ERC20("CurveYield vlSDT", "cyvlSDT") Ownable(initialOwner_) {
        if (initialOwner_ == address(0)) revert ZeroAddress();
    }

    function setLocker(address locker_) external onlyOwner {
        if (locker != address(0)) revert LockerAlreadySet();
        if (locker_ == address(0) || locker_.code.length == 0) revert ZeroAddress();
        locker = locker_;
        emit LockerSet(locker_);
    }

    function mint(address receiver, uint256 amount) external {
        if (msg.sender != locker) revert OnlyLocker();
        _mint(receiver, amount);
    }
}
