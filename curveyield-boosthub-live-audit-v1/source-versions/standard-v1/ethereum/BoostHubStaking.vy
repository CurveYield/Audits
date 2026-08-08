# @version 0.2.8
"""
@title BoostHub Staking
@author Curve Finance, modified for CurveYield
@license UNLICENSED
@title CurveYield System Component
@notice CurveYield is a decentralized NGO building optimized DeFi systems for the good of all.

@dev CurveYield integrates specialized AMM infrastructure, tokenized yield strategies, credit
markets, and protocol-owned liquidity into a unified, capital-efficient liquidity stack governed
by an open, international DAO community.

Protocol operations are enhanced by cross-chain bridging and messaging, MEV capture systems,
off-chain to on-chain automation, and peer-to-peer data networks.

This contract is one component of the CurveYield system.

CurveYield uses proven DeFi primitives where possible and adds targeted coordination and
capital-efficiency-enhancing contracts where needed. Users and integrators must review
CurveYield documentation before use.

Learn more:
Documentation: https://docs.curveyield.com
dApp: https://curveyield.online
GitHub: https://github.com/curveyield

Decentralized links may have limited or delayed availability during periods of high network activity:
https://curveyield.eth.limo
https://curveyield.dao

Note: curveyield.dao may require a Brave Browser or an Unstoppable Domains browser plugin to use.

@notice Derived from Curve LiquidityGaugeV2.vy. This keeps the ERC20
        receipt-token and reward-integral core, removes CRV emissions,
        gauge controller, voting escrow, working balances, boost accounting,
        arbitrary reward distributors, swapping, and compounding.
"""

from vyper.interfaces import ERC20

implements: ERC20


interface ERC20Extended:
    def decimals() -> uint256: view


interface BoostHub:
    def isRewardToken(pid: uint256, rewardToken: address) -> bool: view


event Deposit:
    provider: indexed(address)
    value: uint256

event Withdraw:
    provider: indexed(address)
    value: uint256

event Transfer:
    _from: indexed(address)
    _to: indexed(address)
    _value: uint256

event Approval:
    _owner: indexed(address)
    _spender: indexed(address)
    _value: uint256

event AddReward:
    reward_token: indexed(address)

event Harvest:
    reward_token: indexed(address)
    amount: uint256

event SetWithdrawFee:
    fee_bps: uint256

event SetFeeReceiver:
    fee_receiver: address

event SetPerformanceFee:
    fee_bps: uint256
    fee_receiver: address

event QueueFeeConfig:
    fee_bps: uint256
    fee_receiver: address
    ready_at: uint256

event CommitOwnership:
    admin: address

event ApplyOwnership:
    admin: address


MAX_REWARDS: constant(uint256) = 8
OWNERSHIP_DELAY: constant(uint256) = 10 * 86400
REWARDS_DURATION: constant(uint256) = 14 * 86400
FEE_CHANGE_DELAY: constant(uint256) = 3 * 86400
FEE_DENOMINATOR: constant(uint256) = 10000
MAX_WITHDRAW_FEE_BPS: constant(uint256) = 1000
MAX_PERFORMANCE_FEE_BPS: constant(uint256) = 2000

lp_token: public(address)
boost_hub: public(address)
pid: public(uint256)

balanceOf: public(HashMap[address, uint256])
totalSupply: public(uint256)
allowances: HashMap[address, HashMap[address, uint256]]

name: public(String[64])
symbol: public(String[34])

# caller -> recipient -> can deposit?
approved_to_deposit: public(HashMap[address, HashMap[address, bool]])

reward_tokens: public(address[MAX_REWARDS])
reward_integral: public(HashMap[address, uint256])
reward_integral_for: public(HashMap[address, HashMap[address, uint256]])
reward_rate: public(HashMap[address, uint256])
reward_period_finish: public(HashMap[address, uint256])
reward_last_update: public(HashMap[address, uint256])
claim_data: HashMap[address, HashMap[address, uint256]]

