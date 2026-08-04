const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CurveYield Beefy V7 revenue vault", function () {
  async function fixture() {
    const [dao, existingHolder, newDepositor, caller, feeRecipient] = await ethers.getSigners();

    const Cyvl = await ethers.getContractFactory("MockCyvlSdt");
    const cyvl = await Cyvl.deploy();
    const Token = await ethers.getContractFactory("MockERC20");
    const sdt = await Token.deploy("Stake DAO Token", "SDT");
    const governance = await Token.deploy("CurveYield Governance", "cyGOV");
    const Locker = await ethers.getContractFactory("MockLockerForCompounder");
    const locker = await Locker.deploy(await sdt.getAddress(), await cyvl.getAddress());
    const Revenue = await ethers.getContractFactory("MockRevenueStakingForCompounder");
    const revenue = await Revenue.deploy(await cyvl.getAddress(), await governance.getAddress());
    const GovStaking = await ethers.getContractFactory("MockGovernanceStakingForDistributor");
    const governanceStaking = await GovStaking.deploy(await governance.getAddress());

    const Vault = await ethers.getContractFactory("CurveYieldRevenueVaultV7");
    const vault = await Vault.deploy("CurveYield Compounding vlSDT", "cycvlSDT", dao.address);
    const Converter = await ethers.getContractFactory("CurveYieldRevenueConverter");
    const converter = await Converter.deploy(
      dao.address,
      await sdt.getAddress(),
      await cyvl.getAddress(),
      await locker.getAddress()
    );
    const Strategy = await ethers.getContractFactory("CurveYieldRevenueStrategyV7");
    const strategy = await Strategy.deploy(
      dao.address,
      await vault.getAddress(),
      await cyvl.getAddress(),
      await sdt.getAddress(),
      await governance.getAddress(),
      await revenue.getAddress(),
      await converter.getAddress(),
      feeRecipient.address
    );
    const Distributor = await ethers.getContractFactory("CurveYieldCyGovDistributor");
    const distributor = await Distributor.deploy(
      await vault.getAddress(),
      await governance.getAddress(),
      await governanceStaking.getAddress()
    );

    await strategy.connect(dao).setCyGovDistributor(await distributor.getAddress());
    await vault.connect(dao).setInitialConfiguration(await strategy.getAddress(), await distributor.getAddress());
    await revenue.setRewardToken(await sdt.getAddress(), true);

    await cyvl.mint(existingHolder.address, ethers.parseEther("100"));
    await cyvl.connect(existingHolder).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(existingHolder).deposit(ethers.parseEther("100"));

    await cyvl.mint(newDepositor.address, ethers.parseEther("1000"));
    await cyvl.connect(newDepositor).approve(await vault.getAddress(), ethers.MaxUint256);

    return {
      dao,
      existingHolder,
      newDepositor,
      caller,
      feeRecipient,
      cyvl,
      sdt,
      governance,
      locker,
      revenue,
      governanceStaking,
      vault,
      converter,
      strategy,
      distributor
    };
  }

  async function addSdtReward(ctx, amount) {
    await ctx.sdt.mint(await ctx.revenue.getAddress(), amount);
    await ctx.revenue.setRewardEarned(await ctx.strategy.getAddress(), await ctx.sdt.getAddress(), amount);
  }

  it("uses the requested Beefy-style fee and harvest defaults", async function () {
    const ctx = await fixture();
    expect(await ctx.strategy.withdrawalFeeBps()).to.equal(10);
    expect(await ctx.strategy.performanceFeeBps()).to.equal(390);
    expect(await ctx.strategy.callFeeBps()).to.equal(10);
    expect(await ctx.strategy.harvestOnDeposit()).to.equal(true);
  });

  it("prices standard deposits against unharvested ordinary rewards", async function () {
    const ctx = await fixture();
    await ctx.strategy.connect(ctx.dao).setHarvestOnDeposit(false);
    await addSdtReward(ctx, ethers.parseEther("100"));

    expect(await ctx.vault.balance()).to.equal(ethers.parseEther("99.5"));
    expect(await ctx.vault.economicBalance()).to.equal(ethers.parseEther("199"));

    await ctx.vault.connect(ctx.newDepositor).deposit(ethers.parseEther("100"));
    expect(await ctx.vault.balanceOf(ctx.newDepositor.address)).to.equal(ethers.parseEther("49.75"));
  });

  it("strict deposit harvests before minting shares", async function () {
    const ctx = await fixture();
    await ctx.strategy.connect(ctx.dao).setFees(10, 0, 10);
    await addSdtReward(ctx, ethers.parseEther("100"));

    await ctx.vault.connect(ctx.newDepositor).depositWithStrictHarvest(
      ethers.parseEther("100"),
      ethers.parseEther("49.75")
    );

    expect(await ctx.revenue.rewardEarned(await ctx.strategy.getAddress(), await ctx.sdt.getAddress())).to.equal(0);
    expect(await ctx.vault.balanceOf(ctx.newDepositor.address)).to.equal(ethers.parseEther("49.75"));
    expect(await ctx.vault.balance()).to.equal(ethers.parseEther("298.5"));
  });

  it("pays configurable caller and performance fees from new harvest output", async function () {
    const ctx = await fixture();
    await ctx.strategy.connect(ctx.dao).setFees(10, 390, 10);
    await addSdtReward(ctx, ethers.parseEther("100"));

    await ctx.strategy.connect(ctx.caller).harvest();

    expect(await ctx.cyvl.balanceOf(ctx.caller.address)).to.equal(ethers.parseEther("0.1"));
    expect(await ctx.cyvl.balanceOf(ctx.feeRecipient.address)).to.equal(ethers.parseEther("3.9"));
    expect(await ctx.revenue.activeBalance(await ctx.strategy.getAddress())).to.equal(ethers.parseEther("196"));
  });

  it("reads and compensates the current Revenue Staking withdrawal fee", async function () {
    const ctx = await fixture();
    await ctx.revenue.setImmediateWithdrawFeeBps(200);

    expect(await ctx.vault.balance()).to.equal(ethers.parseEther("98"));

    const shares = await ctx.vault.balanceOf(ctx.existingHolder.address);
    const before = await ctx.cyvl.balanceOf(ctx.existingHolder.address);
    await ctx.vault.connect(ctx.existingHolder).withdraw(shares);
    const received = (await ctx.cyvl.balanceOf(ctx.existingHolder.address)) - before;

    expect(await ctx.revenue.lastImmediateWithdrawAmount()).to.equal(ethers.parseEther("100"));
    expect(received).to.equal(ethers.parseEther("97.902"));
    expect(await ctx.cyvl.balanceOf(ctx.feeRecipient.address)).to.equal(ethers.parseEther("0.098"));
  });

  it("automatically checkpoints cyGOV before share transfers", async function () {
    const ctx = await fixture();
    await ctx.revenue.setGovernanceEarned(await ctx.strategy.getAddress(), ethers.parseEther("100"));

    await ctx.vault.connect(ctx.existingHolder).transfer(ctx.newDepositor.address, ethers.parseEther("50"));

    expect(await ctx.distributor.earned(ctx.existingHolder.address)).to.equal(ethers.parseEther("100"));
    expect(await ctx.distributor.earned(ctx.newDepositor.address)).to.equal(0);

    await ctx.distributor.connect(ctx.existingHolder).claim(false);
    expect(await ctx.governance.balanceOf(ctx.existingHolder.address)).to.equal(ethers.parseEther("100"));
  });

  it("caps owner-configurable fees at 1% withdrawal and 9% performance", async function () {
    const ctx = await fixture();
    await expect(
      ctx.strategy.connect(ctx.dao).setFees(101, 390, 10)
    ).to.be.revertedWithCustomError(ctx.strategy, "InvalidFee");
    await expect(
      ctx.strategy.connect(ctx.dao).setFees(10, 901, 10)
    ).to.be.revertedWithCustomError(ctx.strategy, "InvalidFee");
    await ctx.strategy.connect(ctx.dao).setFees(100, 900, 100);
  });

  it("enables SDT market and USDC routes immediately without a timelock", async function () {
    const ctx = await fixture();
    const Token = await ethers.getContractFactory("MockERC20");
    const usdc = await Token.deploy("USD Coin", "USDC");
    const Adapter = await ethers.getContractFactory("MockCompounderAdapter");
    const adapter = await Adapter.deploy();

    await ctx.converter.connect(ctx.dao).setSdtSwapAdapter(await adapter.getAddress());
    await ctx.converter.connect(ctx.dao).setUsdcRoute(await usdc.getAddress(), await adapter.getAddress());

    expect(await ctx.converter.sdtSwapAdapter()).to.equal(await adapter.getAddress());
    expect(await ctx.converter.usdc()).to.equal(await usdc.getAddress());
    expect(await ctx.converter.usdcAdapter()).to.equal(await adapter.getAddress());
    expect(await ctx.converter.supportsToken(await usdc.getAddress())).to.equal(true);
  });

  async function deployReplacement(ctx) {
    const Strategy = await ethers.getContractFactory("CurveYieldRevenueStrategyV7");
    const replacement = await Strategy.deploy(
      ctx.dao.address,
      await ctx.vault.getAddress(),
      await ctx.cyvl.getAddress(),
      await ctx.sdt.getAddress(),
      await ctx.governance.getAddress(),
      await ctx.revenue.getAddress(),
      await ctx.converter.getAddress(),
      ctx.feeRecipient.address
    );
    await replacement.connect(ctx.dao).setCyGovDistributor(await ctx.distributor.getAddress());
    return replacement;
  }

  async function matureCandidate(ctx, replacement) {
    await ctx.vault.connect(ctx.dao).proposeStrat(await replacement.getAddress());
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
    await ethers.provider.send("evm_mine", []);
  }

  it("harvests and compounds ordinary rewards before normal strategy retirement", async function () {
    const ctx = await fixture();
    const replacement = await deployReplacement(ctx);
    await addSdtReward(ctx, ethers.parseEther("100"));
    await matureCandidate(ctx, replacement);

    await ctx.vault.connect(ctx.dao).upgradeStrat();

    expect(await ctx.revenue.rewardEarned(await ctx.strategy.getAddress(), await ctx.sdt.getAddress())).to.equal(0);
    expect(await ctx.strategy.retired()).to.equal(true);
    expect(await ctx.strategy.paused()).to.equal(true);
    expect(await ctx.vault.strategy()).to.equal(await replacement.getAddress());
    expect(await ctx.revenue.activeBalance(await replacement.getAddress())).to.be.greaterThan(0);
  });

  it("reverts normal migration when reward harvesting fails", async function () {
    const ctx = await fixture();
    const replacement = await deployReplacement(ctx);
    await matureCandidate(ctx, replacement);
    await ctx.revenue.setClaimRewardsReverts(true);

    await expect(ctx.vault.connect(ctx.dao).upgradeStrat()).to.be.revertedWith("claim revert");
    expect(await ctx.vault.strategy()).to.equal(await ctx.strategy.getAddress());
    expect(await ctx.strategy.retired()).to.equal(false);
  });

  it("emergency migration skips failed harvest, returns principal, and permanently pauses the old strategy", async function () {
    const ctx = await fixture();
    const replacement = await deployReplacement(ctx);
    await matureCandidate(ctx, replacement);
    await ctx.revenue.setClaimRewardsReverts(true);

    await ctx.vault.connect(ctx.dao).emergencyUpgradeStrat();

    expect(await ctx.vault.strategy()).to.equal(await replacement.getAddress());
    expect(await ctx.revenue.activeBalance(await ctx.strategy.getAddress())).to.equal(0);
    expect(await ctx.revenue.activeBalance(await replacement.getAddress())).to.be.greaterThan(0);
    expect(await ctx.strategy.retired()).to.equal(true);
    expect(await ctx.strategy.paused()).to.equal(true);
    await expect(ctx.strategy.connect(ctx.caller).harvest()).to.be.revertedWithCustomError(
      ctx.strategy,
      "EnforcedPause"
    );
    await expect(ctx.strategy.connect(ctx.dao).unpause()).to.be.revertedWithCustomError(
      ctx.strategy,
      "StrategyAlreadyRetired"
    );
  });
});
