// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMintableTricryptoToken {
    function mint(address receiver, uint256 amount) external;
}

contract MockTricryptoUsdcPool {
    address[3] internal _coins;
    uint256 public oraclePrice;
    uint256 public nextDy;
    uint256 public lastI;
    uint256 public lastJ;
    uint256 public lastDx;
    uint256 public lastMinDy;
    bool public lastUseEth;
    address public lastReceiver;

    constructor(address coin0_, address coin1_, address coin2_) {
        _coins = [coin0_, coin1_, coin2_];
    }

    function coins(uint256 index) external view returns (address) { return _coins[index]; }
    function setPriceOracle(uint256 value) external { oraclePrice = value; }
    function setNextDy(uint256 value) external { nextDy = value; }
    function price_oracle(uint256 index) external view returns (uint256) {
        require(index == 1, "wrong oracle index");
        return oraclePrice;
    }

    function exchange(
        uint256 i,
        uint256 j,
        uint256 dx,
        uint256 minDy,
        bool useEth,
        address receiver
    ) external returns (uint256 amountOut) {
        require(i == 0 && j == 2, "wrong indices");
        require(!useEth, "native output");
        amountOut = nextDy;
        require(amountOut >= minDy, "minimum");
        IERC20(_coins[0]).transferFrom(msg.sender, address(this), dx);
        IMintableTricryptoToken(_coins[2]).mint(receiver, amountOut);
        lastI = i;
        lastJ = j;
        lastDx = dx;
        lastMinDy = minDy;
        lastUseEth = useEth;
        lastReceiver = receiver;
    }
}
