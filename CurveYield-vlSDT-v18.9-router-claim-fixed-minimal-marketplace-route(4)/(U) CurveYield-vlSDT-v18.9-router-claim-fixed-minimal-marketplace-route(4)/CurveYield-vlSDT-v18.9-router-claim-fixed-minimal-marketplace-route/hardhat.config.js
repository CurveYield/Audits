require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, hre, runSuper) => {
  if (solcVersion === "0.8.28") {
    const solc = require("solc");
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: solcVersion,
      longVersion: solc.version()
    };
  }
  return runSuper();
});

const baseSettings = {
  optimizer: { enabled: true, runs: 200 },
  viaIR: false,
  evmVersion: "cancun"
};

const forkUrl = process.env.CURVEYIELD_HARDHAT_FORK_URL;
const forkBlock = process.env.CURVEYIELD_HARDHAT_FORK_BLOCK;
const hardhatNetwork = { chainId: 1 };
if (forkUrl) {
  hardhatNetwork.forking = { url: forkUrl };
  if (forkBlock) hardhatNetwork.forking.blockNumber = Number(forkBlock);
}

module.exports = {
  solidity: {
    compilers: [{ version: "0.8.28", settings: baseSettings }],
    overrides: {
      "contracts/CurveYieldGovernanceStaking.sol": {
        version: "0.8.28",
        settings: {
          ...baseSettings,
          optimizer: { enabled: true, runs: 0 },
          viaIR: false,
          metadata: { bytecodeHash: "none", appendCBOR: false }
        }
      }
    }
  },
  networks: { hardhat: hardhatNetwork },
  paths: {
    sources: "./contracts",
    tests: "./test/v18",
    cache: "./cache-v18",
    artifacts: "./artifacts-v18"
  },
  mocha: { timeout: 120000 }
};
