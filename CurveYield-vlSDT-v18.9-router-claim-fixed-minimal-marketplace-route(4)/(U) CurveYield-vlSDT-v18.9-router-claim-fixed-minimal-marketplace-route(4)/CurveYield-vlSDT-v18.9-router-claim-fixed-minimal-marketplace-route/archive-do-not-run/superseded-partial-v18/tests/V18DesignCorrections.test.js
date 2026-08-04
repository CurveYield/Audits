const { expect } = require("chai");
const { ethers } = require("hardhat");

async function mine() {
  await ethers.provider.send("evm_mine", []);
}

async function deployCompounderFixture() {
  const [dao, user] = await ethers.getSigners();
  const Cyvl = await ethers.getContractFactory("MockCyvlSdt");
  const cyvl = await Cyvl.deploy();
  const Token = await ethers.getContractFactory("MockERC20");
  const sdt = await Token.deploy("Stake DAO Token", "SDT");
  const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
  const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
  const GovStaking = await ethers.getContractFactory("CurveYieldGovernanceStaking");
  const govStaking = await GovStaking.deploy(
    dao.address,
    await gov.getAddress(),
    "Staked CurveYield Governance",
    "stcyGOV",
    0,
    0
  );
  const Locker = await ethers.getContractFactory("MockLockerForCompounder");
  const locker = await Locker.deploy(await sdt.getAddress(), await cyvl.getAddress());
  const Revenue = await ethers.getContractFactory("MockRevenueStakingForCompounder");
  const revenue = await Revenue.deploy(await cyvl.getAddress(), await gov.getAddress());
  const Compounder = await ethers.getContractFactory("CurveYieldRevenueCompounder");
  const compounder = await Compounder.deploy(
    dao.address,
    await cyvl.getAddress(),
    await sdt.getAddress(),
    await gov.getAddress(),
    await locker.getAddress(),
    await revenue.getAddress(),
    await govStaking.getAddress()
  );
  return { dao, user, cyvl, revenue, compounder };
}

async function deployLockerFixture() {
  const [dao, user, merchant, admin, recipient] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const sdt = await Token.deploy("Stake DAO Token", "SDT");
  const reward = await Token.deploy("Reward", "RWD");
  const VlSdt = await ethers.getContractFactory("MockVlSDT");
  const vlSdt = await VlSdt.deploy(await sdt.getAddress());
  const VlBoost = await ethers.getContractFactory("MockVlBoost");
  const vlBoost = await VlBoost.deploy();
  const Fee = await ethers.getContractFactory("MockFeeDistributor");
  const fee = await Fee.deploy(await reward.getAddress());
  const Marketplace = await ethers.getContractFactory("MockMarketplace");
  const marketplace = await Marketplace.deploy();
  const Cyvl = await ethers.getContractFactory("CurveYieldVlSDTToken");
  const cyvl = await Cyvl.deploy(dao.address);
  const Locker = await ethers.getContractFactory("CurveYieldVlSDTLocker");
  const locker = await Locker.deploy(
    dao.address,
    admin.address,
    await sdt.getAddress(),
    await vlSdt.getAddress(),
    await vlBoost.getAddress(),
    await fee.getAddress(),
    await marketplace.getAddress(),
    await cyvl.getAddress()
  );
  const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
  const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
  const BoostStaking = await ethers.getContractFactory("CurveYieldVlSDTBoostStaking");
  const boostStaking = await BoostStaking.deploy(
    dao.address,
    await cyvl.getAddress(),
    await locker.getAddress(),
    await gov.getAddress()
  );
  await cyvl.connect(dao).setLocker(await locker.getAddress());
  await locker.connect(dao).configureSystem(dao.address, await boostStaking.getAddress(), merchant.address);
  await sdt.mint(user.address, ethers.parseEther("1000"));
  await sdt.connect(user).approve(await locker.getAddress(), ethers.parseEther("1000"));
  await locker.connect(user).deposit(ethers.parseEther("1000"), user.address);
  await vlBoost.setDelegableBalance(await locker.getAddress(), ethers.parseEther("1000"));
  return { dao, user, merchant, admin, recipient, sdt, cyvl, gov, vlBoost, locker, boostStaking };
}

