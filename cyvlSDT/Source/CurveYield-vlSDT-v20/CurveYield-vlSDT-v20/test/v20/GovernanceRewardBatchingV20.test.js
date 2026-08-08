const { expect } = require("chai");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;
async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployFixture() {
  const [owner, alice, notifier, treasury] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const governance = await Token.deploy("Governance", "GOV");
  const reward = await Token.deploy("Reward", "RWD");
  const Staking = await ethers.getContractFactory("CurveYieldGovernanceStaking");
  const staking = await Staking.deploy(
    owner.address,
    await governance.getAddress(),
    treasury.address,
    "Staked Governance",
    "stGOV",
    300,
    0,
    14 * DAY
  );
  const Strategy = await ethers.getContractFactory("CurveYieldGovernanceBoostStrategy");
  const strategy = await Strategy.deploy(await staking.getAddress(), ethers.ZeroAddress);
  await staking.setGovernanceBoostStrategy(await strategy.getAddress());
  await staking.addRewardToken(await reward.getAddress());
  await staking.setNotifier(notifier.address, true);

  await governance.mint(alice.address, ethers.parseEther("100"));
  await governance.connect(alice).approve(await staking.getAddress(), ethers.MaxUint256);
  await staking.connect(alice).stake(ethers.parseEther("100"));
  await reward.mint(notifier.address, ethers.parseEther("10000"));
  await reward.connect(notifier).approve(await staking.getAddress(), ethers.MaxUint256);
  return { owner, alice, notifier, governance, reward, staking };
}

describe("CurveYieldGovernanceStaking V20 reward batching", function () {
  it("batches notifications for 24 hours before starting a fourteen-day stream", async function () {
    const { notifier, reward, staking } = await deployFixture();
    const token = await reward.getAddress();
    await staking.connect(notifier).notifyReward(token, ethers.parseEther("40"));
    await increaseTime(12 * 60 * 60);
    await staking.connect(notifier).notifyReward(token, ethers.parseEther("60"));
    expect(await staking.pendingReward(token)).to.equal(ethers.parseEther("100"));
    expect(await staking.streamCount(token)).to.equal(0);

    await increaseTime(12 * 60 * 60);
    await staking.startRewardCycle(token, false);
    expect(await staking.pendingReward(token)).to.equal(0);
    expect(await staking.streamCount(token)).to.equal(1);
    const stream = await staking.getStream(token, 0);
    expect(stream.amount).to.equal(ethers.parseEther("100"));
    expect(stream.end - stream.start).to.equal(BigInt(14 * DAY));
  });

  it("automatically closes a ready prior batch before queuing a new notification", async function () {
    const { notifier, reward, staking } = await deployFixture();
    const token = await reward.getAddress();
    await staking.connect(notifier).notifyReward(token, ethers.parseEther("40"));
    await increaseTime(DAY);
    await staking.connect(notifier).notifyReward(token, ethers.parseEther("60"));
    expect(await staking.streamCount(token)).to.equal(1);
    expect(await staking.pendingReward(token)).to.equal(ethers.parseEther("60"));
  });

  it("settles rewards before queued stake is removed from ordinary and participation weight", async function () {
    const { alice, notifier, reward, staking } = await deployFixture();
    const token = await reward.getAddress();
    await staking.connect(notifier).notifyReward(token, ethers.parseEther("140"));
    await increaseTime(DAY);
    await staking.startRewardCycle(token, false);
    await increaseTime(7 * DAY);

    await staking.connect(alice).requestWithdrawal(ethers.parseEther("100"), alice.address);
    const earnedAtExit = await staking.earned(alice.address, token);
    expect(earnedAtExit).to.be.closeTo(ethers.parseEther("70"), ethers.parseEther("0.001"));
    expect(await staking.balanceOf(alice.address)).to.equal(0);
    expect(await staking.participationWeight(alice.address)).to.equal(0);

    await increaseTime(7 * DAY);
    expect(await staking.earned(alice.address, token)).to.equal(earnedAtExit);
  });
});
