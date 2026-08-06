const { expect } = require("chai");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;
const E18 = 10n ** 18n;
const B = 1_000_000_000n * E18;

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployCore() {
  const [owner, alice, treasury] = await ethers.getSigners();
  const GovernanceToken = await ethers.getContractFactory("CurveYieldGovernanceToken");
  const governanceToken = await GovernanceToken.deploy(owner.address, "CurveYield Governance", "cyGOV");

  const Mock = await ethers.getContractFactory("MockERC20");
  const cyvlSdt = await Mock.deploy("cyvlSDT", "cyvlSDT");

  const GovernanceStaking = await ethers.getContractFactory("CurveYieldGovernanceStaking");
  const governanceStaking = await GovernanceStaking.deploy(
    owner.address,
    await governanceToken.getAddress(),
    treasury.address,
    "Staked CurveYield Governance",
    "stcyGOV",
    300,
    0,
    14 * DAY
  );

  const GovernanceMintController = await ethers.getContractFactory("CurveYieldGovernanceMintController");
  const governanceMintController = await GovernanceMintController.deploy(
    owner.address,
    await governanceToken.getAddress(),
    await governanceStaking.getAddress()
  );
  await governanceStaking.setGovernanceMintController(await governanceMintController.getAddress());

  const CyGovYieldStaking = await ethers.getContractFactory("CurveYieldCyGovYieldStaking");
  const cyGovYieldStaking = await CyGovYieldStaking.deploy(
    owner.address,
    await cyvlSdt.getAddress(),
    await governanceToken.getAddress(),
    treasury.address
  );

  const Revenue = await ethers.getContractFactory("CurveYieldVlSDTRevenueStaking");
  const revenue = await Revenue.deploy(
    owner.address,
    owner.address,
    treasury.address,
    await cyvlSdt.getAddress(),
    await governanceToken.getAddress()
  );

  const Boost = await ethers.getContractFactory("CurveYieldVlSDTBoostStaking");
  const boost = await Boost.deploy(
    owner.address,
    await cyvlSdt.getAddress(),
    owner.address,
    await governanceToken.getAddress()
  );

  const revenueAddress = await revenue.getAddress();
  const boostAddress = await boost.getAddress();
  const cyGovYieldStakingAddress = await cyGovYieldStaking.getAddress();
  const governanceMintControllerAddress = await governanceMintController.getAddress();

  await governanceToken.setMinterAllocation(revenueAddress, 5n * B, 800);
  await governanceToken.setMinterAllocation(boostAddress, 10n * B, 1200);
  await governanceToken.setMinterAllocation(cyGovYieldStakingAddress, 15n * B, 3000);
  await governanceToken.setMinterAllocation(governanceMintControllerAddress, 20n * B, 3000);
  await governanceToken.setMinters(
    [revenueAddress, boostAddress, cyGovYieldStakingAddress, governanceMintControllerAddress],
    true
  );

  return {
    owner,
    alice,
    treasury,
    governanceToken,
    governanceStaking,
    governanceMintController,
    revenue,
    boost,
    cyGovYieldStaking,
    cyvlSdt
  };
}

