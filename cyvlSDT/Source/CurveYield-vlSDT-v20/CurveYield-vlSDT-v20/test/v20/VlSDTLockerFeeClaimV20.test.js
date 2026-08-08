"use strict";

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CurveYield vlSDT locker Stake DAO Router claims", function () {
  async function fixture() {
    const [owner, treasury, depositor, boostStaking, boostMerchant, keeper] =
      await ethers.getSigners();
    const principal = ethers.parseEther("1000");

    const Token = await ethers.getContractFactory("MockERC20");
    const sdt = await Token.deploy("Stake DAO Token", "SDT");
    const usdc = await Token.deploy("USD Coin", "USDC");
    const VlSDT = await ethers.getContractFactory("MockVlSDT");
    const vlSdt = await VlSDT.deploy(await sdt.getAddress());
    const VlBoost = await ethers.getContractFactory("MockVlBoost");
    const vlBoost = await VlBoost.deploy();
    const Marketplace = await ethers.getContractFactory("MockMarketplace");
    const marketplace = await Marketplace.deploy();
    const CyvlSDT = await ethers.getContractFactory("MockCyvlSdt");
    const cyvlSdt = await CyvlSDT.deploy();
    const Router = await ethers.getContractFactory("MockStakeDaoRouter");
    const router = await Router.deploy();
    const FeeDistributor = await ethers.getContractFactory("MockFeeDistributor");
    const usdcDistributor = await FeeDistributor.deploy(await usdc.getAddress());
    const sdtDistributor = await FeeDistributor.deploy(await sdt.getAddress());
    const RevenueStaking = await ethers.getContractFactory(
      "MockRevenueStakingForLocker"
    );
    const revenueStaking = await RevenueStaking.deploy();

    await usdcDistributor.setOperator(await router.getAddress());
    await sdtDistributor.setOperator(await router.getAddress());

    const Locker = await ethers.getContractFactory("CurveYieldVlSDTLocker");
    const locker = await Locker.deploy(
      owner.address,
      treasury.address,
      await sdt.getAddress(),
      await vlSdt.getAddress(),
      await vlBoost.getAddress(),
      await router.getAddress(),
      await usdcDistributor.getAddress(),
      await sdtDistributor.getAddress(),
      await marketplace.getAddress(),
      await cyvlSdt.getAddress()
    );
    await locker.configureSystem(
      await revenueStaking.getAddress(),
      boostStaking.address,
      boostMerchant.address
    );

    await sdt.mint(depositor.address, principal);
    await sdt.connect(depositor).approve(await locker.getAddress(), principal);
    await locker.connect(depositor).deposit(principal, depositor.address);

    return {
      principal,
      keeper,
      sdt,
      usdc,
      vlSdt,
      cyvlSdt,
      router,
      usdcDistributor,
      sdtDistributor,
      revenueStaking,
      locker
    };
  }

  function expectedRouterCalls(ctx) {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    return {
      claim: ethers.concat([
        "0x0c",
        "0xb38aab9d",
        coder.encode(
          ["address[]"],
          [[
            ctx.usdcDistributor.target,
            ctx.sdtDistributor.target
          ]]
        )
      ]),
      sweep: ethers.concat([
        "0x07",
        "0x780469bb",
        coder.encode(
          ["address[]"],
          [[ctx.usdc.target, ctx.sdt.target]]
        )
      ])
    };
  }

  async function seedReward(distributor, token, locker, amount) {
    await token.mint(await distributor.getAddress(), amount);
    await distributor.setClaimAmount(await locker.getAddress(), amount);
  }

  it("matches the verified Router calldata and forwards both rewards", async function () {
    const ctx = await fixture();
    const usdcReward = ethers.parseEther("100");
    const sdtReward = ethers.parseEther("25");
    await seedReward(ctx.usdcDistributor, ctx.usdc, ctx.locker, usdcReward);
    await seedReward(ctx.sdtDistributor, ctx.sdt, ctx.locker, sdtReward);

    await expect(ctx.locker.connect(ctx.keeper).claimVlSDTRewards())
      .to.emit(ctx.locker, "VlSDTRewardClaimed")
      .withArgs(
        await ctx.usdc.getAddress(),
        usdcReward,
        ethers.parseEther("0.1")
      )
      .and.to.emit(ctx.locker, "VlSDTRewardClaimed")
      .withArgs(
        await ctx.sdt.getAddress(),
        sdtReward,
        ethers.parseEther("0.025")
      );

    const expected = expectedRouterCalls(ctx);
    expect(await ctx.router.lastClaimCall()).to.equal(expected.claim);
    expect(await ctx.router.lastSweepCall()).to.equal(expected.sweep);

    expect(
      await ctx.revenueStaking.notifiedAmount(await ctx.usdc.getAddress())
    ).to.equal(usdcReward);
    expect(
      await ctx.revenueStaking.notifiedAmount(await ctx.sdt.getAddress())
    ).to.equal(sdtReward);
    expect(await ctx.usdc.balanceOf(await ctx.locker.getAddress())).to.equal(0);
    expect(await ctx.sdt.balanceOf(await ctx.locker.getAddress())).to.equal(0);
    expect(
      await ctx.usdc.allowance(
        await ctx.locker.getAddress(),
        await ctx.revenueStaking.getAddress()
      )
    ).to.equal(0);
    expect(
      await ctx.sdt.allowance(
        await ctx.locker.getAddress(),
        await ctx.revenueStaking.getAddress()
      )
    ).to.equal(0);
  });

  it("does not let a zero USDC claim block a nonzero SDT claim", async function () {
    const ctx = await fixture();
    const sdtReward = ethers.parseEther("10");
    await seedReward(ctx.sdtDistributor, ctx.sdt, ctx.locker, sdtReward);

    await expect(ctx.locker.connect(ctx.keeper).claimVlSDTRewards())
      .to.emit(ctx.locker, "VlSDTRewardClaimed")
      .withArgs(
        await ctx.sdt.getAddress(),
        sdtReward,
        ethers.parseEther("0.01")
      );

    expect(
      await ctx.revenueStaking.notifiedAmount(await ctx.usdc.getAddress())
    ).to.equal(0);
    expect(
      await ctx.revenueStaking.notifiedAmount(await ctx.sdt.getAddress())
    ).to.equal(sdtReward);
  });

  it("reverts honestly when both live reward deltas are zero", async function () {
    const ctx = await fixture();
    await expect(
      ctx.locker.connect(ctx.keeper).claimVlSDTRewards()
    ).to.be.revertedWithCustomError(ctx.locker, "NoRewardClaimed");
  });
});