admin: public(address)
future_admin: public(address)
future_admin_deadline: public(uint256)
ownership_delay_initialized: public(bool)
withdraw_fee_bps: public(uint256)
fee_receiver: public(address)
performance_fee_bps: public(uint256)
performance_fee_receiver: public(address)
fee_config_locked: public(bool)
pending_withdraw_fee_bps: public(uint256)
pending_fee_receiver: public(address)
pending_fee_ready_at: public(uint256)
pending_fee_config: public(bool)


@external
def __init__(
    _lp_token: address,
    _boost_hub: address,
    _pid: uint256,
    _admin: address,
    _name: String[64],
    _symbol: String[34],
    _reward_tokens: address[MAX_REWARDS],
    _withdraw_fee_bps: uint256,
    _fee_receiver: address,
    _performance_fee_bps: uint256,
    _performance_fee_receiver: address,
):
    """
    @notice Contract constructor
    @param _lp_token Token deposited into this staking contract
    @param _boost_hub BoostHub contract where deposits are forwarded
    @param _pid BoostHub pool id
    @param _admin Admin allowed to add known reward tokens and transfer ownership
    @param _reward_tokens Fixed-size reward-token seed list, padded with zero addresses
    @param _withdraw_fee_bps Initial principal withdrawal fee in basis points
    @param _fee_receiver Initial withdrawal fee receiver
    @param _performance_fee_bps Initial reward performance fee in basis points
    @param _performance_fee_receiver Initial reward performance fee receiver
    """
    assert _lp_token != ZERO_ADDRESS
    assert _boost_hub != ZERO_ADDRESS
    assert _admin != ZERO_ADDRESS
    assert _fee_receiver != ZERO_ADDRESS
    assert _performance_fee_receiver != ZERO_ADDRESS
    assert _withdraw_fee_bps <= MAX_WITHDRAW_FEE_BPS
    assert _performance_fee_bps <= MAX_PERFORMANCE_FEE_BPS
    assert len(_name) != 0
    assert len(_symbol) != 0

    self.name = _name
    self.symbol = _symbol

    self.lp_token = _lp_token
    self.boost_hub = _boost_hub
    self.pid = _pid
    self.admin = _admin
    self.withdraw_fee_bps = _withdraw_fee_bps
    self.fee_receiver = _fee_receiver
    self.performance_fee_bps = _performance_fee_bps
    self.performance_fee_receiver = _performance_fee_receiver
    self.fee_config_locked = True

    reward_count: uint256 = 0
    for i in range(MAX_REWARDS):
        reward_token: address = _reward_tokens[i]
        if reward_token != ZERO_ADDRESS:
            assert reward_token != self
            assert BoostHub(_boost_hub).isRewardToken(_pid, reward_token)
            for j in range(MAX_REWARDS):
                if j < i:
                    assert reward_token != _reward_tokens[j]
            self.reward_tokens[reward_count] = reward_token
            reward_count += 1
            log AddReward(reward_token)

    log SetWithdrawFee(_withdraw_fee_bps)
    log SetFeeReceiver(_fee_receiver)
    log SetPerformanceFee(_performance_fee_bps, _performance_fee_receiver)

    ERC20(_lp_token).approve(_boost_hub, MAX_UINT256)


@view
@external
def decimals() -> uint256:
    """
    @notice Get the number of decimals for this token
    @dev Kept from Curve gauge deposit tokens.
    """
    return 18


@internal
@view
def _is_reward_token(_token: address) -> bool:
    for i in range(MAX_REWARDS):
        token: address = self.reward_tokens[i]
        if token == ZERO_ADDRESS:
            return False
        if token == _token:
            return True
    return False


@view
@external
def reward_token_apr_bps(_token: address) -> uint256:
    """
    @notice Current annualized reward-token distribution per staked receipt token, in BPS.
    @dev Token-denominated only. This uses reward token units normalized by decimals,
         not a USD price or oracle.
    """
    assert self._is_reward_token(_token), "unknown reward"
    if self.totalSupply == 0:
        return 0
    if block.timestamp >= self.reward_period_finish[_token]:
        return 0

    lp_scale: uint256 = 10 ** ERC20Extended(self.lp_token).decimals()
    reward_scale: uint256 = 10 ** ERC20Extended(_token).decimals()
    return self.reward_rate[_token] * 365 * 86400 * FEE_DENOMINATOR * lp_scale / self.totalSupply / reward_scale


