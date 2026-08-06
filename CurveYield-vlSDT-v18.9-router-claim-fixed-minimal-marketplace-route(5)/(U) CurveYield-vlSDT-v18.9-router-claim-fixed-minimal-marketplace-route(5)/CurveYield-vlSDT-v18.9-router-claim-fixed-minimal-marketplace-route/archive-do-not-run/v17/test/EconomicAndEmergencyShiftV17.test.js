const { expect } = require("chai");
const { ethers } = require("hardhat");

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function deployLockerFixture() {
  const [dao, user, boostModule, merchant, admin, recipient] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20V17");
  const sdt = await Token.deploy("Stake DAO Token", "SDT");
  const reward = await Token.deploy("Reward", "RWD");
  const VlSdt = await ethers.getContractFactory("MockVlSDTV17");
  const vlSdt = await VlSdt.deploy(await sdt.getAddress());
  const VlBoost = await ethers.getContractFactory("MockVlBoostV17");
  const vlBoost = await VlBoost.deploy();
  const Fee = await ethers.getContractFactory("MockFeeDistributorV17");
  const fee = await Fee.deploy(await reward.getAddress());
  const Marketplace = await ethers.getContractFactory("MockMarketplaceV17");
  const marketplace = await Marketplace.deploy();
  const Cyvl = await ethers.getContractFactory("CurveYieldVlSDTTokenV17");
  const cyvl = await Cyvl.deploy(dao.address);
  const AdminAuthority = await ethers.getContractFactory("MockAdminAuthorityV17");
  const adminAuthority = await AdminAuthority.deploy(admin.address);
  const Locker = await ethers.getContractFactory("CurveYieldVlSDTLockerV17");
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
  await cyvl.connect(dao).setLocker(await locker.getAddress());
  await locker.connect(dao).configureSystem(await adminAuthority.getAddress(), boostModule.address, merchant.address);

  return { dao, user, boostModule, merchant, admin, recipient, sdt, reward, vlSdt, vlBoost, fee, marketplace, cyvl, locker, adminAuthority };
}