describe(" requested design corrections", function () {
  it("implements the complete ERC4626 entry and exit surface", async function () {
    const { user, cyvl, compounder } = await deployCompounderFixture();
    expect(await compounder.asset()).to.equal(await cyvl.getAddress());

    await cyvl.mint(user.address, ethers.parseEther("100"));
    await cyvl.connect(user).approve(await compounder.getAddress(), ethers.MaxUint256);
    await compounder.connect(user).deposit(ethers.parseEther("50"), user.address);
    await compounder.connect(user).mint(ethers.parseEther("10"), user.address);

    const netForTenShares = await compounder.previewRedeem(ethers.parseEther("10"));
    expect(netForTenShares).to.equal(ethers.parseEther("9.95"));
    await compounder.connect(user).redeem(ethers.parseEther("10"), user.address, user.address);

    const sharesForTenAssets = await compounder.previewWithdraw(ethers.parseEther("10"));
    expect(sharesForTenAssets).to.be.greaterThan(ethers.parseEther("10"));
    const before = await cyvl.balanceOf(user.address);
    await compounder.connect(user).withdraw(ethers.parseEther("10"), user.address, user.address);
    expect(await cyvl.balanceOf(user.address)).to.equal(before + ethers.parseEther("10"));
  });

  it("lets the DAO configure boost staking minimum and maximum multipliers", async function () {
    const { dao, boostStaking } = await deployLockerFixture();
    await boostStaking.connect(dao).setMultiplierRange(
      ethers.parseEther("3"),
      ethers.parseEther("8")
    );
    expect(await boostStaking.minimumMultiplier()).to.equal(ethers.parseEther("3"));
    expect(await boostStaking.maximumMultiplier()).to.equal(ethers.parseEther("8"));
    expect(await boostStaking.currentMultiplier()).to.equal(ethers.parseEther("8"));
    await expect(
      boostStaking.connect(dao).setMultiplierRange(ethers.parseEther("1.9"), ethers.parseEther("8"))
    ).to.be.revertedWithCustomError(boostStaking, "InvalidMultiplierRange");
    await expect(
      boostStaking.connect(dao).setMultiplierRange(ethers.parseEther("2"), ethers.parseEther("10.1"))
    ).to.be.revertedWithCustomError(boostStaking, "InvalidMultiplierRange");
  });

  it("lets the DAO lend an exact unused part of its boost reserve to the shared module pool", async function () {
    const { dao, merchant, recipient, vlBoost, locker } = await deployLockerFixture();
    await locker.connect(dao).setDaoBoostReleasedToModules(ethers.parseEther("100"));
    expect(await locker.daoDelegableBoost()).to.equal(ethers.parseEther("100"));
    expect(await locker.moduleBoostAllocation()).to.equal(ethers.parseEther("850"));
    expect(await locker.delegableBoost()).to.equal(ethers.parseEther("850"));

    const endtime = (await ethers.provider.getBlock("latest")).timestamp + 14 * 24 * 60 * 60;
    const commitmentId = await locker.connect(merchant).delegateBoost.staticCall(
      ethers.parseEther("800"),
      endtime,
      recipient.address
    );
    await locker.connect(merchant).delegateBoost(ethers.parseEther("800"), endtime, recipient.address);
    await expect(
      locker.connect(dao).setDaoBoostReleasedToModules(0)
    ).to.be.revertedWithCustomError(locker, "ReleasedDaoBoostInUse");

    await ethers.provider.send("evm_setNextBlockTimestamp", [endtime + 1]);
    await ethers.provider.send("evm_mine", []);
    await vlBoost.setDelegableBalance(await locker.getAddress(), ethers.parseEther("1000"));
    await locker.releaseModuleBoostCommitment(commitmentId);
    await locker.connect(dao).setDaoBoostReleasedToModules(0);
    expect(await locker.moduleBoostAllocation()).to.equal(ethers.parseEther("750"));
  });

  it("scales direct and delegated voting multipliers proportionally across the last fifteen proposals", async function () {
    const [dao, direct, delegator, delegatee] = await ethers.getSigners();
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
    const Voting = await ethers.getContractFactory("MockAragonTokenVoting");
    const voting = await Voting.deploy();
    await staking.connect(dao).setAragonVotingPlugin(await voting.getAddress());

    for (const account of [direct, delegator]) {
      await gov.connect(dao).mint(account.address, ethers.parseEther("100"));
      await gov.connect(account).approve(await staking.getAddress(), ethers.parseEther("100"));
      await staking.connect(account).stake(ethers.parseEther("100"));
    }
    await staking.connect(delegator).delegate(delegatee.address);
    await mine();

    const proposalIds = [];
    for (let id = 1; id <= 15; id++) {
      proposalIds.push(id);
      const block = await ethers.provider.getBlock("latest");
      const snapshot = BigInt(block.number);
      await voting.setProposal(id, false, block.timestamp - 100, block.timestamp - 1, snapshot);
      if (id <= 6) {
        await voting.setVoteOption(id, direct.address, 2);
        await voting.setVoteOption(id, delegatee.address, 2);
      }
    }
    await staking.connect(dao).registerFinalizedProposals(0, proposalIds);
    await staking.kick(direct.address);
    await staking.kick(delegator.address);

    expect(await staking.participationMultiplierBps(direct.address)).to.equal(20_000);
    expect(await staking.participationMultiplierBps(delegator.address)).to.equal(15_000);

    await staking.connect(dao).setCommunityBonusBps(direct.address, 15_000);
    expect(await staking.participationMultiplierBps(direct.address)).to.equal(35_000);
    await expect(
      staking.connect(dao).setCommunityBonusBps(direct.address, 15_001)
    ).to.be.revertedWithCustomError(staking, "CommunityBonusTooHigh");
  });
  it("blends historical self-voting and delegated-voting records across delegation switches", async function () {
    const [dao, user, delegatee] = await ethers.getSigners();
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
    const Voting = await ethers.getContractFactory("MockAragonTokenVoting");
    const voting = await Voting.deploy();
    await staking.connect(dao).setAragonVotingPlugin(await voting.getAddress());

    await gov.connect(dao).mint(user.address, ethers.parseEther("100"));
    await gov.connect(user).approve(await staking.getAddress(), ethers.parseEther("100"));
    await staking.connect(user).stake(ethers.parseEther("100"));

    async function addClosedProposals(startId, count, voter) {
      const proposalIds = [];
      for (let offset = 0; offset < count; offset++) {
        const proposalId = startId + offset;
        proposalIds.push(proposalId);
        const block = await ethers.provider.getBlock("latest");
        await voting.setProposal(
          proposalId,
          false,
          block.timestamp - 100,
          block.timestamp - 1,
          BigInt(block.number)
        );
        if (voter !== ethers.ZeroAddress) {
          await voting.setVoteOption(proposalId, voter, 2);
        }
      }
      const cursor = await staking.canonicalProposalCount();
      await staking.connect(dao).registerFinalizedProposals(cursor, proposalIds);
    }

    // Twelve delegated votes plus three misses produce the delegated 2x cap.
    await staking.connect(user).delegate(delegatee.address);
    await mine();
    await addClosedProposals(1, 12, delegatee.address);
    await addClosedProposals(13, 3, ethers.ZeroAddress);
    await staking.kick(user.address);
    expect(await staking.participationStats(user.address)).to.deep.equal([15n, 0n, 12n, 3n]);
    expect(await staking.participationMultiplierBps(user.address)).to.equal(20_000);

    // Six new self-votes replace six delegated records: 6 direct + 6 delegated + 3 misses = 2.5x.
    await staking.connect(user).delegate(user.address);
    await mine();
    await addClosedProposals(16, 6, user.address);
    await staking.kick(user.address);
    expect(await staking.participationStats(user.address)).to.deep.equal([15n, 6n, 6n, 3n]);
    expect(await staking.participationMultiplierBps(user.address)).to.equal(25_000);

    // Switching back does not reset history. As fifteen delegated votes replace the mixed window,
    // the multiplier decreases smoothly back to the delegated 2x cap.
    await staking.connect(user).delegate(delegatee.address);
    await mine();
    await addClosedProposals(22, 15, delegatee.address);
    await staking.kick(user.address);
    expect(await staking.participationStats(user.address)).to.deep.equal([15n, 0n, 15n, 0n]);
    expect(await staking.participationMultiplierBps(user.address)).to.equal(20_000);
  });

  it("keeps merchant prices inside DAO-configured per-token minimum and maximum bounds", async function () {
    const [dao, user, boostModule, admin, buyer, recipient] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockERC20");
    const sdt = await Token.deploy("Stake DAO Token", "SDT");
    const payment = await Token.deploy("Lease Payment", "PAY");
    const reward = await Token.deploy("Reward", "RWD");
    const VlSdt = await ethers.getContractFactory("MockVlSDT");
    const vlSdt = await VlSdt.deploy(await sdt.getAddress());
    const VlBoost = await ethers.getContractFactory("MockVlBoost");
    const vlBoost = await VlBoost.deploy();
    const Fee = await ethers.getContractFactory("MockFeeDistributor");
    const fee = await Fee.deploy(await reward.getAddress());
    const Marketplace = await ethers.getContractFactory("MockMarketplace");
    const marketplace = await Marketplace.deploy();
    const Cyvl = await ethers.getContractFactory("CurveYieldVlSDTToken");
    const cyvl = await Cyvl.deploy(dao.address);
    const Locker = await ethers.getContractFactory("CurveYieldVlSDTLocker");
    const locker = await Locker.deploy(
      dao.address,
      admin.address,
      await sdt.getAddress(),
      await vlSdt.getAddress(),
      await vlBoost.getAddress(),
      await fee.getAddress(),
      await marketplace.getAddress(),
      await cyvl.getAddress()
    );
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
    const Revenue = await ethers.getContractFactory("MockRevenueStakingForCompounder");
    const revenue = await Revenue.deploy(await cyvl.getAddress(), await gov.getAddress());
    const BoostStaking = await ethers.getContractFactory("CurveYieldVlSDTBoostStaking");
    const boostStaking = await BoostStaking.deploy(
      dao.address,
      await cyvl.getAddress(),
      await locker.getAddress(),
      await gov.getAddress()
    );
    const Merchant = await ethers.getContractFactory("CurveYieldVlSDTBoostMerchant");
    const merchant = await Merchant.deploy(
      dao.address,
      await locker.getAddress(),
      await revenue.getAddress(),
      await marketplace.getAddress()
    );

    await cyvl.connect(dao).setLocker(await locker.getAddress());
    await locker.connect(dao).configureSystem(
      await revenue.getAddress(),
      await boostStaking.getAddress(),
      await merchant.getAddress()
    );
    await sdt.mint(user.address, ethers.parseEther("1000"));
    await sdt.connect(user).approve(await locker.getAddress(), ethers.MaxUint256);
    await locker.connect(user).deposit(ethers.parseEther("1000"), user.address);
    await vlBoost.setDelegableBalance(await locker.getAddress(), ethers.parseEther("1000"));

    const minimumPrice = ethers.parseEther("1");
    const maximumPrice = ethers.parseEther("10");
    await merchant.connect(dao).setPaymentToken(
      await payment.getAddress(),
      true,
      minimumPrice,
      maximumPrice
    );
    expect(await merchant.currentPricePerWeek(await payment.getAddress())).to.equal(minimumPrice);
    expect(await boostStaking.currentMultiplier()).to.equal(ethers.parseEther("10"));

    await merchant.connect(dao).createMarketplaceListing(
      await payment.getAddress(),
      ethers.parseEther("250"),
      1,
      4,
      0
    );
    expect(await locker.delegableBoost()).to.equal(ethers.parseEther("500"));
    expect(await boostStaking.currentMultiplier()).to.be.closeTo(
      ethers.parseEther("7.333333333333333333"),
      2n
    );
    expect(await merchant.currentPricePerWeek(await payment.getAddress())).to.be.closeTo(
      ethers.parseEther("2"),
      100n
    );

    await cyvl.connect(user).approve(await boostStaking.getAddress(), ethers.MaxUint256);
    await boostStaking.connect(user).deposit(ethers.parseEther("500"));
    await boostStaking.connect(user).delegate(
      ethers.parseEther("500"),
      2,
      recipient.address
    );
    expect(await locker.delegableBoost()).to.equal(0);
    expect(await boostStaking.currentMultiplier()).to.equal(ethers.parseEther("2"));
    expect(await merchant.currentPricePerWeek(await payment.getAddress())).to.equal(maximumPrice);

    const latest = await ethers.provider.getBlock("latest");

    await expect(
      merchant.connect(buyer).leaseBoost(
        await payment.getAddress(),
        ethers.parseEther("1"),
        1,
        recipient.address,
        ethers.MaxUint256,
        latest.timestamp + 3600
      )
    ).to.be.revertedWithCustomError(merchant, "InsufficientBoostCapacity");
  });

  it("reserves standing BPS shares for Merchant and Boost Staking", async function () {
    const { dao, user, merchant, recipient, cyvl, locker, boostStaking } = await deployLockerFixture();
    await locker.connect(dao).setModuleBoostReserveBps(2_500, 2_000);

    expect(await locker.merchantStandingBoostReserve()).to.equal(ethers.parseEther("187.5"));
    expect(await locker.boostStakingStandingBoostReserve()).to.equal(ethers.parseEther("150"));
    expect(await locker.boostMerchantBoostCapacity()).to.equal(ethers.parseEther("600"));
    expect(await locker.boostStakingBoostCapacity()).to.equal(ethers.parseEther("562.5"));
    expect(await locker.boostMerchantDelegableBoost()).to.equal(ethers.parseEther("600"));
    expect(await locker.boostStakingDelegableBoost()).to.equal(ethers.parseEther("562.5"));

    const endtime = (await ethers.provider.getBlock("latest")).timestamp + 14 * 24 * 60 * 60;
    await locker.connect(merchant).delegateBoost(ethers.parseEther("600"), endtime, recipient.address);
    expect(await locker.boostMerchantDelegableBoost()).to.equal(0);
    expect(await locker.boostStakingDelegableBoost()).to.equal(ethers.parseEther("150"));

    await cyvl.connect(user).approve(await boostStaking.getAddress(), ethers.MaxUint256);
    await boostStaking.connect(user).deposit(ethers.parseEther("1000"));
    await boostStaking.connect(user).delegate(ethers.parseEther("150"), 2, recipient.address);
    expect(await locker.boostStakingDelegableBoost()).to.equal(0);
    expect(await locker.delegableBoost()).to.equal(0);

    await expect(
      locker.connect(merchant).delegateBoost(1, endtime, recipient.address)
    ).to.be.revertedWithCustomError(locker, "InsufficientModuleBoostCapacity");
  });

  it("reserves exact amounts from currently available shared capacity", async function () {
    const { dao, user, merchant, recipient, cyvl, locker, boostStaking } = await deployLockerFixture();
    await locker.connect(dao).setModuleBoostReserveBps(2_500, 2_000);

    const endtime = (await ethers.provider.getBlock("latest")).timestamp + 14 * 24 * 60 * 60;
    await locker.connect(merchant).delegateBoost(ethers.parseEther("300"), endtime, recipient.address);
    await cyvl.connect(user).approve(await boostStaking.getAddress(), ethers.MaxUint256);
    await boostStaking.connect(user).deposit(ethers.parseEther("1000"));
    await boostStaking.connect(user).delegate(ethers.parseEther("300"), 2, recipient.address);

    expect(await locker.moduleBoostUsed()).to.equal(ethers.parseEther("600"));
    expect(await locker.currentUnreservedBoost()).to.equal(ethers.parseEther("150"));

    await locker.connect(dao).reserveCurrentAvailableBoost(ethers.parseEther("75"), 0);
    expect(await locker.merchantAbsoluteBoostReserve()).to.equal(ethers.parseEther("375"));
    expect(await locker.boostMerchantDelegableBoost()).to.equal(ethers.parseEther("150"));
    expect(await locker.boostStakingDelegableBoost()).to.equal(ethers.parseEther("75"));

    await expect(
      locker.connect(dao).reserveCurrentAvailableBoost(ethers.parseEther("76"), 0)
    ).to.be.revertedWithCustomError(locker, "InsufficientUnreservedBoost");

    await boostStaking.connect(user).delegate(ethers.parseEther("75"), 2, recipient.address);
    expect(await locker.boostStakingDelegableBoost()).to.equal(0);
    expect(await locker.boostMerchantDelegableBoost()).to.equal(ethers.parseEther("75"));

    await locker.connect(dao).releaseCurrentAvailableBoostReserve(ethers.parseEther("75"), 0);
    expect(await locker.merchantAbsoluteBoostReserve()).to.equal(ethers.parseEther("300"));
    expect(await locker.boostStakingDelegableBoost()).to.equal(ethers.parseEther("75"));
  });

  it("releases the expired Locker commitment automatically when a user redelegates", async function () {
    const { user, admin: secondRecipient, recipient, cyvl, vlBoost, locker, boostStaking } =
      await deployLockerFixture();
    await cyvl.connect(user).approve(await boostStaking.getAddress(), ethers.MaxUint256);
    await boostStaking.connect(user).deposit(ethers.parseEther("1000"));

    const preview = await boostStaking.connect(user).delegate.staticCall(
      ethers.parseEther("750"),
      2,
      recipient.address
    );
    await boostStaking.connect(user).delegate(ethers.parseEther("750"), 2, recipient.address);
    const delegationId = preview[0];
    const endtime = Number(preview[1]);

    await ethers.provider.send("evm_setNextBlockTimestamp", [endtime + 1]);
    await ethers.provider.send("evm_mine", []);
    await vlBoost.setDelegableBalance(await locker.getAddress(), ethers.parseEther("1000"));

    await boostStaking.connect(user).redelegate(
      delegationId,
      ethers.parseEther("750"),
      2,
      secondRecipient.address
    );
    expect(await locker.boostStakingBoostUsed()).to.equal(ethers.parseEther("750"));
  });

});
