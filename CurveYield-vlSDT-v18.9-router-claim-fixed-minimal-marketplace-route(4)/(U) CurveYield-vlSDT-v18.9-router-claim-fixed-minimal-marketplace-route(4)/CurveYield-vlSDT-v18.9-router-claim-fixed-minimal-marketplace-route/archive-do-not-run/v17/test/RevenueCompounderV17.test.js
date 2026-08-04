
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CurveYield Revenue Compounder V17", function () {
  async function fixture() {
    const [dao, user] = await ethers.getSigners();
    const Cyvl = await ethers.getContractFactory("MockCyvlSdtV17");
    const cyvl = await Cyvl.deploy();
    const Token = await ethers.getContractFactory("MockERC20V17");
    const sdt = await Token.deploy("Stake DAO Token", "SDT");
    const Gov = await ethers.getContractFactory("CurveYieldGovernanceTokenV17");
    const gov = await Gov.deploy(dao.address, "CurveYield Governance", "cyGOV");
    const GovStaking = await ethers.getContractFactory("CurveYieldGovernanceStakingV17");
    const govStaking = await GovStaking.deploy(
      dao.address,
      await gov.getAddress(),
      "Staked CurveYield Governance",
      "stcyGOV",
      0,
      0
    );
    const Locker = await ethers.getContractFactory("MockLockerForCompounderV17");
    const locker = await Locker.deploy(await sdt.getAddress(), await cyvl.getAddress());
    const Revenue = await ethers.getContractFactory("MockRevenueStakingForCompounderV17");
    const revenue = await Revenue.deploy(await cyvl.getAddress(), await gov.getAddress());
    const Compounder = await ethers.getContractFactory("CurveYieldRevenueCompounderV17");
    const compounder = await Compounder.deploy(
      dao.address,
      await cyvl.getAddress(),
      await sdt.getAddress(),
      await gov.getAddress(),
      await locker.getAddress(),
      await revenue.getAddress(),
      await govStaking.getAddress()
    );
    const Adapter = await ethers.getContractFactory("MockCompounderAdapterV17");
    const adapter = await Adapter.deploy();

    await gov.connect(dao).setMinter(await revenue.getAddress(), true);
    await cyvl.mint(user.address, ethers.parseEther("100"));
    await cyvl.connect(user).approve(await compounder.getAddress(), ethers.parseEther("100"));
    await compounder.connect(user).deposit(ethers.parseEther("100"), user.address);

    return { dao, user, cyvl, sdt, gov, govStaking, locker, revenue, compounder, adapter };
  }

  it("locks SDT directly when the market does not beat the one-to-one mint route", async function () {
    const { sdt, locker, compounder } = await fixture();
    await sdt.mint(await compounder.getAddress(), ethers.parseEther("10"));

    await compounder.harvest([], [], ethers.parseEther("10"), Math.floor(Date.now() / 1000) + 3600);
    expect(await locker.deposits()).to.equal(ethers.parseEther("10"));
  });

  it("buys underpeg cyvlSDT when the market quote beats direct locking", async function () {
    const { dao, cyvl, sdt, locker, compounder, adapter } = await fixture();
    await adapter.setQuoteBps(11000);
    await cyvl.mint(await adapter.getAddress(), ethers.parseEther("1000"));
    await compounder.connect(dao).setSdtToCyvlSdtAdapter(await adapter.getAddress());
    await compounder.connect(dao).setMinimumMarketAdvantageBps(100);
    await sdt.mint(await compounder.getAddress(), ethers.parseEther("10"));

    await compounder.harvest([], [], ethers.parseEther("11"), Math.floor(Date.now() / 1000) + 3600);
    expect(await locker.deposits()).to.equal(0);
  });

  it("lets vault holders claim governance emissions directly into the voting stake", async function () {
    const { user, govStaking, revenue, compounder } = await fixture();
    await revenue.setGovernanceEarned(await compounder.getAddress(), ethers.parseEther("10"));

    expect(await compounder.earnedGovernance(user.address)).to.equal(ethers.parseEther("10"));
    await compounder.connect(user).claimGovernance(true);

    expect(await govStaking.balanceOf(user.address)).to.equal(ethers.parseEther("10"));
    expect(await govStaking.getVotes(user.address)).to.equal(ethers.parseEther("10"));
  });
});
