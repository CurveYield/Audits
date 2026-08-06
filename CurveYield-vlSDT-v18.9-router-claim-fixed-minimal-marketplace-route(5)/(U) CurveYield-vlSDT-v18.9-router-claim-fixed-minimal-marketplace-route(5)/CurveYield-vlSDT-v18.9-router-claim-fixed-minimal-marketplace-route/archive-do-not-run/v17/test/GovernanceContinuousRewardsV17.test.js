const { expect } = require("chai");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("Governance Staking continuous active-deposit rewards V17", function () {
  async function deployFixture() {
    const [dao, notifier, alice, bob] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20V17");
    const governance = await MockERC20.deploy("Governance", "GOV");
    const reward = await MockERC20.deploy("Reward", "RWD");
    const Staking = await ethers.getContractFactory("CurveYieldGovernanceStakingV17");
    const staking = await Staking.deploy(
      dao.address,
      await governance.getAddress(),
      "Vote Stake",
      "vSTAKE",
      0,
      0
    );
    await staking.connect(dao).addRewardToken(await reward.getAddress());
    await staking.connect(dao).setNotifier(notifier.address, true);
    for (const user of [alice, bob]) {
      await governance.mint(user.address, ethers.parseEther("100"));
      await governance.connect(user).approve(await staking.getAddress(), ethers.MaxUint256);
    }
    await reward.mint(notifier.address, ethers.parseEther("2000"));
    await reward.connect(notifier).approve(await staking.getAddress(), ethers.MaxUint256);
    return { dao, notifier, alice, bob, governance, reward, staking };
  }

  it("allocates ordinary rewards to whoever remains actively deposited while the stream runs", async function () {
    const { notifier, alice, bob, reward, staking } = await deployFixture();
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await staking.connect(notifier).notifyReward(await reward.getAddress(), ethers.parseEther("140"));
    await increaseTime(7 * DAY);
    await staking.connect(bob).stake(ethers.parseEther("100"));
    await increaseTime(7 * DAY);

    expect(await staking.earned(alice.address, await reward.getAddress())).to.be.closeTo(
      ethers.parseEther("105"), ethers.parseEther("0.01")
    );
    expect(await staking.earned(bob.address, await reward.getAddress())).to.be.closeTo(
      ethers.parseEther("35"), ethers.parseEther("0.01")
    );
  });

  it("stops ordinary reward accrual immediately after a full withdrawal", async function () {
    const { notifier, alice, reward, staking } = await deployFixture();
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await staking.connect(notifier).notifyReward(await reward.getAddress(), ethers.parseEther("140"));
    await increaseTime(7 * DAY);
    await staking.connect(alice).requestWithdrawal(ethers.parseEther("100"), alice.address);
    await increaseTime(7 * DAY);

    expect(await staking.balanceOf(alice.address)).to.equal(0);
    expect(await staking.earned(alice.address, await reward.getAddress())).to.be.closeTo(
      ethers.parseEther("70"), ethers.parseEther("0.01")
    );
  });

  it("reduces ordinary rewards proportionally when the active deposit is reduced", async function () {
    const { notifier, alice, reward, staking } = await deployFixture();
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await staking.connect(notifier).notifyReward(await reward.getAddress(), ethers.parseEther("140"));
    await increaseTime(7 * DAY);
    await staking.connect(alice).requestWithdrawal(ethers.parseEther("50"), alice.address);
    await increaseTime(7 * DAY);

    expect(await staking.balanceOf(alice.address)).to.equal(ethers.parseEther("50"));
    expect(await staking.earned(alice.address, await reward.getAddress())).to.be.closeTo(
      ethers.parseEther("105"), ethers.parseEther("0.01")
    );
  });

  it("uses the same active-deposit behavior for participation rewards", async function () {
    const { notifier, alice, reward, staking } = await deployFixture();
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await staking.connect(notifier).notifyParticipationReward(
      await reward.getAddress(), ethers.parseEther("140")
    );
    await increaseTime(7 * DAY);
    await staking.connect(alice).requestWithdrawal(ethers.parseEther("50"), alice.address);
    await increaseTime(7 * DAY);

    expect(await staking.earned(alice.address, await reward.getAddress())).to.be.closeTo(
      ethers.parseEther("105"), ethers.parseEther("0.01")
    );
  });

  it("allows accrued rewards to be claimed after exit but never grants the unvested remainder", async function () {
    const { notifier, alice, reward, staking } = await deployFixture();
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await staking.connect(notifier).notifyReward(await reward.getAddress(), ethers.parseEther("140"));
    await increaseTime(7 * DAY);
    await staking.connect(alice).requestWithdrawal(ethers.parseEther("100"), alice.address);
    await increaseTime(7 * DAY);

    await staking.connect(alice).claimRewards(alice.address);
    expect(await reward.balanceOf(alice.address)).to.be.closeTo(
      ethers.parseEther("70"), ethers.parseEther("0.01")
    );
    expect(await staking.earned(alice.address, await reward.getAddress())).to.equal(0);
  });
});