@internal
@view
def _last_time_reward_applicable(_token: address) -> uint256:
    period_finish: uint256 = self.reward_period_finish[_token]
    if block.timestamp < period_finish:
        return block.timestamp
    return period_finish


@internal
def _update_reward_integral(_token: address, _total_supply: uint256):
    last_time: uint256 = self._last_time_reward_applicable(_token)
    last_update: uint256 = self.reward_last_update[_token]
    if last_time > last_update:
        if _total_supply != 0:
            self.reward_integral[_token] += (last_time - last_update) * self.reward_rate[_token] * 10**18 / _total_supply
        self.reward_last_update[_token] = last_time


@internal
def _checkpoint_rewards(_addr: address, _claim: bool):
    """
    @notice Checkpoint or claim already-harvested rewards for a user.
    @dev This intentionally does not call BoostHub. Principal withdrawals and
         receipt transfers never depend on external reward harvesting.
    """
    user_balance: uint256 = self.balanceOf[_addr]

    for i in range(MAX_REWARDS):
        token: address = self.reward_tokens[i]
        if token == ZERO_ADDRESS:
            break

        self._update_reward_integral(token, self.totalSupply)

        integral: uint256 = self.reward_integral[token]
        integral_for: uint256 = self.reward_integral_for[token][_addr]
        total_claimable: uint256 = self.claim_data[_addr][token]
        if integral_for < integral:
            total_claimable += user_balance * (integral - integral_for) / 10**18
            self.reward_integral_for[token][_addr] = integral
            self.claim_data[_addr][token] = total_claimable

        if _claim and total_claimable != 0:
            self.claim_data[_addr][token] = 0
            response: Bytes[32] = raw_call(
                token,
                concat(
                    method_id("transfer(address,uint256)"),
                    convert(_addr, bytes32),
                    convert(total_claimable, bytes32),
                ),
                max_outsize=32,
            )
            if len(response) != 0:
                assert convert(response, bool)


@internal
def _pay_withdraw_fee(_fee: uint256):
    if _fee == 0:
        return

    if self.fee_receiver == self.boost_hub:
        raw_call(
            self.boost_hub,
            concat(
                method_id("donateYieldBoostingTokens(uint256,uint256)"),
                convert(self.pid, bytes32),
                convert(_fee, bytes32),
            ),
        )
    else:
        ERC20(self.lp_token).transfer(self.fee_receiver, _fee)


@internal
def _harvest():
    """
    @notice Pull known BoostHub rewards into this staking contract and update integrals.
    """
    total_supply: uint256 = self.totalSupply
    if total_supply == 0:
        return

    # Claim from the StakeDAO gauge into BoostHub first. The return data is ignored.
    raw_call(
        self.boost_hub,
        concat(method_id("harvest(uint256)"), convert(self.pid, bytes32)),
    )

    for i in range(MAX_REWARDS):
        token: address = self.reward_tokens[i]
        if token == ZERO_ADDRESS:
            break

        self._update_reward_integral(token, total_supply)

        before_balance: uint256 = ERC20(token).balanceOf(self)

        raw_call(
            self.boost_hub,
            concat(
                method_id("claimReward(uint256,address,address)"),
                convert(self.pid, bytes32),
                convert(token, bytes32),
                convert(self, bytes32),
            ),
        )

        amount: uint256 = ERC20(token).balanceOf(self) - before_balance
        if amount != 0:
            performance_fee: uint256 = amount * self.performance_fee_bps / FEE_DENOMINATOR
            if performance_fee != 0:
                ERC20(token).transfer(self.performance_fee_receiver, performance_fee)
                amount -= performance_fee

            leftover: uint256 = 0
            if block.timestamp < self.reward_period_finish[token]:
                leftover = (self.reward_period_finish[token] - block.timestamp) * self.reward_rate[token]
            self.reward_rate[token] = (amount + leftover) / REWARDS_DURATION
            self.reward_last_update[token] = block.timestamp
            self.reward_period_finish[token] = block.timestamp + REWARDS_DURATION
            log Harvest(token, amount)


