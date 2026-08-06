const { expect } = require("chai");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;
const E18 = 10n ** 18n;
const B = 1_000_000_000n * E18;

async function setNextTimestamp(timestamp) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
}

async function fixture() {
  const [owner, alice, treasury] = await ethers.getSigners();

  const GovernanceToken = await ethers.getContractFactory("CurveYieldGovernanceToken");
  const governanceToken = await GovernanceToken.deploy(
    owner.address,
    "CurveYield Governance",
    "cyGOV"
  );

  const Mock = await ethers.getContractFactory("MockERC20");
  const cyvlSdt = await Mock.deploy("CurveYield vlSDT", "cyvlSDT");

  const YieldStaking = await ethers.getContractFactory("CurveYieldCyGovYieldStaking");
  const yieldStaking = await YieldStaking.deploy(
    owner.address,
    await cyvlSdt.getAddress(),
    await governanceToken.getAddress(),
    treasury.address
  );

  const stakingAddress = await yieldStaking.getAddress();
  await governanceToken.setMinterAllocation(stakingAddress, 15n * B, 3000);
  await governanceToken.setMinter(stakingAddress, true);

  return { owner, alice, treasury, governanceToken, cyvlSdt, yieldStaking };
}

async function stake(ctx, amount) {
  await ctx.cyvlSdt.mint(ctx.alice.address, amount);
  await ctx.cyvlSdt.connect(ctx.alice).approve(await ctx.yieldStaking.getAddress(), amount);
  await ctx.yieldStaking.connect(ctx.alice).stake(amount);
}

describe("CurveYield cyGOV Yield Staking V18.9", function () {
  it("locks thirty days of protected backing for maxMintRate", async function () {
    const ctx = await fixture();
    const dailyRate = B / 2n;

    await ctx.yieldStaking.setMaxMintRate(dailyRate);

    const reservationId = await ctx.yieldStaking.mintReservationId();
    expect(reservationId).to.not.equal(0n);
    expect(await ctx.yieldStaking.lockedMintReserve()).to.equal(15n * B);
    expect(await ctx.governanceToken.protectedMintReservation(reservationId)).to.equal(true);
    await expect(
      ctx.governanceToken.cancelMintReservation(reservationId)
    ).to.be.revertedWithCustomError(ctx.governanceToken, "InvalidMintReservation");

    await ctx.yieldStaking.setMaxMintRate(0);
    expect(await ctx.yieldStaking.lockedMintReserve()).to.equal(0n);
    expect(await ctx.governanceToken.reservedByMinter(await ctx.yieldStaking.getAddress())).to.equal(0n);
  });

  it("uses held cyGOV before minting from its protected reserve", async function () {
    const ctx = await fixture();
    await ctx.yieldStaking.setDailyDecayRate(0);
    await ctx.yieldStaking.mintInitialInventory(30n * E18);
    await ctx.yieldStaking.setTargetYield(E18);
    await ctx.yieldStaking.setMaxMintRate(E18);
    await stake(ctx, 10n * E18);

    const update = await ctx.yieldStaking.rewardLastUpdate();
    await setNextTimestamp(update + BigInt(DAY));
    await ctx.yieldStaking.connect(ctx.alice).claim(ctx.alice.address);

    expect(await ctx.governanceToken.balanceOf(ctx.alice.address)).to.equal(E18);
    expect(await ctx.governanceToken.mintedByMinter(await ctx.yieldStaking.getAddress())).to.equal(30n * E18);
    expect(await ctx.governanceToken.balanceOf(await ctx.yieldStaking.getAddress())).to.equal(29n * E18);
  });

  it("protects the first automatic reserve after held-only backing is consumed", async function () {
    const ctx = await fixture();
    await ctx.yieldStaking.setDailyDecayRate(0);
    await ctx.yieldStaking.mintInitialInventory(30n * E18);
    await ctx.yieldStaking.setTargetYield(E18);
    await ctx.yieldStaking.setMaxMintRate(E18);
    expect(await ctx.yieldStaking.mintReservationId()).to.equal(0n);
    await stake(ctx, 10n * E18);

    const update = await ctx.yieldStaking.rewardLastUpdate();
    await setNextTimestamp(update + BigInt(DAY));
    await ctx.yieldStaking.connect(ctx.alice).claim(ctx.alice.address);

    const reservationId = await ctx.yieldStaking.mintReservationId();
    expect(reservationId).to.not.equal(0n);
    expect(await ctx.governanceToken.protectedMintReservation(reservationId)).to.equal(true);
    await expect(
      ctx.governanceToken.cancelMintReservation(reservationId)
    ).to.be.revertedWithCustomError(ctx.governanceToken, "InvalidMintReservation");
  });

  it("settles elapsed-time decay linearly and sends it to Treasury", async function () {
    const ctx = await fixture();
    await stake(ctx, 1_000n * E18);

    const checkpoint = await ctx.yieldStaking.lastDecayCheckpoint();
    await setNextTimestamp(checkpoint + BigInt(10 * DAY));
    await ctx.yieldStaking.connect(ctx.alice).checkpoint();

    expect(await ctx.cyvlSdt.balanceOf(ctx.treasury.address)).to.equal(3n * E18);
    expect(await ctx.yieldStaking.balanceOf(ctx.alice.address)).to.equal(997n * E18);
  });


  it("produces the same linear decay and emissions with daily or annual checkpoints", async function () {
    const ctx = await fixture();
    await ctx.yieldStaking.setDailyDecayRate(10);
    await ctx.yieldStaking.mintInitialInventory(1_000_000n * E18);
    await ctx.yieldStaking.setTargetYield(E18);
    await ctx.yieldStaking.setMaxMintRate(10_000n * E18);
    await stake(ctx, 1_000n * E18);

    const start = await ctx.yieldStaking.lastDecayCheckpoint();
    const snapshot = await ethers.provider.send("evm_snapshot", []);

    await setNextTimestamp(start + BigInt(365 * DAY));
    await ctx.yieldStaking.connect(ctx.alice).checkpoint();
    const annualPrincipal = await ctx.yieldStaking.balanceOf(ctx.alice.address);
    const annualTreasury = await ctx.cyvlSdt.balanceOf(ctx.treasury.address);
    const annualRewards = await ctx.yieldStaking.totalRewardLiability();

    await ethers.provider.send("evm_revert", [snapshot]);
    for (let day = 1; day <= 365; ++day) {
      await setNextTimestamp(start + BigInt(day * DAY));
      await ctx.yieldStaking.connect(ctx.alice).checkpoint();
    }
    const dailyPrincipal = await ctx.yieldStaking.balanceOf(ctx.alice.address);
    const dailyTreasury = await ctx.cyvlSdt.balanceOf(ctx.treasury.address);
    const dailyRewards = await ctx.yieldStaking.totalRewardLiability();

    expect(annualPrincipal).to.equal(635n * E18);
    expect(dailyPrincipal).to.equal(annualPrincipal);
    expect(dailyTreasury).to.equal(annualTreasury);
    expect(dailyRewards).to.equal(annualRewards);
  });

  it("charges the initial two-percent withdrawal fee to Treasury", async function () {
    const ctx = await fixture();
    await ctx.yieldStaking.setDailyDecayRate(0);
    await stake(ctx, 100n * E18);

    await ctx.yieldStaking.connect(ctx.alice).withdrawAll(ctx.alice.address);

    expect(await ctx.cyvlSdt.balanceOf(ctx.alice.address)).to.equal(98n * E18);
    expect(await ctx.cyvlSdt.balanceOf(ctx.treasury.address)).to.equal(2n * E18);
  });
});
