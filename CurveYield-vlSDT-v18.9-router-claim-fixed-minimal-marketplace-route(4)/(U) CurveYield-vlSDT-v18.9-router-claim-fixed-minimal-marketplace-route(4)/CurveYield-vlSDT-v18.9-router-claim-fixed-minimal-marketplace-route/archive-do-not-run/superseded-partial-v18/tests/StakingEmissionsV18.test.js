
const { expect } = require("chai");
const { ethers } = require("hardhat");

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("DAO-set governance emissions ", function () {
  it("mints governance rewards on demand for Revenue Staking", async function () {
    const [dao, user, admin] = await ethers.getSigners();
    const Cyvl = await ethers.getContractFactory("MockCyvlSdt");
    const cyvl = await Cyvl.deploy();
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
    const Revenue = await ethers.getContractFactory("CurveYieldVlSDTRevenueStaking");
    const revenue = await Revenue.deploy(
      dao.address,
      admin.address,
      await cyvl.getAddress(),
      await gov.getAddress()
    );

    await gov.connect(dao).setMinter(await revenue.getAddress(), true);
    await cyvl.mint(user.address, ethers.parseEther("100"));
    await cyvl.connect(user).approve(await revenue.getAddress(), ethers.parseEther("100"));
    await revenue.connect(user).stake(ethers.parseEther("100"));
    await revenue.connect(dao).setGovernanceEmissionRate(ethers.parseEther("1"));

    await increaseTime(100);
    const earned = await revenue.earnedGovernance(user.address);
    expect(earned).to.be.gte(ethers.parseEther("100"));
    await revenue.connect(user).claimGovernance(user.address);
    expect(await gov.balanceOf(user.address)).to.be.gte(ethers.parseEther("100"));
  });

  it("mints governance rewards on demand for Boost Staking", async function () {
    const [dao, user] = await ethers.getSigners();
    const Cyvl = await ethers.getContractFactory("MockCyvlSdt");
    const cyvl = await Cyvl.deploy();
    const Sdt = await ethers.getContractFactory("MockERC20");
    const sdt = await Sdt.deploy("SDT", "SDT");
    const Locker = await ethers.getContractFactory("MockLockerForCompounder");
    const locker = await Locker.deploy(await sdt.getAddress(), await cyvl.getAddress());
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
    const Boost = await ethers.getContractFactory("CurveYieldVlSDTBoostStaking");
    const boost = await Boost.deploy(
      dao.address,
      await cyvl.getAddress(),
      await locker.getAddress(),
      await gov.getAddress()
    );

    await gov.connect(dao).setMinter(await boost.getAddress(), true);
    await cyvl.mint(user.address, ethers.parseEther("50"));
    await cyvl.connect(user).approve(await boost.getAddress(), ethers.parseEther("50"));
    await boost.connect(user).deposit(ethers.parseEther("50"));
    await boost.connect(dao).setGovernanceEmissionRate(ethers.parseEther("2"));

    await increaseTime(50);
    await boost.connect(user).claimGovernance(user.address);
    expect(await gov.balanceOf(user.address)).to.be.gte(ethers.parseEther("100"));
  });
  it("splits only excess Revenue Staking yield 33% to DAO and 12% to admin fee receiver", async function () {
    const [dao, user, admin] = await ethers.getSigners();
    const Cyvl = await ethers.getContractFactory("MockCyvlSdt");
    const cyvl = await Cyvl.deploy();
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceToken");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
    const Reward = await ethers.getContractFactory("MockERC20");
    const reward = await Reward.deploy("Reward", "RWD");
    const Revenue = await ethers.getContractFactory("CurveYieldVlSDTRevenueStaking");
    const revenue = await Revenue.deploy(
      dao.address,
      admin.address,
      await cyvl.getAddress(),
      await gov.getAddress()
    );

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

    expect(await reward.balanceOf(user.address)).to.be.closeTo(
      ethers.parseEther("82"),
      10n ** 12n
    );
    expect(await reward.balanceOf(dao.address)).to.be.closeTo(
      ethers.parseEther("13.2"),
      10n ** 12n
    );
    expect(await reward.balanceOf(admin.address)).to.be.closeTo(
      ethers.parseEther("4.8"),
      10n ** 12n
    );
    expect(await reward.balanceOf(await revenue.getAddress())).to.be.lte(10n ** 12n);
  });

});