@internal
def _transfer(_from: address, _to: address, _value: uint256):
    """
    @notice Transfer receipt tokens and checkpoint rewards for both sides.
    """
    assert _to != ZERO_ADDRESS

    if _value != 0:
        self._checkpoint_rewards(_from, False)
        self._checkpoint_rewards(_to, False)

        self.balanceOf[_from] -= _value
        self.balanceOf[_to] += _value

    log Transfer(_from, _to, _value)


@external
@nonreentrant("lock")
def harvest():
    """
    @notice Pull known BoostHub rewards into this staking contract and update integrals.
    @dev Uses balance deltas around BoostHub claims, preserving Curve's same-token
         reward safety property without relying on raw principal balances.
    """
    self._harvest()


@external
@nonreentrant("lock")
def deposit(_value: uint256, _addr: address = msg.sender):
    """
    @notice Deposit `_value` LP tokens and mint transferable gauge receipts.
    @dev Depositing checkpoints pending rewards before changing user balance.
    """
    assert _addr != ZERO_ADDRESS
    if _addr != msg.sender:
        assert self.approved_to_deposit[msg.sender][_addr], "Not approved"

    if _value != 0:
        self._harvest()
        self._checkpoint_rewards(_addr, False)

        self.totalSupply += _value
        self.balanceOf[_addr] += _value

        ERC20(self.lp_token).transferFrom(msg.sender, self, _value)

        raw_call(
            self.boost_hub,
            concat(method_id("deposit(uint256,uint256)"), convert(self.pid, bytes32), convert(_value, bytes32)),
        )

    log Deposit(_addr, _value)
    log Transfer(ZERO_ADDRESS, _addr, _value)


@external
@nonreentrant("lock")
def withdraw(_value: uint256):
    """
    @notice Burn receipt tokens and withdraw the underlying LP token.
    @dev Normal withdrawal checkpoints already-harvested rewards before burning
         receipt tokens. It does not force an upstream harvest so principal exits
         remain available if a reward claim path is paused or broken.
    """
    if _value != 0:
        self._checkpoint_rewards(msg.sender, False)

        self.totalSupply -= _value
        self.balanceOf[msg.sender] -= _value

        raw_call(
            self.boost_hub,
            concat(method_id("withdraw(uint256,uint256)"), convert(self.pid, bytes32), convert(_value, bytes32)),
        )

        fee: uint256 = _value * self.withdraw_fee_bps / FEE_DENOMINATOR
        self._pay_withdraw_fee(fee)
        ERC20(self.lp_token).transfer(msg.sender, _value - fee)

    log Withdraw(msg.sender, _value)
    log Transfer(msg.sender, ZERO_ADDRESS, _value)


@external
@nonreentrant("lock")
def emergency_withdraw(_value: uint256):
    """
    @notice Burn receipt tokens and withdraw principal without harvesting.
    @dev This keeps principal withdrawals available if an upstream reward claim reverts.
    """
    if _value != 0:
        self._checkpoint_rewards(msg.sender, False)

        self.totalSupply -= _value
        self.balanceOf[msg.sender] -= _value

        raw_call(
            self.boost_hub,
            concat(method_id("withdraw(uint256,uint256)"), convert(self.pid, bytes32), convert(_value, bytes32)),
        )

        fee: uint256 = _value * self.withdraw_fee_bps / FEE_DENOMINATOR
        self._pay_withdraw_fee(fee)
        ERC20(self.lp_token).transfer(msg.sender, _value - fee)

    log Withdraw(msg.sender, _value)
    log Transfer(msg.sender, ZERO_ADDRESS, _value)


@external
@nonreentrant("lock")
def claim_rewards(_addr: address = msg.sender):
    """
    @notice Claim available harvested reward tokens for `_addr`
    """
    self._checkpoint_rewards(_addr, True)


