const { expect } = require("chai");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;
const STREAM = 14 * DAY;

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployFixture() {
  const [dao, user, user2, admin] = await ethers.getSigners();
  const Cyvl = await ethers.getContractFactory("MockCyvlSdtV17");
  const cyvl = await Cyvl.deploy();
  const Gov = await ethers.getContractFactory("CurveYieldGovernanceTokenV17");
  const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
  const Reward = await ethers.getContractFactory("MockERC20V17");
  const reward = await Reward.deploy("Reward", "RWD");
  const Revenue = await ethers.getContractFactory("CurveYieldVlSDTRevenueStakingV17");
  const revenue = await Revenue.deploy(
    dao.address,
    admin.address,
    await cyvl.getAddress(),
    await gov.getAddress()
  );

  await revenue.connect(dao).addRewardToken(await reward.getAddress());
  await revenue.connect(dao).setNotifier(dao.address, true);
  await cyvl.mint(user.address, ethers.parseEther("600"));
  await cyvl.connect(user).approve(await revenue.getAddress(), ethers.MaxUint256);
  await revenue.connect(user).stake(ethers.parseEther("600"));
  await reward.mint(dao.address, ethers.parseEther("1000"));
  await reward.connect(dao).approve(await revenue.getAddress(), ethers.MaxUint256);

  return { dao, user, user2, admin, cyvl, gov, reward, revenue };
}

describe("Revenue Staking daily reward cycles V17", function () {
  it("pays DAO and admin fee receiver immediately and queues only the user share", async function () {
    const { dao, user, admin, reward, revenue } = await deployFixture();
    const token = await reward.getAddress();

    await revenue.connect(dao).notifyReward(
      token,
      ethers.parseEther("100"),
      ethers.parseEther("0.1")
    );

    expect(await reward.balanceOf(dao.address)).to.equal(ethers.parseEther("913.2"));
    expect(await reward.balanceOf(admin.address)).to.equal(ethers.parseEther("4.8"));
    expect(await reward.balanceOf(await revenue.getAddress())).to.equal(ethers.parseEther("82"));
    expect(await revenue.pendingUserRewards(token)).to.equal(ethers.parseEther("82"));
    expect(await revenue.streamCount(token)).to.equal(0);
    expect(await revenue.earned(user.address, token)).to.equal(0);
  });

  it("batches all notifications received during the interval into one 14-day cycle", async function () {
    const { dao, reward, revenue } = await deployFixture();
    const token = await reward.getAddress();

    await revenue.connect(dao).notifyReward(token, ethers.parseEther("100"), 0);
    await increaseTime(6 * 60 * 60);
    await revenue.connect(dao).notifyReward(token, ethers.parseEther("50"), 0);

    expect(await revenue.streamCount(token)).to.equal(0);
    expect(await revenue.pendingUserRewards(token)).to.equal(ethers.parseEther("82.5"));
    await expect(revenue.startRewardCycle(token)).to.be.revertedWithCustomError(revenue, "CycleNotReady");

    await increaseTime(18 * 60 * 60);
    await revenue.startRewardCycle(token);

    expect(await revenue.streamCount(token)).to.equal(1);
    expect(await revenue.pendingUserRewards(token)).to.equal(0);
    const cycle = await revenue.getStream(token, 0);
    expect(cycle.amount).to.equal(ethers.parseEther("82.5"));
    expect(cycle.end - cycle.start).to.equal(BigInt(STREAM));
  });

  it("automatically starts a ready cycle on deposits, withdrawals, and reward claims", async function () {
    const { dao, user, user2, cyvl, reward, revenue } = await deployFixture();
    const token = await reward.getAddress();

    await revenue.connect(dao).notifyReward(token, ethers.parseEther("100"), 0);
    await increaseTime(DAY);
    await cyvl.mint(user2.address, ethers.parseEther("1"));
    await cyvl.connect(user2).approve(await revenue.getAddress(), ethers.MaxUint256);
    await revenue.connect(user2).stake(ethers.parseEther("1"));
    expect(await revenue.streamCount(token)).to.equal(1);

    await revenue.connect(dao).notifyReward(token, ethers.parseEther("100"), 0);
    await increaseTime(DAY);
    await revenue.connect(user).withdrawImmediate(ethers.parseEther("1"), user.address);
    expect(await revenue.streamCount(token)).to.equal(2);

    await revenue.connect(dao).notifyReward(token, ethers.parseEther("100"), 0);
    await increaseTime(DAY);
    await revenue.connect(user).claimRewards(user.address);
    expect(await revenue.streamCount(token)).to.equal(3);

    await revenue.connect(dao).notifyReward(token, ethers.parseEther("100"), 0);
    await increaseTime(DAY);
    await revenue.connect(user).claimGovernance(user.address);
    expect(await revenue.streamCount(token)).to.equal(4);
  });

  it("does not start an empty cycle and requeues user emissions when no active stake exists", async function () {
    const { dao, user, reward, revenue } = await deployFixture();
    const token = await reward.getAddress();

    await expect(revenue.startRewardCycle(token)).to.be.revertedWithCustomError(revenue, "NoPendingRewards");

    await revenue.connect(dao).notifyReward(token, ethers.parseEther("100"), 0);
    await increaseTime(DAY);
    await revenue.startRewardCycle(token);
    await revenue.connect(user).withdrawImmediate(ethers.parseEther("600"), user.address);
    await increaseTime(DAY);

    // A claim checkpoints the elapsed no-staker interval and requeues it instead of paying it to DAO/admin.
    await revenue.connect(user).claimRewards(user.address);
    expect(await revenue.pendingUserRewards(token)).to.be.gt(0);
  });
  it("pays the queued-stake benchmark portion to the DAO immediately", async function () {
    const { dao, user, admin, reward, revenue } = await deployFixture();
    const token = await reward.getAddress();

    await revenue.connect(user).requestWithdrawal(ethers.parseEther("240"));
    await revenue.connect(dao).notifyReward(
      token,
      ethers.parseEther("60"),
      ethers.parseEther("0.1")
    );

    // 360 active and 240 queued at a 0.1 benchmark: 36 user pending, 24 DAO, no excess/admin share.
    expect(await reward.balanceOf(dao.address)).to.equal(ethers.parseEther("964"));
    expect(await reward.balanceOf(admin.address)).to.equal(0);
    expect(await revenue.pendingUserRewards(token)).to.equal(ethers.parseEther("36"));
  });

  it("automatically starts ready cycles on queued withdrawal request and completion", async function () {
    const { dao, user, reward, revenue } = await deployFixture();
    const token = await reward.getAddress();

    await revenue.connect(dao).notifyReward(token, ethers.parseEther("100"), 0);
    await increaseTime(DAY);
    const requestId = await revenue.nextWithdrawalId();
    await revenue.connect(user).requestWithdrawal(ethers.parseEther("1"));
    expect(await revenue.streamCount(token)).to.equal(1);

    await revenue.connect(dao).notifyReward(token, ethers.parseEther("100"), 0);
    await increaseTime(7 * DAY);
    await revenue.connect(user).completeQueuedWithdrawal(requestId, user.address);
    expect(await revenue.streamCount(token)).to.equal(2);
  });

});
