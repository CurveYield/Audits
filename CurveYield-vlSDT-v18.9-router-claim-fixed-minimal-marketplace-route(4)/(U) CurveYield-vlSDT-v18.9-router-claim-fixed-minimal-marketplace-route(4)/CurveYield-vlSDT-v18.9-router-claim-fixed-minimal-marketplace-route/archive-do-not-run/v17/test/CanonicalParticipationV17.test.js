const { expect } = require("chai");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deploySystem() {
  const [dao, registrar, keeper, attacker, alice, bob] = await ethers.getSigners();
  const Gov = await ethers.getContractFactory("CurveYieldGovernanceTokenV17");
  const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
  const Staking = await ethers.getContractFactory("CurveYieldGovernanceStakingV17");
  const staking = await Staking.deploy(
    dao.address,
    await gov.getAddress(),
    "Staked CurveYield Governance",
    "stcyGOV",
    0,
    0
  );
  const Voting = await ethers.getContractFactory("MockAragonTokenVotingV17");
  const voting = await Voting.deploy();
  await staking.connect(dao).setAragonVotingPlugin(await voting.getAddress());
  await staking.connect(dao).setProposalRegistrar(registrar.address, true);

  for (const user of [alice, bob]) {
    await gov.connect(dao).mint(user.address, ethers.parseEther("200"));
    await gov.connect(user).approve(await staking.getAddress(), ethers.MaxUint256);
    await staking.connect(user).stake(ethers.parseEther("100"));
  }
  return { dao, registrar, keeper, attacker, alice, bob, gov, staking, voting };
}

async function createClosedProposal(voting, proposalId, snapshotTimepoint, voters = []) {
  const block = await ethers.provider.getBlock("latest");
  await voting.setProposal(
    proposalId,
    false,
    block.timestamp - 100,
    block.timestamp - 1,
    snapshotTimepoint
  );
  for (const voter of voters) {
    await voting.setVoteOption(proposalId, voter, 2);
  }
}

async function registerInBatches(staking, registrar, ids) {
  for (let i = 0; i < ids.length; i += 25) {
    const cursor = await staking.canonicalProposalCount();
    await staking.connect(registrar).registerFinalizedProposals(cursor, ids.slice(i, i + 25));
  }
}

