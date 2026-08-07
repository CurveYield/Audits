// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/**
 * @title CurveYield System Component
 * @notice CurveYield is a decentralized NGO building optimized DeFi systems for the good of all.
 * @custom:version 1
 * @custom:rehearsal Inert audit fixture only; not intended for production deployment.
 */
contract BasicERC20RehearsalV1 {
    string public constant name = "Deep Assurance Rehearsal Token";
    string public constant symbol = "DART";
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    error ZeroAddress(); error InsufficientBalance(); error InsufficientAllowance();
    constructor(uint256 initialSupply){ totalSupply=initialSupply; balanceOf[msg.sender]=initialSupply; emit Transfer(address(0),msg.sender,initialSupply); }
    function transfer(address to,uint256 amount) external returns(bool){ _transfer(msg.sender,to,amount); return true; }
    function approve(address spender,uint256 amount) external returns(bool){ if(spender==address(0)) revert ZeroAddress(); allowance[msg.sender][spender]=amount; emit Approval(msg.sender,spender,amount); return true; }
    function transferFrom(address from,address to,uint256 amount) external returns(bool){ uint256 a=allowance[from][msg.sender]; if(a<amount) revert InsufficientAllowance(); if(a!=type(uint256).max){ unchecked{allowance[from][msg.sender]=a-amount;} emit Approval(from,msg.sender,allowance[from][msg.sender]); } _transfer(from,to,amount); return true; }
    function _transfer(address from,address to,uint256 amount) internal { if(to==address(0)) revert ZeroAddress(); uint256 b=balanceOf[from]; if(b<amount) revert InsufficientBalance(); unchecked{balanceOf[from]=b-amount; balanceOf[to]+=amount;} emit Transfer(from,to,amount); }
}