describe("CurveYield V18.9 governance mint controls", function () {
  it("implements the approved unlock schedule and permanent 4B monthly floor", async function () {
    const { governanceToken } = await deployCore();
    expect(await governanceToken.unlockedSupply()).to.equal(200n * B);
    expect(await governanceToken.monthlyMintAllotment(1)).to.equal(20n * B);
    expect(await governanceToken.monthlyMintAllotment(21)).to.equal(10n * B);
    expect(await governanceToken.monthlyMintAllotment(22)).to.equal(98n * B / 10n);
    expect(await governanceToken.monthlyMintAllotment(51)).to.equal(4n * B);
    expect(await governanceToken.monthlyMintAllotment(52)).to.equal(4n * B);

    await increaseTime(51 * MONTH);
    expect(await governanceToken.unlockedSupply()).to.equal(722n * B);
  });

  it("configures the four approved cumulative module quotas", async function () {
    const { governanceToken, revenue, boost, cyGovYieldStaking, governanceMintController } = await deployCore();
    const revenueAllocation = await governanceToken.minterAllocation(await revenue.getAddress());
    const boostAllocation = await governanceToken.minterAllocation(await boost.getAddress());
    const yieldAllocation = await governanceToken.minterAllocation(await cyGovYieldStaking.getAddress());
    const governanceAllocation = await governanceToken.minterAllocation(await governanceMintController.getAddress());

    expect(revenueAllocation.initialCap).to.equal(5n * B);
    expect(revenueAllocation.additionalBps).to.equal(800n);
    expect(boostAllocation.initialCap).to.equal(10n * B);
    expect(boostAllocation.additionalBps).to.equal(1200n);
    expect(yieldAllocation.initialCap).to.equal(15n * B);
    expect(yieldAllocation.additionalBps).to.equal(3000n);
    expect(governanceAllocation.initialCap).to.equal(20n * B);
    expect(governanceAllocation.additionalBps).to.equal(3000n);
    expect(await governanceToken.totalInitialMinterCaps()).to.equal(50n * B);
    expect(await governanceToken.totalAdditionalMinterBps()).to.equal(8000n);
  });

  it("records original allocations and exposes independent 30% floors", async function () {
    const { governanceToken, revenue, boost, cyGovYieldStaking, governanceMintController } = await deployCore();
    const cases = [
      [await revenue.getAddress(), 5n * B, 800n, 15n * B / 10n, 240n],
      [await boost.getAddress(), 10n * B, 1200n, 3n * B, 360n],
      [await cyGovYieldStaking.getAddress(), 15n * B, 3000n, 45n * B / 10n, 900n],
      [await governanceMintController.getAddress(), 20n * B, 3000n, 6n * B, 900n]
    ];

    for (const [minter, originalInitial, originalBps, minimumInitial, minimumBps] of cases) {
      expect(await governanceToken.originalMinterAllocationConfigured(minter)).to.equal(true);
      const original = await governanceToken.originalMinterAllocation(minter);
      const minimum = await governanceToken.minimumMinterAllocation(minter);
      expect(original.initialCap).to.equal(originalInitial);
      expect(original.additionalBps).to.equal(originalBps);
      expect(minimum.minimumInitialCap).to.equal(minimumInitial);
      expect(minimum.minimumAdditionalBps).to.equal(minimumBps);
    }
  });

  it("queues a 30% allocation reduction for fourteen days and permits restoration", async function () {
    const { governanceToken, revenue } = await deployCore();
    const revenueAddress = await revenue.getAddress();
    await increaseTime(7 * DAY);

    await governanceToken.setMinterAllocation(revenueAddress, 15n * B / 10n, 240);
    let pending = await governanceToken.pendingMinterAllocation(revenueAddress);
    expect(pending.pending).to.equal(true);
    await expect(
      governanceToken.executeMinterAllocation(revenueAddress)
    ).to.be.revertedWithCustomError(governanceToken, "TimelockNotReady");

    await increaseTime(14 * DAY);
    await governanceToken.executeMinterAllocation(revenueAddress);
    let current = await governanceToken.minterAllocation(revenueAddress);
    expect(current.initialCap).to.equal(15n * B / 10n);
    expect(current.additionalBps).to.equal(240n);

    await governanceToken.setMinterAllocation(revenueAddress, 5n * B, 800);
    await increaseTime(14 * DAY);
    await governanceToken.executeMinterAllocation(revenueAddress);
    current = await governanceToken.minterAllocation(revenueAddress);
    expect(current.initialCap).to.equal(5n * B);
    expect(current.additionalBps).to.equal(800n);
  });

  it("rejects post-setup allocations below 30% or above the original maximum", async function () {
    const { governanceToken, revenue } = await deployCore();
    const revenueAddress = await revenue.getAddress();
    await increaseTime(7 * DAY);

    await expect(
      governanceToken.setMinterAllocation(revenueAddress, 15n * B / 10n - 1n, 240)
    ).to.be.revertedWithCustomError(governanceToken, "MinterAllocationOutsidePermittedRange");
    await expect(
      governanceToken.setMinterAllocation(revenueAddress, 15n * B / 10n, 239)
    ).to.be.revertedWithCustomError(governanceToken, "MinterAllocationOutsidePermittedRange");
    await expect(
      governanceToken.setMinterAllocation(revenueAddress, 5n * B + 1n, 800)
    ).to.be.revertedWithCustomError(governanceToken, "MinterAllocationOutsidePermittedRange");
  });

  it("allows a reduction with reservations that fit inside the proposed allowance", async function () {
    const { governanceToken, revenue } = await deployCore();
    const revenueAddress = await revenue.getAddress();
    await increaseTime(7 * DAY);

    await governanceToken.setMinterAllocation(revenueAddress, 15n * B / 10n, 240);
    await revenue.proposeOneTimeGovernanceMint(1n * B);
    expect(await governanceToken.reservedByMinter(revenueAddress)).to.equal(1n * B);

    await increaseTime(14 * DAY);
    await governanceToken.executeMinterAllocation(revenueAddress);
    const current = await governanceToken.minterAllocation(revenueAddress);
    expect(current.initialCap).to.equal(15n * B / 10n);
    expect(current.additionalBps).to.equal(240n);
  });

  it("rejects a proposed reduction that conflicts with minted or reserved usage", async function () {
    const { governanceToken, revenue } = await deployCore();
    const revenueAddress = await revenue.getAddress();
    await increaseTime(7 * DAY);
    await revenue.proposeOneTimeGovernanceMint(2n * B);

    await expect(
      governanceToken.setMinterAllocation(revenueAddress, 15n * B / 10n, 240)
    ).to.be.revertedWithCustomError(governanceToken, "MinterAllocationBelowUsage");
  });

  it("rechecks utilized mint space when a delayed reduction is executed", async function () {
    const { governanceToken, revenue } = await deployCore();
    const revenueAddress = await revenue.getAddress();
    await increaseTime(7 * DAY);

    await governanceToken.setMinterAllocation(revenueAddress, 15n * B / 10n, 240);
    await revenue.proposeOneTimeGovernanceMint(2n * B);
    await increaseTime(14 * DAY);

    await expect(
      governanceToken.executeMinterAllocation(revenueAddress)
    ).to.be.revertedWithCustomError(governanceToken, "MinterAllocationBelowUsage");
  });

  it("does not let a reservation borrow capacity from a future monthly unlock", async function () {
    const { owner, alice, governanceToken } = await deployCore();
    await governanceToken.setMinterAllocation(alice.address, 1n * B, 0);
    await governanceToken.setMinter(alice.address, true);

    await expect(
      governanceToken.connect(alice).reserveMint(2n * B, (await ethers.provider.getBlock("latest")).timestamp + MONTH)
    ).to.be.revertedWithCustomError(governanceToken, "MintExceedsMinterAllocation");

    expect(await governanceToken.totalReservedMint()).to.equal(0n);
    expect(await governanceToken.balanceOf(owner.address)).to.equal(0n);
  });

  it("counts approved obligations from every contract before accepting another stream", async function () {
    const { owner, governanceToken, governanceMintController, revenue, boost, cyGovYieldStaking } = await deployCore();
    await cyGovYieldStaking.setMaxMintRate(B / 2n); // 15B of protected 30-day backing during setup.
    await increaseTime(7 * DAY);

    await governanceToken.proposeOwnerMint(owner.address, 150n * B);
    await revenue.proposeOneTimeGovernanceMint(5n * B);
    await boost.proposeOneTimeGovernanceMint(10n * B);
    await governanceMintController.proposeOneTimeGovernanceMint(20n * B);

    expect(await governanceToken.totalReservedMint()).to.equal(200n * B);
    await expect(
      governanceMintController.proposePeriodicGovernanceMint(1n * B, MONTH)
    ).to.be.revertedWithCustomError(governanceToken, "MintExceedsUnlockedSupply");
  });

  it("enforces the Revenue Staking 5B initial cap independently of global headroom", async function () {
    const { governanceToken, revenue } = await deployCore();
    await increaseTime(7 * DAY);
    await expect(
      revenue.proposeOneTimeGovernanceMint(5n * B + 1n)
    ).to.be.revertedWithCustomError(governanceToken, "MintExceedsMinterAllocation");
  });

  it("delays new minters by fourteen days after the seven-day setup period", async function () {
    const { alice, governanceToken } = await deployCore();
    await increaseTime(7 * DAY);
    await governanceToken.setMinter(alice.address, true);
    expect(await governanceToken.isMinter(alice.address)).to.equal(false);
    await expect(governanceToken.executeMinterAddition(alice.address)).to.be.revertedWithCustomError(
      governanceToken,
      "TimelockNotReady"
    );
    await increaseTime(14 * DAY);
    await governanceToken.executeMinterAddition(alice.address);
    expect(await governanceToken.isMinter(alice.address)).to.equal(true);
  });

  it("requires a seven-day owner-mint request after setup", async function () {
    const { alice, governanceToken } = await deployCore();
    await increaseTime(7 * DAY);
    await expect(governanceToken.mint(alice.address, 1n)).to.be.revertedWithCustomError(
      governanceToken,
      "OwnerMintRequiresTimelock"
    );
    await governanceToken.proposeOwnerMint(alice.address, 123n);
    await expect(governanceToken.executeOwnerMint(1)).to.be.revertedWithCustomError(
      governanceToken,
      "TimelockNotReady"
    );
    await increaseTime(7 * DAY);
    await governanceToken.executeOwnerMint(1);
    expect(await governanceToken.balanceOf(alice.address)).to.equal(123n);
  });

  it("mints Governance Staking rewards into the next participation batch", async function () {
    const { governanceToken, governanceStaking, governanceMintController } = await deployCore();
    const amount = ethers.parseEther("100");
    await governanceMintController.proposeOneTimeGovernanceMint(amount);
    expect(await governanceToken.balanceOf(await governanceStaking.getAddress())).to.equal(amount);
    expect(await governanceStaking.pendingParticipationReward(await governanceToken.getAddress())).to.equal(amount);
    expect(await governanceStaking.pendingReward(await governanceToken.getAddress())).to.equal(0);
  });

  it("reserves only the next periodic installment and pauses when the next reservation cannot fit", async function () {
    const { governanceToken, governanceMintController } = await deployCore();
    await governanceMintController.proposePeriodicGovernanceMint(20n * B, DAY);
    expect(
      await governanceToken.reservedByMinter(await governanceMintController.getAddress())
    ).to.equal(20n * B);

    await increaseTime(DAY);
    await governanceMintController.executePeriodicGovernanceMint();
    expect(await governanceMintController.periodicGovernanceMintReservationId()).to.equal(0n);
    await increaseTime(DAY);
    await expect(
      governanceMintController.executePeriodicGovernanceMint()
    ).to.be.revertedWithCustomError(
      governanceMintController,
      "PeriodicMintReservationMissing"
    );
  });
});
