const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CurveYield Revenue Compounder V18 reward-aware accounting", function () {
  async function fixture() {
    const [dao, existingHolder, newDepositor] = await ethers.getSigners();

    const Cyvl = await ethers.getContractFactory("MockCyvlSdt");
    const cyvl = await Cyvl.deploy();
    const Token = await ethers.getContractFactory("MockERC20");
    const sdt = await Token.deploy("Stake DAO Token", "SDT");
    const reward = await Token.deploy("Ordinary Reward", "RWD");
    const governance = await Token.deploy("Governance", "GOV");
    const Locker = await ethers.getContractFactory("MockLockerForCompounder");
    const locker = await Locker.deploy(await sdt.getAddress(), await cyvl.getAddress());
    const Revenue = await ethers.getContractFactory("MockRevenueStakingForCompounder");
    const revenue = await Revenue.deploy(await cyvl.getAddress(), await governance.getAddress());
    const Compounder = await ethers.getContractFactory("CurveYieldRevenueCompounder");
    const compounder = await Compounder.deploy(
      dao.address,
      await cyvl.getAddress(),
      await sdt.getAddress(),
      await governance.getAddress(),
      await locker.getAddress(),
      await revenue.getAddress(),
      dao.address
    );
    const Adapter = await ethers.getContractFactory("MockCompounderAdapter");
    const rewardAdapter = await Adapter.deploy();

    await revenue.setRewardToken(await reward.getAddress(), true);
    await compounder.connect(dao).setRewardToSdtAdapter(await reward.getAddress(), await rewardAdapter.getAddress());
    await sdt.mint(await rewardAdapter.getAddress(), ethers.parseEther("10000"));

    await cyvl.mint(existingHolder.address, ethers.parseEther("100"));
    await cyvl.connect(existingHolder).approve(await compounder.getAddress(), ethers.MaxUint256);
    await compounder.connect(existingHolder).deposit(ethers.parseEther("100"), existingHolder.address);

    await cyvl.mint(newDepositor.address, ethers.parseEther("1000"));
    await cyvl.connect(newDepositor).approve(await compounder.getAddress(), ethers.MaxUint256);

    return {
      dao,
      existingHolder,
      newDepositor,
      cyvl,
      sdt,
      reward,
      governance,
      locker,
      revenue,
      compounder,
      rewardAdapter
    };
  }

  async function addClaimableReward(ctx, amount) {
    await ctx.reward.mint(await ctx.revenue.getAddress(), amount);
    await ctx.revenue.setRewardEarned(await ctx.compounder.getAddress(), await ctx.reward.getAddress(), amount);
  }

  it("includes claimable ordinary rewards in deposit pricing without harvesting", async function () {
    const ctx = await fixture();
    await addClaimableReward(ctx, ethers.parseEther("100"));

    expect(await ctx.compounder.realizedAssets()).to.equal(ethers.parseEther("100"));
    expect(await ctx.compounder.estimatedUnharvestedRewards()).to.equal(ethers.parseEther("100"));
    expect(await ctx.compounder.totalAssets()).to.equal(ethers.parseEther("200"));

    await ctx.compounder.connect(ctx.newDepositor).deposit(ethers.parseEther("100"), ctx.newDepositor.address);
    expect(await ctx.compounder.balanceOf(ctx.newDepositor.address)).to.equal(ethers.parseEther("50"));
  });

  it("does not revert deposits when an optional reward quote fails", async function () {
    const ctx = await fixture();
    await addClaimableReward(ctx, ethers.parseEther("100"));
    await ctx.rewardAdapter.setQuoteReverts(true);

    expect(await ctx.compounder.estimatedUnharvestedRewards()).to.equal(0);
    await expect(
      ctx.compounder.connect(ctx.newDepositor).deposit(ethers.parseEther("100"), ctx.newDepositor.address)
    ).not.to.be.reverted;
  });

  it("harvests before share issuance when harvestOnDeposit is enabled", async function () {
    const ctx = await fixture();
    await addClaimableReward(ctx, ethers.parseEther("100"));
    await ctx.compounder.connect(ctx.dao).setHarvestOnDeposit(true);

    await ctx.compounder.connect(ctx.newDepositor).deposit(ethers.parseEther("100"), ctx.newDepositor.address);

    expect(await ctx.revenue.rewardEarned(await ctx.compounder.getAddress(), await ctx.reward.getAddress())).to.equal(0);
    expect(await ctx.compounder.balanceOf(ctx.newDepositor.address)).to.equal(ethers.parseEther("50"));
    expect(await ctx.compounder.realizedAssets()).to.equal(ethers.parseEther("300"));
  });

  it("strict deposit harvests before mint and prices only from realized assets", async function () {
    const ctx = await fixture();
    await addClaimableReward(ctx, ethers.parseEther("100"));

    await ctx.compounder.connect(ctx.newDepositor).depositWithStrictHarvest(
      ethers.parseEther("100"),
      ctx.newDepositor.address
    );

    expect(await ctx.revenue.rewardEarned(await ctx.compounder.getAddress(), await ctx.reward.getAddress())).to.equal(0);
    expect(await ctx.compounder.realizedAssets()).to.equal(ethers.parseEther("300"));
    expect(await ctx.compounder.balanceOf(ctx.newDepositor.address)).to.equal(ethers.parseEther("50"));
  });

  it("strict deposit reverts when the pre-mint harvest cannot complete", async function () {
    const ctx = await fixture();
    await addClaimableReward(ctx, ethers.parseEther("100"));
    await ctx.revenue.setClaimRewardsReverts(true);

    await expect(
      ctx.compounder.connect(ctx.newDepositor).depositWithStrictHarvest(
        ethers.parseEther("100"),
        ctx.newDepositor.address
      )
    ).to.be.revertedWith("claim revert");

    expect(await ctx.compounder.balanceOf(ctx.newDepositor.address)).to.equal(0);
  });

  it("keeps standard redeem and queued withdrawal pricing limited to realized assets", async function () {
    const ctx = await fixture();
    await addClaimableReward(ctx, ethers.parseEther("100"));

    const shares = await ctx.compounder.balanceOf(ctx.existingHolder.address);
    expect(await ctx.compounder.totalAssets()).to.equal(ethers.parseEther("200"));
    expect(await ctx.compounder.previewRedeem(shares)).to.be.lessThan(ethers.parseEther("100"));

    const [, queuedAssets] = await ctx.compounder.connect(ctx.existingHolder).requestWithdrawal.staticCall(
      shares,
      ctx.existingHolder.address
    );
    expect(queuedAssets).to.equal(ethers.parseEther("100"));
  });

  it("redeemWithHarvest pays only the realized result after the harvest attempt", async function () {
    const ctx = await fixture();
    await addClaimableReward(ctx, ethers.parseEther("100"));

    const shares = await ctx.compounder.balanceOf(ctx.existingHolder.address);
    const standardPreview = await ctx.compounder.previewRedeem(shares);
    const before = await ctx.cyvl.balanceOf(ctx.existingHolder.address);

    await ctx.compounder.connect(ctx.existingHolder).redeemWithHarvest(
      shares,
      ctx.existingHolder.address,
      ctx.existingHolder.address
    );

    const received = (await ctx.cyvl.balanceOf(ctx.existingHolder.address)) - before;
    expect(received).to.be.greaterThan(standardPreview);
    expect(received).to.be.lessThan(ethers.parseEther("200"));
    expect(await ctx.compounder.balanceOf(ctx.existingHolder.address)).to.equal(0);
  });
});
