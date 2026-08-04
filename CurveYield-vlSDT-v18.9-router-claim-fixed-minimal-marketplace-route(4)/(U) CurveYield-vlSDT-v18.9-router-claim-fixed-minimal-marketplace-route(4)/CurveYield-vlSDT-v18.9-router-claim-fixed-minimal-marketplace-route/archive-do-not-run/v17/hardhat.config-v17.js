require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, hre, runSuper) => {
  if (solcVersion === '0.8.28') {
    const solc = require('solc');
    return {
      compilerPath: require.resolve('solc/soljson.js'),
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
  evmVersion: 'cancun'
};

module.exports = {
  solidity: {
    compilers: [{ version: '0.8.28', settings: baseSettings }],
    overrides: {
      'contracts/CurveYieldGovernanceStakingV17.sol': {
        version: '0.8.28',
        settings: { ...baseSettings, optimizer: { enabled: true, runs: 1 }, viaIR: true }
      }
    }
  },
  mocha: { timeout: 120000 }
};
