const { expect } = require("chai");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployFixture({ standardFeeBps = 300, baseFeeBps = 0, delay = 14 * DAY } = {}) {
  const [owner, alice, treasury, receiver] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const governance = await Token.deploy("CurveYield Governance", "cyGOV");
  const Staking = await ethers.getContractFactory("CurveYieldGovernanceStaking");
  const staking = await Staking.deploy(
    owner.address,
    await governance.getAddress(),
    treasury.address,
    "Staked CurveYield Governance",
    "stcyGOV",
    standardFeeBps,
    baseFeeBps,
    delay
  );
  const Strategy = await ethers.getContractFactory("CurveYieldGovernanceBoostStrategy");
  const strategy = await Strategy.deploy(await staking.getAddress(), ethers.ZeroAddress);
  await staking.setGovernanceBoostStrategy(await strategy.getAddress());

  await governance.mint(alice.address, ethers.parseEther("1000"));
  await governance.connect(alice).approve(await staking.getAddress(), ethers.MaxUint256);
  return { owner, alice, treasury, receiver, governance, staking, strategy };
}

describe("CurveYieldGovernanceStaking V18 withdrawals", function () {
  it("offers immediate base-plus-standard exit while a paid delayed route exists", async function () {
    const { alice, treasury, receiver, governance, staking } = await deployFixture();
    await staking.connect(alice).stake(ethers.parseEther("100"));

    const treasuryBefore = await governance.balanceOf(treasury.address);
    const receiverBefore = await governance.balanceOf(receiver.address);
    await staking.connect(alice).withdrawImmediately(ethers.parseEther("10"), receiver.address);

    expect((await governance.balanceOf(treasury.address)) - treasuryBefore)
      .to.equal(ethers.parseEther("0.3"));
    expect((await governance.balanceOf(receiver.address)) - receiverBefore)
      .to.equal(ethers.parseEther("9.7"));
  });

  it("burns queued stake immediately and charges only the base fee after unlock", async function () {
    const { alice, treasury, receiver, governance, staking } = await deployFixture({
      standardFeeBps: 300,
      baseFeeBps: 100,
      delay: 14 * DAY
    });
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await expect(staking.connect(alice).requestWithdrawal(ethers.parseEther("40"), receiver.address))
      .to.emit(staking, "WithdrawalRequested");
    expect(await staking.balanceOf(alice.address)).to.equal(ethers.parseEther("60"));

    await increaseTime(14 * DAY);
    const treasuryBefore = await governance.balanceOf(treasury.address);
    const receiverBefore = await governance.balanceOf(receiver.address);
    await staking.completeWithdrawal(1);
    expect((await governance.balanceOf(treasury.address)) - treasuryBefore)
      .to.equal(ethers.parseEther("0.4"));
    expect((await governance.balanceOf(receiver.address)) - receiverBefore)
      .to.equal(ethers.parseEther("39.6"));
  });


  it("keeps queued fee and delay snapshots unchanged after later configuration changes", async function () {
    const { owner, alice, treasury, receiver, governance, staking } = await deployFixture({
      standardFeeBps: 300,
      baseFeeBps: 100,
      delay: 14 * DAY
    });
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await staking.connect(alice).requestWithdrawal(ethers.parseEther("20"), receiver.address);

    const request = await staking.withdrawalRequests(1);
    expect(request.standardFeeBps).to.equal(300);
    expect(request.baseFeeBps).to.equal(100);
    expect(request.receiver).to.equal(receiver.address);

    await staking.connect(owner).setWithdrawalConfig(1500, 300, 150 * DAY);
    const unchanged = await staking.withdrawalRequests(1);
    expect(unchanged.standardFeeBps).to.equal(300);
    expect(unchanged.baseFeeBps).to.equal(100);
    expect(unchanged.unlockTime).to.equal(request.unlockTime);

    await increaseTime(14 * DAY);
    const treasuryBefore = await governance.balanceOf(treasury.address);
    await staking.completeWithdrawal(1);
    expect((await governance.balanceOf(treasury.address)) - treasuryBefore)
      .to.equal(ethers.parseEther("0.2"));
  });

  it("reduces only half of the standard fee linearly across the queued delay", async function () {
    const { alice, receiver, staking } = await deployFixture({
      standardFeeBps: 1000,
      baseFeeBps: 100,
      delay: 100 * DAY
    });
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await staking.connect(alice).requestWithdrawal(ethers.parseEther("10"), receiver.address);
    await increaseTime(50 * DAY);

    const feeBps = await staking.currentEarlyWithdrawalFeeBps(1);
    expect(feeBps).to.be.closeTo(850n, 1n); // 1% base + 7.5% prorated standard fee.
    await expect(staking.connect(alice).completeWithdrawalEarly(1))
      .to.emit(staking, "EarlyWithdrawalCompleted");
  });

  it("requires the delayed route when standard fee is zero but delay is nonzero", async function () {
    const { alice, receiver, staking } = await deployFixture({ standardFeeBps: 0, baseFeeBps: 0, delay: 14 * DAY });
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await expect(staking.connect(alice).withdrawImmediately(ethers.parseEther("1"), receiver.address))
      .to.be.revertedWithCustomError(staking, "ImmediateWithdrawalDisabled");
    await expect(staking.connect(alice).requestWithdrawal(ethers.parseEther("1"), receiver.address))
      .to.emit(staking, "WithdrawalRequested");
  });

  it("allows immediate base-only or fully free exits when standard fee and delay are zero", async function () {
    const baseOnly = await deployFixture({ standardFeeBps: 0, baseFeeBps: 100, delay: 0 });
    await baseOnly.staking.connect(baseOnly.alice).stake(ethers.parseEther("10"));
    const baseTreasuryBefore = await baseOnly.governance.balanceOf(baseOnly.treasury.address);
    await baseOnly.staking.connect(baseOnly.alice).requestWithdrawal(ethers.parseEther("10"), baseOnly.receiver.address);
    expect((await baseOnly.governance.balanceOf(baseOnly.treasury.address)) - baseTreasuryBefore)
      .to.equal(ethers.parseEther("0.1"));

    const free = await deployFixture({ standardFeeBps: 0, baseFeeBps: 0, delay: 0 });
    await free.staking.connect(free.alice).stake(ethers.parseEther("10"));
    const receiverBefore = await free.governance.balanceOf(free.receiver.address);
    await free.staking.connect(free.alice).requestWithdrawal(ethers.parseEther("10"), free.receiver.address);
    expect((await free.governance.balanceOf(free.receiver.address)) - receiverBefore)
      .to.equal(ethers.parseEther("10"));
  });

  it("uses direct setup changes for seven days and delayed proposals from the exact boundary onward", async function () {
    const { owner, staking } = await deployFixture();
    await staking.connect(owner).setWithdrawalConfig(400, 50, 10 * DAY);
    expect(await staking.standardWithdrawFeeBps()).to.equal(400);

    await increaseTime(7 * DAY);
    await expect(staking.connect(owner).setWithdrawalConfig(500, 50, 11 * DAY))
      .to.be.revertedWithCustomError(staking, "WithdrawalConfigSetupEnded");
    await staking.connect(owner).proposeWithdrawalConfig(500, 50, 11 * DAY);
    await expect(staking.connect(owner).executeWithdrawalConfig())
      .to.be.revertedWithCustomError(staking, "WithdrawalConfigNotReady");
    await increaseTime(7 * DAY);
    await staking.connect(owner).executeWithdrawalConfig();
    expect(await staking.standardWithdrawFeeBps()).to.equal(500);
    expect(await staking.baseWithdrawFeeBps()).to.equal(50);
    expect(await staking.withdrawalDelay()).to.equal(BigInt(11 * DAY));
  });
});
