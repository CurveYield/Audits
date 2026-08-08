const { expect } = require("chai");
const { ethers } = require("hardhat");

async function deployFixture() {
  const [owner, alice, bob, delegatee, treasury] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const governance = await Token.deploy("CurveYield Governance", "cyGOV");
  const Staking = await ethers.getContractFactory("CurveYieldGovernanceStaking");
  const staking = await Staking.deploy(
    owner.address,
    await governance.getAddress(),
    treasury.address,
    "Staked CurveYield Governance",
    "stcyGOV",
    300,
    0,
    14 * 24 * 60 * 60
  );
  const Strategy = await ethers.getContractFactory("CurveYieldGovernanceBoostStrategy");
  const strategy = await Strategy.deploy(await staking.getAddress(), ethers.ZeroAddress);
  await staking.setGovernanceBoostStrategy(await strategy.getAddress());
  await strategy.setProposalRegistrar(owner.address, true);
  const Voting = await ethers.getContractFactory("MockAragonTokenVoting");
  const voting = await Voting.deploy();
  await strategy.setAragonVotingPlugin(await voting.getAddress());

  for (const user of [alice, bob]) {
    await governance.mint(user.address, ethers.parseEther("100"));
    await governance.connect(user).approve(await staking.getAddress(), ethers.MaxUint256);
    await staking.connect(user).stake(ethers.parseEther("100"));
  }
  await staking.connect(bob).delegate(delegatee.address);
  return { owner, alice, bob, delegatee, governance, staking, strategy, voting };
}

async function registerClosedProposals(strategy, voting, proposalIds, snapshot, voters) {
  const latest = await ethers.provider.getBlock("latest");
  for (const id of proposalIds) {
    await voting.setProposal(id, false, latest.timestamp - 100, latest.timestamp - 1, snapshot);
    for (const voter of voters) await voting.setVoteOption(id, voter, 2); // Yes.
  }
  await strategy.registerFinalizedProposals(
    await strategy.registeredProposalCount(), proposalIds
  );
}

describe("CurveYieldGovernanceBoostStrategy V20 integration", function () {
  it("owns governance administration and community bonus policy", async function () {
    const { owner, alice, staking, strategy, voting } = await deployFixture();
    const snapshot = await ethers.provider.getBlockNumber();
    const ids = Array.from({ length: 12 }, (_, i) => i + 1);
    await registerClosedProposals(strategy, voting, ids, snapshot, [alice.address]);
    await staking.kick(alice.address);
    expect(await strategy.governanceBoostBps(alice.address)).to.equal(30000);
    expect(await staking.participationWeight(alice.address)).to.equal(
      ethers.parseEther("300")
    );

    await expect(strategy.connect(alice).setCommunityBonusBps(alice.address, 15000))
      .to.be.revertedWithCustomError(strategy, "OnlyGovernanceOwner");
    await strategy.connect(owner).setCommunityBonusBps(alice.address, 15000);
    expect(await strategy.governanceBoostBps(alice.address)).to.equal(45000);
    expect(await staking.participationWeight(alice.address)).to.equal(
      ethers.parseEther("450")
    );
  });

  it("credits six delegated proposal votes as a 1.5x base multiplier", async function () {
    const { bob, delegatee, staking, strategy, voting } = await deployFixture();
    const snapshot = await ethers.provider.getBlockNumber();
    await registerClosedProposals(
      strategy, voting, [21, 22, 23, 24, 25, 26], snapshot, [delegatee.address]
    );
    await staking.kick(bob.address);
    expect(await strategy.governanceBoostBps(bob.address)).to.equal(15000);
  });

  it("migrates community bonuses through a valid strategy replacement chain", async function () {
    const { owner, alice, staking, strategy, voting } = await deployFixture();
    const snapshot = await ethers.provider.getBlockNumber();
    await registerClosedProposals(strategy, voting, [31], snapshot, [alice.address]);
    await staking.kick(alice.address);
    await strategy.connect(owner).setCommunityBonusBps(alice.address, 15000);

    const Strategy = await ethers.getContractFactory("CurveYieldGovernanceBoostStrategy");
    const replacement = await Strategy.deploy(await staking.getAddress(), await strategy.getAddress());
    await expect(staking.connect(owner).setGovernanceBoostStrategy(await replacement.getAddress()))
      .to.emit(staking, "GovernanceBoostStrategySet");
    expect(await replacement.previousStrategy()).to.equal(await strategy.getAddress());
    expect(await replacement.registeredProposalCount()).to.equal(1);
    expect(await replacement.communityBonusBps(alice.address)).to.equal(15000);
    expect(await replacement.governanceBoostBps(alice.address)).to.equal(26666);
    await staking.kick(alice.address);
    expect(await staking.participationWeight(alice.address)).to.equal(
      ethers.parseEther("266.66")
    );

    const invalid = await Strategy.deploy(await staking.getAddress(), ethers.ZeroAddress);
    await expect(staking.connect(owner).setGovernanceBoostStrategy(await invalid.getAddress()))
      .to.be.revertedWithCustomError(staking, "InvalidPreviousGovernanceBoostStrategy");
  });
});