@external
@nonreentrant("lock")
def transfer(_to: address, _value: uint256) -> bool:
    """
    @notice Transfer receipt tokens.
    """
    self._transfer(msg.sender, _to, _value)
    return True


@external
@nonreentrant("lock")
def transferFrom(_from: address, _to: address, _value: uint256) -> bool:
    """
    @notice Transfer receipt tokens using allowance.
    """
    _allowance: uint256 = self.allowances[_from][msg.sender]
    if _allowance != MAX_UINT256:
        self.allowances[_from][msg.sender] = _allowance - _value

    self._transfer(_from, _to, _value)
    return True


@view
@external
def allowance(_owner: address, _spender: address) -> uint256:
    """
    @notice Check the amount of receipt tokens `_spender` may transfer.
    """
    return self.allowances[_owner][_spender]


@external
def approve(_spender: address, _value: uint256) -> bool:
    """
    @notice Approve `_spender` to transfer receipt tokens.
    """
    self.allowances[msg.sender][_spender] = _value
    log Approval(msg.sender, _spender, _value)
    return True


@external
def increaseAllowance(_spender: address, _added_value: uint256) -> bool:
    """
    @notice Increase allowance granted to `_spender`.
    """
    allowance: uint256 = self.allowances[msg.sender][_spender] + _added_value
    self.allowances[msg.sender][_spender] = allowance
    log Approval(msg.sender, _spender, allowance)
    return True


@external
def decreaseAllowance(_spender: address, _subtracted_value: uint256) -> bool:
    """
    @notice Decrease allowance granted to `_spender`.
    """
    allowance: uint256 = self.allowances[msg.sender][_spender] - _subtracted_value
    self.allowances[msg.sender][_spender] = allowance
    log Approval(msg.sender, _spender, allowance)
    return True


@external
def set_approve_deposit(addr: address, can_deposit: bool):
    """
    @notice Set whether `addr` can deposit tokens for `msg.sender`.
    @dev Kept from Curve gauges for deposit-for compatibility.
    """
    self.approved_to_deposit[addr][msg.sender] = can_deposit


@external
def add_reward(_reward_token: address):
    """
    @notice Add a known BoostHub reward token to distribute to receipt holders.
    @dev No distributor is configured. Rewards only enter through BoostHub claimReward.
    """
    assert msg.sender == self.admin
    assert _reward_token != ZERO_ADDRESS
    assert _reward_token != self
    assert not self._is_reward_token(_reward_token)
    assert BoostHub(self.boost_hub).isRewardToken(self.pid, _reward_token)

    for i in range(MAX_REWARDS):
        if self.reward_tokens[i] == ZERO_ADDRESS:
            self.reward_tokens[i] = _reward_token
            log AddReward(_reward_token)
            return

    raise "Too many rewards"


@external
def set_withdraw_fee_bps(_fee_bps: uint256):
    """
    @notice Set principal withdrawal fee in basis points.
    @dev The first fee config reset is immediate. Later resets are queued for
         the fee delay, preserving one deployment-time correction path.
    """
    assert msg.sender == self.admin
    assert _fee_bps <= MAX_WITHDRAW_FEE_BPS
    if not self.fee_config_locked:
        self.withdraw_fee_bps = _fee_bps
        self.fee_config_locked = True
        log SetWithdrawFee(_fee_bps)
    else:
        self.pending_withdraw_fee_bps = _fee_bps
        self.pending_fee_receiver = self.fee_receiver
        self.pending_fee_ready_at = block.timestamp + FEE_CHANGE_DELAY
        self.pending_fee_config = True
        log QueueFeeConfig(_fee_bps, self.fee_receiver, self.pending_fee_ready_at)