describe("V17 DAO allocation, admin excess share, and temporary emergency redemption", function () {
  it("splits only excess Revenue Staking yield 33% to DAO and 12% to admin fee receiver", async function () {
    const [dao, user, admin] = await ethers.getSigners();
    const Cyvl = await ethers.getContractFactory("MockCyvlSdtV17");
    const cyvl = await Cyvl.deploy();
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceTokenV17");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
    const Reward = await ethers.getContractFactory("MockERC20V17");
    const reward = await Reward.deploy("Reward", "RWD");
    const Revenue = await ethers.getContractFactory("CurveYieldVlSDTRevenueStakingV17");
    const revenue = await Revenue.deploy(
      dao.address,
      admin.address,
      await cyvl.getAddress(),
      await gov.getAddress()
    );

    expect(await revenue.ADMIN_FEE_RECEIVER()).to.equal(admin.address);
    await revenue.connect(dao).addRewardToken(await reward.getAddress());
    await revenue.connect(dao).setNotifier(dao.address, true);
    await cyvl.mint(user.address, ethers.parseEther("600"));
    await cyvl.connect(user).approve(await revenue.getAddress(), ethers.parseEther("600"));
    await revenue.connect(user).stake(ethers.parseEther("600"));

    await reward.mint(dao.address, ethers.parseEther("100"));
    await reward.connect(dao).approve(await revenue.getAddress(), ethers.parseEther("100"));
    await revenue.connect(dao).notifyReward(
      await reward.getAddress(),
      ethers.parseEther("100"),
      ethers.parseEther("0.1")
    );

    expect(await reward.balanceOf(dao.address)).to.be.closeTo(ethers.parseEther("13.2"), 10n ** 12n);
    expect(await reward.balanceOf(admin.address)).to.be.closeTo(ethers.parseEther("4.8"), 10n ** 12n);

    await increaseTime(24 * 60 * 60);
    await revenue.startRewardCycle(await reward.getAddress());
    await increaseTime(14 * 24 * 60 * 60);
    await revenue.connect(user).claimRewards(user.address);

    expect(await reward.balanceOf(user.address)).to.be.closeTo(ethers.parseEther("82"), 10n ** 12n);
    expect(await reward.balanceOf(dao.address)).to.be.closeTo(ethers.parseEther("13.2"), 10n ** 12n);
    expect(await reward.balanceOf(admin.address)).to.be.closeTo(ethers.parseEther("4.8"), 10n ** 12n);
  });

  it("hard-reserves twenty percent for the owner and lets only the current admin allocate five percent", async function () {
    const { dao, user, boostModule, admin, recipient, sdt, vlBoost, locker } = await deployLockerFixture();
    await sdt.mint(user.address, ethers.parseEther("1000"));
    await sdt.connect(user).approve(await locker.getAddress(), ethers.parseEther("1000"));
    await locker.connect(user).deposit(ethers.parseEther("1000"), user.address);
    await vlBoost.setDelegableBalance(await locker.getAddress(), ethers.parseEther("1000"));

    expect(await locker.daoBoostAllocation()).to.equal(ethers.parseEther("200"));
    expect(await locker.daoDelegableBoost()).to.equal(ethers.parseEther("200"));
    expect(await locker.adminBoostAllocation()).to.equal(ethers.parseEther("50"));
    expect(await locker.adminDelegableBoost()).to.equal(ethers.parseEther("50"));
    expect(await locker.delegableBoost()).to.equal(ethers.parseEther("750"));
    expect(await locker.ADMIN()).to.equal(admin.address);

    const endtime = (await ethers.provider.getBlock("latest")).timestamp + 14 * 24 * 60 * 60;
    await locker.connect(dao).delegateDaoBoost(ethers.parseEther("200"), endtime, recipient.address);
    expect(await locker.daoDelegableBoost()).to.equal(0);
    expect(await locker.delegableBoost()).to.equal(ethers.parseEther("750"));
    await expect(
      locker.connect(dao).delegateDaoBoost(1n, endtime, recipient.address)
    ).to.be.revertedWithCustomError(locker, "DaoBoostAllocationExceeded");

    await expect(
      locker.connect(dao).delegateAdminBoost(1n, endtime, recipient.address)
    ).to.be.revertedWithCustomError(locker, "OnlyAdmin");
    await locker.connect(admin).delegateAdminBoost(ethers.parseEther("50"), endtime, recipient.address);
    expect(await locker.adminDelegableBoost()).to.equal(0);

    const newAdmin = user;
    await adminAuthority.connect(admin).setAdmin(newAdmin.address);
    expect(await locker.admin()).to.equal(newAdmin.address);
    await expect(
      locker.connect(admin).delegateAdminBoost(1n, endtime, recipient.address)
    ).to.be.revertedWithCustomError(locker, "OnlyAdmin");

    await locker.connect(boostModule).delegateBoost(ethers.parseEther("750"), endtime, recipient.address);
    expect(await locker.delegableBoost()).to.equal(0);
  });

  it("lets the DAO sell its reserved boost into a marketplace offer for direct DAO income", async function () {
    const { dao, user, recipient, sdt, vlBoost, marketplace, locker } = await deployLockerFixture();
    const Payment = await ethers.getContractFactory("MockERC20V17");
    const payment = await Payment.deploy("USD Coin", "USDC");

    await sdt.mint(user.address, ethers.parseEther("1000"));
    await sdt.connect(user).approve(await locker.getAddress(), ethers.parseEther("1000"));
    await locker.connect(user).deposit(ethers.parseEther("1000"), user.address);
    await vlBoost.setDelegableBalance(await locker.getAddress(), ethers.parseEther("1000"));

    await payment.mint(user.address, ethers.parseEther("500"));
    await payment.connect(user).approve(await marketplace.getAddress(), ethers.parseEther("500"));
    const expiry = (await ethers.provider.getBlock("latest")).timestamp + 7 * 24 * 60 * 60;
    await marketplace.setOffer(
      1,
      user.address,
      ethers.parseEther("1"),
      await payment.getAddress(),
      2,
      expiry,
      recipient.address,
      ethers.parseEther("100")
    );

    await locker.connect(dao).acceptDaoMarketplaceOffer(1, ethers.parseEther("100"), 0, 0);
    expect(await payment.balanceOf(dao.address)).to.equal(ethers.parseEther("200"));
    expect(await locker.daoCommittedBoost()).to.equal(ethers.parseEther("100"));
  });

  it("supports temporary user emergency redemption and irreversible disabling of new requests", async function () {
    const { dao, user, sdt, cyvl, locker } = await deployLockerFixture();
    await sdt.mint(user.address, ethers.parseEther("100"));
    await sdt.connect(user).approve(await locker.getAddress(), ethers.parseEther("100"));
    await locker.connect(user).deposit(ethers.parseEther("100"), user.address);

    await cyvl.connect(user).approve(await locker.getAddress(), ethers.parseEther("100"));
    await locker.connect(user).requestEmergencyWithdrawal(ethers.parseEther("40"));
    expect(await cyvl.balanceOf(user.address)).to.equal(ethers.parseEther("60"));

    await locker.connect(dao).disableEmergencyWithdrawForever();
    expect(await locker.emergencyWithdrawPermanentlyDisabled()).to.equal(true);
    await expect(
      locker.connect(user).requestEmergencyWithdrawal(ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(locker, "EmergencyWithdrawDisabled");

    await locker.connect(user).completeEmergencyWithdrawal(1, user.address);
    expect(await sdt.balanceOf(user.address)).to.equal(ethers.parseEther("40"));
  });
});
