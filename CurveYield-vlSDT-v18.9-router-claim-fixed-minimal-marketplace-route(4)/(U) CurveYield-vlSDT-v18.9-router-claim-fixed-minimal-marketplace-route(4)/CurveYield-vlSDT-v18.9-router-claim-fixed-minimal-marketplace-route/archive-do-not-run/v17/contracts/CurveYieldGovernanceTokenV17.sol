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
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract CurveYieldGovernanceTokenV17 is ERC20, ERC20Capped, Ownable2Step {
    uint256 public constant CAP = 1_000_000_000_000 ether;

    mapping(address => bool) public isMinter;

    error ZeroAddress();
    error UnauthorizedMinter();

    event MinterSet(address indexed minter, bool allowed);

    constructor(address initialOwner_, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        ERC20Capped(CAP)
        Ownable(initialOwner_)
    {
        if (initialOwner_ == address(0)) revert ZeroAddress();
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        _setMinter(minter, allowed);
    }

    function setMinters(address[] calldata minters, bool allowed) external onlyOwner {
        uint256 length = minters.length;
        for (uint256 i; i < length;) {
            _setMinter(minters[i], allowed);
            unchecked { ++i; }
        }
    }

    function _setMinter(address minter, bool allowed) internal {
        if (minter == address(0)) revert ZeroAddress();
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function mint(address receiver, uint256 amount) external {
        if (msg.sender != owner() && !isMinter[msg.sender]) revert UnauthorizedMinter();
        _mint(receiver, amount);
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }

    function remainingMintableSupply() external view returns (uint256) {
        return CAP - totalSupply();
    }
}