@external
def set_fee_receiver(_fee_receiver: address):
    """
    @notice Set receiver for principal withdrawal fees.
    @dev The first fee config reset is immediate. Later resets are queued for
         the fee delay, preserving one deployment-time correction path.
    """
    assert msg.sender == self.admin
    assert _fee_receiver != ZERO_ADDRESS
    if not self.fee_config_locked:
        self.fee_receiver = _fee_receiver
        self.fee_config_locked = True
        log SetFeeReceiver(_fee_receiver)
    else:
        self.pending_withdraw_fee_bps = self.withdraw_fee_bps
        self.pending_fee_receiver = _fee_receiver
        self.pending_fee_ready_at = block.timestamp + FEE_CHANGE_DELAY
        self.pending_fee_config = True
        log QueueFeeConfig(self.withdraw_fee_bps, _fee_receiver, self.pending_fee_ready_at)


@external
def set_fee_config(_fee_bps: uint256, _fee_receiver: address):
    """
    @notice Set withdrawal fee and receiver together.
    @dev The first fee config reset is immediate. Later resets are queued for
         the fee delay.
    """
    assert msg.sender == self.admin
    assert _fee_bps <= MAX_WITHDRAW_FEE_BPS
    assert _fee_receiver != ZERO_ADDRESS
    if not self.fee_config_locked:
        self.withdraw_fee_bps = _fee_bps
        self.fee_receiver = _fee_receiver
        self.fee_config_locked = True
        log SetWithdrawFee(_fee_bps)
        log SetFeeReceiver(_fee_receiver)
    else:
        self.pending_withdraw_fee_bps = _fee_bps
        self.pending_fee_receiver = _fee_receiver
        self.pending_fee_ready_at = block.timestamp + FEE_CHANGE_DELAY
        self.pending_fee_config = True
        log QueueFeeConfig(_fee_bps, _fee_receiver, self.pending_fee_ready_at)


@external
def apply_fee_config():
    """
    @notice Apply a queued withdrawal fee configuration after the fee delay.
    """
    assert msg.sender == self.admin
    assert self.pending_fee_config
    assert block.timestamp >= self.pending_fee_ready_at

    self.withdraw_fee_bps = self.pending_withdraw_fee_bps
    self.fee_receiver = self.pending_fee_receiver
    self.pending_fee_ready_at = 0
    self.pending_fee_config = False

    log SetWithdrawFee(self.withdraw_fee_bps)
    log SetFeeReceiver(self.fee_receiver)


@view
@external
def fee_config_ready() -> bool:
    """
    @notice Return whether a queued fee configuration is ready to apply.
    """
    return self.pending_fee_config and block.timestamp >= self.pending_fee_ready_at


@view
@external
def claimable_reward(_addr: address, _token: address) -> uint256:
    """
    @notice Get claimable harvested reward token amount.
    """
    integral: uint256 = self.reward_integral[_token]
    total_supply: uint256 = self.totalSupply
    last_time: uint256 = self._last_time_reward_applicable(_token)
    last_update: uint256 = self.reward_last_update[_token]
    if last_time > last_update and total_supply != 0:
        integral += (last_time - last_update) * self.reward_rate[_token] * 10**18 / total_supply

    integral_for: uint256 = self.reward_integral_for[_token][_addr]
    claimable: uint256 = self.claim_data[_addr][_token]
    if integral_for <= integral:
        claimable += self.balanceOf[_addr] * (integral - integral_for) / 10**18
    return claimable


@external
def commit_transfer_ownership(addr: address):
    """
    @notice Commit ownership transfer.
    """
    assert msg.sender == self.admin
    assert addr != ZERO_ADDRESS
    self.future_admin = addr
    if not self.ownership_delay_initialized:
        self.ownership_delay_initialized = True
        self.future_admin_deadline = 0
    else:
        self.future_admin_deadline = block.timestamp + OWNERSHIP_DELAY
    log CommitOwnership(addr)


@external
def accept_transfer_ownership():
    """
    @notice Accept pending ownership transfer.
    """
    _admin: address = self.future_admin
    assert msg.sender == _admin
    assert block.timestamp >= self.future_admin_deadline
    self.admin = _admin
    self.future_admin = ZERO_ADDRESS
    self.future_admin_deadline = 0
    log ApplyOwnership(_admin)
