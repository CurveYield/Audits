
const { expect } = require("chai");
const { ethers } = require("hardhat");

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("CurveYield governance system ", function () {
  it("enforces the one-trillion hard cap and DAO-controlled minters", async function () {
    const [dao, minter, user] = await ethers.getSigners();
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");

    await gov.connect(dao).setMinter(minter.address, true);
    await gov.connect(minter).mint(user.address, 123n);
    expect(await gov.balanceOf(user.address)).to.equal(123n);

    const cap = await gov.CAP();
    await gov.connect(dao).mint(dao.address, cap - 123n);
    expect(await gov.totalSupply()).to.equal(cap);
    await expect(gov.connect(dao).mint(dao.address, 1n)).to.be.reverted;
  });

  it("makes staking and holding the same non-transferable Aragon-compatible voting position", async function () {
    const [dao, user, other] = await ethers.getSigners();
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
    const Staking = await ethers.getContractFactory("CurveYieldGovernanceStaking");
    const staking = await Staking.deploy(
      dao.address,
      await gov.getAddress(),
      "Staked CurveYield Governance",
      "stcyGOV",
      0,
      0
    );

    await gov.connect(dao).mint(user.address, ethers.parseEther("100"));
    await gov.connect(user).approve(await staking.getAddress(), ethers.parseEther("100"));
    await staking.connect(user).stake(ethers.parseEther("100"));

    expect(await staking.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
    expect(await staking.delegates(user.address)).to.equal(user.address);
    expect(await staking.getVotes(user.address)).to.equal(ethers.parseEther("100"));
    await expect(
      staking.connect(user).transfer(other.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(staking, "NonTransferable");
  });

  it("snapshots a configurable tax and withdrawal hold time within the required limits", async function () {
    const [dao, user] = await ethers.getSigners();
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
    const Staking = await ethers.getContractFactory("CurveYieldGovernanceStaking");
    const staking = await Staking.deploy(
      dao.address,
      await gov.getAddress(),
      "Staked CurveYield Governance",
      "stcyGOV",
      0,
      0
    );

    await expect(staking.connect(dao).setWithdrawalConfig(501, 0))
      .to.be.revertedWithCustomError(staking, "InvalidWithdrawalConfig");
    await expect(staking.connect(dao).setWithdrawalConfig(0, 30 * 24 * 60 * 60 + 1))
      .to.be.revertedWithCustomError(staking, "InvalidWithdrawalConfig");

    await staking.connect(dao).setWithdrawalConfig(500, 30 * 24 * 60 * 60);
    await gov.connect(dao).mint(user.address, ethers.parseEther("100"));
    await gov.connect(user).approve(await staking.getAddress(), ethers.parseEther("100"));
    await staking.connect(user).stake(ethers.parseEther("100"));

    await staking.connect(user).requestWithdrawal(ethers.parseEther("20"), user.address);
    expect(await staking.balanceOf(user.address)).to.equal(ethers.parseEther("80"));
    await expect(staking.completeWithdrawal(1)).to.be.revertedWithCustomError(
      staking,
      "WithdrawalNotReady"
    );

    await increaseTime(30 * 24 * 60 * 60);
    await staking.completeWithdrawal(1);
    expect(await gov.balanceOf(user.address)).to.equal(ethers.parseEther("19"));
    expect(await gov.balanceOf(dao.address)).to.equal(ethers.parseEther("1"));
  });
  it("distributes staking yield while the same balance remains the voting balance", async function () {
    const [dao, user] = await ethers.getSigners();
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
    const Reward = await ethers.getContractFactory("MockERC20");
    const reward = await Reward.deploy("Reward", "RWD");
    const Staking = await ethers.getContractFactory("CurveYieldGovernanceStaking");
    const staking = await Staking.deploy(
      dao.address,
      await gov.getAddress(),
      "Staked CurveYield Governance",
      "stcyGOV",
      0,
      0
    );

    await gov.connect(dao).mint(user.address, ethers.parseEther("100"));
    await gov.connect(user).approve(await staking.getAddress(), ethers.parseEther("100"));
    await staking.connect(user).stake(ethers.parseEther("100"));

    await staking.connect(dao).addRewardToken(await reward.getAddress());
    await reward.mint(dao.address, ethers.parseEther("140"));
    await reward.connect(dao).approve(await staking.getAddress(), ethers.parseEther("140"));
    await staking.connect(dao).notifyReward(await reward.getAddress(), ethers.parseEther("140"));
    await increaseTime(14 * 24 * 60 * 60);
    await staking.connect(user).claimRewards(user.address);

    expect(await staking.getVotes(user.address)).to.equal(ethers.parseEther("100"));
    expect(await reward.balanceOf(user.address)).to.be.closeTo(
      ethers.parseEther("140"),
      10n ** 12n
    );
  });

  it("automatically pays proposal-participation rewards from the last fifteen Aragon proposals", async function () {
    const [dao, directVoter, delegator, delegatee] = await ethers.getSigners();
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
    const Reward = await ethers.getContractFactory("MockERC20");
    const reward = await Reward.deploy("Participation Reward", "PRWD");
    const Staking = await ethers.getContractFactory("CurveYieldGovernanceStaking");
    const staking = await Staking.deploy(
      dao.address,
      await gov.getAddress(),
      "Staked CurveYield Governance",
      "stcyGOV",
      0,
      0
    );
    const Voting = await ethers.getContractFactory("MockAragonTokenVoting");
    const voting = await Voting.deploy();
    await staking.connect(dao).setAragonVotingPlugin(await voting.getAddress());

    for (const account of [directVoter, delegator]) {
      await gov.connect(dao).mint(account.address, ethers.parseEther("100"));
      await gov.connect(account).approve(await staking.getAddress(), ethers.parseEther("100"));
      await staking.connect(account).stake(ethers.parseEther("100"));
    }
    await staking.connect(delegator).delegate(delegatee.address);
    await ethers.provider.send("evm_mine", []);

    const initialProposalIds = [];
    for (let proposalId = 1; proposalId <= 15; proposalId++) {
      initialProposalIds.push(proposalId);
      const block = await ethers.provider.getBlock("latest");
      await voting.setProposal(
        proposalId,
        false,
        block.timestamp - 100,
        block.timestamp - 1,
        block.number
      );
      if (proposalId <= 12) {
        await voting.setVoteOption(proposalId, directVoter.address, 2);
        await voting.setVoteOption(proposalId, delegatee.address, 2);
      }
    }
    await staking.connect(dao).registerFinalizedProposals(0, initialProposalIds);
    await staking.kick(directVoter.address);
    await staking.kick(delegator.address);

    expect(await staking.participationMultiplierBps(directVoter.address)).to.equal(30_000);
    expect(await staking.participationMultiplierBps(delegator.address)).to.equal(20_000);

    await staking.connect(dao).addRewardToken(await reward.getAddress());
    await reward.mint(dao.address, ethers.parseEther("500"));
    await reward.connect(dao).approve(await staking.getAddress(), ethers.parseEther("500"));
    await staking.connect(dao).notifyParticipationReward(
      await reward.getAddress(),
      ethers.parseEther("500")
    );

    await increaseTime(14 * 24 * 60 * 60);
    await staking.connect(directVoter).claimRewards(directVoter.address);
    await staking.connect(delegator).claimRewards(delegator.address);
    expect(await reward.balanceOf(directVoter.address)).to.be.closeTo(
      ethers.parseEther("300"),
      10n ** 12n
    );
    expect(await reward.balanceOf(delegator.address)).to.be.closeTo(
      ethers.parseEther("200"),
      10n ** 12n
    );

    await increaseTime(90 * 24 * 60 * 60);
    expect(await staking.participationMultiplierBps(directVoter.address)).to.equal(30_000);
    expect(await staking.participationMultiplierBps(delegator.address)).to.equal(20_000);

    const block = await ethers.provider.getBlock("latest");
    await voting.setProposal(16, false, block.timestamp - 100, block.timestamp - 1, block.number);
    await staking.connect(dao).registerFinalizedProposals(15, [16]);
    await staking.kick(directVoter.address);
    await staking.kick(delegator.address);
    expect(await staking.participationMultiplierBps(directVoter.address)).to.equal(28_333);
    expect(await staking.participationMultiplierBps(delegator.address)).to.equal(19_166);
  });

});
