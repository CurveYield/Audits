"use strict";

const { expect } = require("chai");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;

async function deadline() {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block.timestamp + DAY);
}

describe("CurveYield V20 minimal marketplace forwarding and USDC route", function () {
  async function lockerFixture() {
    const [owner, treasury, depositor, boostStaking, boostMerchant, keeper] =
      await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const sdt = await Token.deploy("Stake DAO Token", "SDT");
    const usdc = await Token.deploy("USD Coin", "USDC");
    const VlSDT = await ethers.getContractFactory("MockVlSDT");
    const vlSdt = await VlSDT.deploy(await sdt.getAddress());
    const VlBoost = await ethers.getContractFactory("MockVlBoost");
    const vlBoost = await VlBoost.deploy();
    const Marketplace = await ethers.getContractFactory("MockMarketplace");
    const marketplace = await Marketplace.deploy();
    const Cyvl = await ethers.getContractFactory("MockCyvlSdt");
    const cyvl = await Cyvl.deploy();
    const Router = await ethers.getContractFactory("MockStakeDaoRouter");
    const router = await Router.deploy();
    const FeeDistributor = await ethers.getContractFactory("MockFeeDistributor");
    const usdcDistributor = await FeeDistributor.deploy(await usdc.getAddress());
    const sdtDistributor = await FeeDistributor.deploy(await sdt.getAddress());
    const Receiver = await ethers.getContractFactory("MockRevenueStakingForLocker");
    const revenueStaking = await Receiver.deploy();

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
      await cyvl.getAddress()
    );
    await locker.configureSystem(
      await revenueStaking.getAddress(),
      boostStaking.address,
      boostMerchant.address
    );

    return { keeper, usdc, locker, revenueStaking };
  }

  it("lets any caller forward the Locker's complete marketplace-token balance directly to Revenue Staking", async function () {
    const ctx = await lockerFixture();
    const amount = ethers.parseUnits("100", 6);
    await ctx.usdc.mint(await ctx.locker.getAddress(), amount);

    await expect(
      ctx.locker.connect(ctx.keeper)["forwardMarketplaceRevenue(address)"](
        await ctx.usdc.getAddress()
      )
    )
      .to.emit(ctx.locker, "MarketplaceRevenueForwarded")
      .withArgs(await ctx.usdc.getAddress(), amount);

    expect(await ctx.usdc.balanceOf(await ctx.locker.getAddress())).to.equal(0);
    expect(
      await ctx.revenueStaking.notifiedAmount(await ctx.usdc.getAddress())
    ).to.equal(amount);
  });

  async function converterFixture() {
    const [owner, user, recipient] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const usdc = await Token.deploy("USD Coin", "USDC");
    const wbtc = await Token.deploy("Wrapped BTC", "WBTC");
    const weth = await Token.deploy("Wrapped Ether", "WETH");
    const sdt = await Token.deploy("Stake DAO Token", "SDT");
    const Cyvl = await ethers.getContractFactory("MockCyvlSdt");
    const cyvl = await Cyvl.deploy();
    const Locker = await ethers.getContractFactory("MockLockerForCompounder");
    const locker = await Locker.deploy(await sdt.getAddress(), await cyvl.getAddress());
    const Converter = await ethers.getContractFactory("CurveYieldRevenueConverter");
    const converter = await Converter.deploy(
      owner.address,
      await sdt.getAddress(),
      await cyvl.getAddress(),
      await locker.getAddress()
    );
    const Tri = await ethers.getContractFactory("MockTricryptoUsdcPool");
    const tri = await Tri.deploy(
      await usdc.getAddress(),
      await wbtc.getAddress(),
      await weth.getAddress()
    );
    const Two = await ethers.getContractFactory("MockTwoCryptoPool");
    const two = await Two.deploy(await weth.getAddress(), await sdt.getAddress());
    await tri.setPriceOracle(ethers.parseEther("2000"));
    await two.setPriceOracle(50_000_000_000_000n);

    const Route = await ethers.getContractFactory("CurveYieldUsdcToSdtConverter");
    const route = await Route.deploy(
      await converter.getAddress(),
      await usdc.getAddress(),
      await wbtc.getAddress(),
      await weth.getAddress(),
      await sdt.getAddress(),
      await tri.getAddress(),
      await two.getAddress()
    );
    await converter.setUsdcRoute(await usdc.getAddress(), await route.getAddress());

    const input = ethers.parseUnits("100", 6);
    await usdc.mint(user.address, input);
    await usdc.connect(user).approve(await converter.getAddress(), input);

    return { owner, user, recipient, usdc, weth, sdt, cyvl, locker, converter, tri, two, route, input };
  }

  it("quotes the complete route with one 199-bps haircut", async function () {
    const ctx = await converterFixture();
    const rawSdt = ethers.parseEther("1000");
    expect(
      await ctx.route.quote(
        await ctx.usdc.getAddress(),
        await ctx.sdt.getAddress(),
        ctx.input
      )
    ).to.equal(rawSdt * 9801n / 10000n);
    expect(await ctx.converter.quote(await ctx.usdc.getAddress(), ctx.input)).to.equal(
      rawSdt * 9801n / 10000n
    );
  });

  it("uses wrapped WETH, returns SDT to the central converter, and mints cyvlSDT only through the Locker", async function () {
    const ctx = await converterFixture();
    const wethOut = ethers.parseEther("0.05");
    const sdtOut = ethers.parseEther("1000");
    await ctx.tri.setNextDy(wethOut);
    await ctx.two.setNextDy(sdtOut);

    const minimum = await ctx.converter.quote(await ctx.usdc.getAddress(), ctx.input);
    await ctx.converter.connect(ctx.user).convert(
      await ctx.usdc.getAddress(),
      ctx.input,
      minimum,
      ctx.recipient.address,
      await deadline()
    );

    expect(await ctx.tri.lastI()).to.equal(0);
    expect(await ctx.tri.lastJ()).to.equal(2);
    expect(await ctx.tri.lastUseEth()).to.equal(false);
    expect(await ctx.tri.lastReceiver()).to.equal(await ctx.route.getAddress());
    expect(await ctx.two.lastI()).to.equal(0);
    expect(await ctx.two.lastJ()).to.equal(1);
    expect(await ctx.two.lastReceiver()).to.equal(await ctx.route.getAddress());
    expect(await ctx.sdt.balanceOf(await ctx.converter.getAddress())).to.equal(0);
    expect(await ctx.locker.deposits()).to.equal(sdtOut);
    expect(await ctx.cyvl.balanceOf(ctx.recipient.address)).to.equal(sdtOut);
  });

  it("rejects direct calls to the fixed route", async function () {
    const ctx = await converterFixture();
    await expect(
      ctx.route.connect(ctx.user).swap(
        await ctx.usdc.getAddress(),
        await ctx.sdt.getAddress(),
        ctx.input,
        0,
        await ctx.converter.getAddress(),
        await deadline()
      )
    ).to.be.revertedWithCustomError(ctx.route, "OnlyRevenueConverter");
  });
});