describe("Curve-style canonical Aragon participation V17", function () {
  it("allows only the registrar to append proposals and keeps 25 solely as a registration batch cap", async function () {
    const { registrar, attacker, alice, staking, voting } = await deploySystem();
    const block = await ethers.provider.getBlock("latest");
    await createClosedProposal(voting, 101, block.number, [alice.address]);

    await expect(
      staking.connect(attacker).registerFinalizedProposals(0, [101])
    ).to.be.revertedWithCustomError(staking, "NotProposalRegistrar");

    await staking.connect(registrar).registerFinalizedProposals(0, [101]);
    expect(await staking.canonicalProposalCount()).to.equal(1);
    expect(await staking.MAX_PROPOSAL_REGISTRATION_BATCH()).to.equal(25);
    expect(staking.processParticipation).to.equal(undefined);
    expect(staking.staleActiveStakerCount).to.equal(undefined);
  });

  it("fast-forwards a 101-proposal backlog by evaluating only the decisive latest fifteen", async function () {
    const { registrar, keeper, alice, bob, staking, voting } = await deploySystem();
    const firstSnapshot = (await ethers.provider.getBlock("latest")).number;
    const ids = [];

    for (let id = 1; id <= 101; id++) {
      ids.push(id);
      const voters = id <= 86 ? [alice.address, bob.address] : [bob.address];
      await createClosedProposal(voting, id, firstSnapshot + id, voters);
    }
    await registerInBatches(staking, registrar, ids);

    expect(await staking.connect(keeper).kick.staticCall(alice.address)).to.equal(15);
    await staking.connect(keeper).kick(alice.address);
    await staking.connect(keeper).kick(bob.address);

    expect(await staking.canonicalProposalCount()).to.equal(101);
    expect(await staking.canonicalProposalWindowCount()).to.equal(15);
    expect(await staking.processedProposalCount(alice.address)).to.equal(101);
    expect(await staking.participationHistoryCount(alice.address)).to.equal(15);
    expect(await staking.participationMultiplierBps(alice.address)).to.equal(10_000);
    expect(await staking.participationMultiplierBps(bob.address)).to.equal(30_000);
    expect(await staking.participationWeight(alice.address)).to.equal(ethers.parseEther("100"));
    expect(await staking.participationWeight(bob.address)).to.equal(ethers.parseEther("300"));
  });

  it("allows proposal registration during a live stream and settles old weight before a kick", async function () {
    const { dao, registrar, keeper, alice, bob, staking, voting } = await deploySystem();
    const firstSnapshot = (await ethers.provider.getBlock("latest")).number;
    const initialIds = [];
    for (let id = 1; id <= 15; id++) {
      initialIds.push(id);
      await createClosedProposal(voting, id, firstSnapshot + id, [alice.address, bob.address]);
    }
    await staking.connect(registrar).registerFinalizedProposals(0, initialIds);
    await staking.connect(keeper).kick(alice.address);
    await staking.connect(keeper).kick(bob.address);

    const Reward = await ethers.getContractFactory("MockERC20V17");
    const reward = await Reward.deploy("Reward", "RWD");
    await staking.connect(dao).addRewardToken(await reward.getAddress());
    await reward.mint(dao.address, ethers.parseEther("140"));
    await reward.connect(dao).approve(await staking.getAddress(), ethers.MaxUint256);
    await staking.connect(dao).notifyParticipationReward(await reward.getAddress(), ethers.parseEther("140"));

    await increaseTime(7 * DAY);
    for (let id = 16; id <= 19; id++) {
      await createClosedProposal(voting, id, firstSnapshot + id, [bob.address]);
    }
    await staking.connect(registrar).registerFinalizedProposals(15, [16, 17, 18, 19]);

    expect(await staking.participationWeight(alice.address)).to.equal(ethers.parseEther("300"));
    await staking.connect(keeper).kick(alice.address);
    expect(await staking.participationWeight(alice.address)).to.equal(ethers.parseEther("100"));
    expect(await staking.totalParticipationWeight()).to.equal(ethers.parseEther("400"));

    await increaseTime(7 * DAY + 10);
    await staking.connect(alice).claimRewards(alice.address);
    expect(await reward.balanceOf(alice.address)).to.be.closeTo(
      ethers.parseEther("52.5"),
      ethers.parseEther("0.01")
    );
  });

  it("automatically refreshes a stale account on stake, withdrawal request, and claim", async function () {
    const { registrar, alice, bob, staking, voting } = await deploySystem();
    const firstSnapshot = (await ethers.provider.getBlock("latest")).number;

    const firstIds = [];
    for (let id = 1; id <= 15; id++) {
      firstIds.push(id);
      await createClosedProposal(voting, id, firstSnapshot + id, [alice.address, bob.address]);
    }
    await staking.connect(registrar).registerFinalizedProposals(0, firstIds);

    await staking.connect(alice).stake(ethers.parseEther("1"));
    expect(await staking.processedProposalCount(alice.address)).to.equal(15);
    expect(await staking.participationWeight(alice.address)).to.equal(ethers.parseEther("303"));

    await staking.connect(bob).claimRewards(bob.address);
    expect(await staking.processedProposalCount(bob.address)).to.equal(15);
    expect(await staking.participationWeight(bob.address)).to.equal(ethers.parseEther("300"));

    const laterIds = [];
    for (let id = 16; id <= 30; id++) {
      laterIds.push(id);
      await createClosedProposal(voting, id, firstSnapshot + id, [bob.address]);
    }
    await staking.connect(registrar).registerFinalizedProposals(15, laterIds);

    await staking.connect(alice).requestWithdrawal(ethers.parseEther("1"), alice.address);
    expect(await staking.processedProposalCount(alice.address)).to.equal(30);
    expect(await staking.participationMultiplierBps(alice.address)).to.equal(10_000);
    expect(await staking.participationWeight(alice.address)).to.equal(ethers.parseEther("100"));
  });

  it("accepts a registrar-signed frontend batch atomically with a stake", async function () {
    const { registrar, attacker, alice, staking, voting } = await deploySystem();
    const firstSnapshot = (await ethers.provider.getBlock("latest")).number;
    const proposalIds = [];
    for (let id = 1; id <= 15; id++) {
      proposalIds.push(id);
      await createClosedProposal(voting, id, firstSnapshot + id, [alice.address]);
    }

    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 900);
    const network = await ethers.provider.getNetwork();
    const proposalIdsHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [proposalIds])
    );
    const domain = {
      name: "Staked CurveYield Governance",
      version: "1",
      chainId: network.chainId,
      verifyingContract: await staking.getAddress()
    };
    const types = {
      ProposalSync: [
        { name: "caller", type: "address" },
        { name: "expectedStartIndex", type: "uint256" },
        { name: "proposalIdsHash", type: "bytes32" },
        { name: "deadline", type: "uint256" }
      ]
    };
    const value = { caller: alice.address, expectedStartIndex: 0, proposalIdsHash, deadline };
    const invalidSignature = await attacker.signTypedData(domain, types, value);
    await expect(
      staking.connect(alice).stakeWithProposalSync(
        ethers.parseEther("1"), 0, proposalIds, deadline, invalidSignature
      )
    ).to.be.revertedWithCustomError(staking, "InvalidProposalSyncSigner");

    const signature = await registrar.signTypedData(domain, types, value);
    await staking.connect(alice).stakeWithProposalSync(
      ethers.parseEther("1"), 0, proposalIds, deadline, signature
    );

    expect(await staking.canonicalProposalCount()).to.equal(15);
    expect(await staking.canonicalProposalWindowCount()).to.equal(15);
    expect(await staking.processedProposalCount(alice.address)).to.equal(15);
    expect(await staking.participationMultiplierBps(alice.address)).to.equal(30_000);
    expect(await staking.participationWeight(alice.address)).to.equal(ethers.parseEther("303"));
  });

  it("rejects duplicate and non-canonical proposal ordering", async function () {
    const { registrar, staking, voting } = await deploySystem();
    const block = await ethers.provider.getBlock("latest");
    await createClosedProposal(voting, 1, block.number + 10);
    await createClosedProposal(voting, 2, block.number + 9);

    await staking.connect(registrar).registerFinalizedProposals(0, [1]);
    await expect(
      staking.connect(registrar).registerFinalizedProposals(0, [1])
    ).to.be.revertedWithCustomError(staking, "ProposalRegistrationCursorMismatch");
    await expect(
      staking.connect(registrar).registerFinalizedProposals(1, [1])
    ).to.be.revertedWithCustomError(staking, "ProposalAlreadyRegistered");
    await expect(
      staking.connect(registrar).registerFinalizedProposals(1, [2])
    ).to.be.revertedWithCustomError(staking, "NonCanonicalProposalOrder");
  });
});
