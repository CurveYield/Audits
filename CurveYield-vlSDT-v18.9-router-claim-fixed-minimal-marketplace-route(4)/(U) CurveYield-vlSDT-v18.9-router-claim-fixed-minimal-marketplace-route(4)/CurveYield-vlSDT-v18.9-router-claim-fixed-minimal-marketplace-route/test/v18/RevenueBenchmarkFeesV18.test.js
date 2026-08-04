const { expect } = require("chai");
const { ethers } = require("hardhat");

const E18 = 10n ** 18n;

async function fixture() {
  const [owner, admin, nextAdmin, treasury, notifier, staker] = await ethers.getSigners();

  const GovernanceToken = await ethers.getContractFactory("CurveYieldGovernanceToken");
  const governanceToken = await GovernanceToken.deploy(
    owner.address,
    "CurveYield Governance",
    "cyGOV"
  );

  const Mock = await ethers.getContractFactory("MockERC20");
  const cyvlSdt = await Mock.deploy("CurveYield vlSDT", "cyvlSDT");
  const reward = await Mock.deploy("Reward", "RWD");

  const RevenueStaking = await ethers.getContractFactory("CurveYieldVlSDTRevenueStaking");
  const revenueStaking = await RevenueStaking.deploy(
    owner.address,
    admin.address,
    treasury.address,
    await cyvlSdt.getAddress(),
    await governanceToken.getAddress()
  );

  await revenueStaking.addRewardToken(await reward.getAddress());
  await revenueStaking.setNotifier(notifier.address, true);

  await cyvlSdt.mint(staker.address, 500n * E18);
  await cyvlSdt.connect(staker).approve(await revenueStaking.getAddress(), 500n * E18);
  await revenueStaking.connect(staker).stake(500n * E18);
  await revenueStaking.connect(staker).requestWithdrawal(100n * E18);

  return {
    owner,
    admin,
    nextAdmin,
    treasury,
    notifier,
    staker,
    reward,
    revenueStaking
  };
}

async function notifyBenchmarkReward(ctx) {
  const amount = 1_000n * E18;
  await ctx.reward.mint(ctx.notifier.address, amount);
  await ctx.reward.connect(ctx.notifier).approve(await ctx.revenueStaking.getAddress(), amount);
  await ctx.revenueStaking.connect(ctx.notifier).notifyReward(
    await ctx.reward.getAddress(),
    amount,
    E18
  );
}

describe("CurveYield Revenue Staking V18.9 benchmark fees", function () {
  it("sends 33% of excess to Treasury and 7% only to the admin role", async function () {
    const ctx = await fixture();
    await notifyBenchmarkReward(ctx);

    expect(await ctx.reward.balanceOf(ctx.treasury.address)).to.equal(265n * E18);
    expect(await ctx.reward.balanceOf(ctx.admin.address)).to.equal(35n * E18);
    expect(await ctx.reward.balanceOf(await ctx.revenueStaking.getAddress())).to.equal(635n * E18);
  });

  it("moves the sole non-Treasury fee destination when the admin role changes", async function () {
    const ctx = await fixture();
    await notifyBenchmarkReward(ctx);

    await ctx.revenueStaking.connect(ctx.admin).setAdmin(ctx.nextAdmin.address);
    await notifyBenchmarkReward(ctx);

    expect(await ctx.reward.balanceOf(ctx.admin.address)).to.equal(35n * E18);
    expect(await ctx.reward.balanceOf(ctx.nextAdmin.address)).to.equal(35n * E18);
    expect(await ctx.reward.balanceOf(ctx.treasury.address)).to.equal(530n * E18);
  });
});
