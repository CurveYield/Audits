import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAINS, LOCKERS, TOKENS } from '../../src-v11/config.js';
import { createLiveDataClient } from '../../src-v11/live-data.js';

const BOOST = '0xFbEF8941Da53EA724385B44E91ae9672061D0263';
const HELPER = '0x1111111111111111111111111111111111111111';
const E18 = 10n ** 18n;

class FakeProvider {
  destroy() {}
  async call() { return '0x'; }
  async estimateGas() { return 21000n; }
  async getBlockNumber() { return 123; }
  async getLogs() { return []; }
}

function makeEthers() {
  class FakeInterface {
    encodeFunctionData(name) { return `0x${name}`; }
  }
  class FakeContract {
    constructor(address) {
      this.address = String(address);
      return new Proxy(this, {
        get: (target, prop) => {
          if (prop === 'then') return undefined;
          if (prop in target) return target[prop];
          return async (...args) => {
            const a = target.address.toLowerCase();
            if (prop === 'claimable_reward') {
              if (a === LOCKERS[0].gaugeAddress.toLowerCase()) return 100000000000000000n; // 0.1 direct
              return 0n;
            }
            if (prop === 'stakeDaoClaimExecutor') return HELPER;
            if (prop === 'pendingTokens') return [TOKENS.sdCRV.address];
            if (prop === 'getClaim') return [[0n, 1n, 200000000000000000n, 1n, '0x' + '11'.repeat(32), true], []]; // 0.2 incentive
            if (prop === 'paused') return false;
            throw new Error(`Unexpected ${String(prop)} on ${target.address}: ${args}`);
          };
        },
      });
    }
  }
  return {
    JsonRpcProvider: FakeProvider,
    Contract: FakeContract,
    Interface: FakeInterface,
    id() { return '0x' + '00'.repeat(32); },
    formatUnits(value, decimals = 18) { return (Number(value) / 10 ** Number(decimals)).toString(); },
  };
}

test('Admin totals external gauge rewards and configured StakeDAO vote incentives without TOKEN placeholders', async () => {
  const client = createLiveDataClient({
    ethers: makeEthers(),
    chains: CHAINS,
    tokens: TOKENS,
    stakeDaoClient: { async getLockerRange() { return null; } },
    curveApyClient: { async getPoolMaxApy() { return null; } },
  });
  const locker = LOCKERS.find((item) => item.id === 'sdcrv');
  const live = {
    topology: {
      boostHubAddress: BOOST,
      pid: 0,
      gaugeAddress: locker.gaugeAddress,
      strategyAddress: locker.strategyAddress,
    },
    claimRewards: [{
      address: TOKENS.sdCRV.address.toLowerCase(),
      symbol: 'sdCRV',
      decimals: 18,
      priceUsd: 2,
    }],
  };
  const admin = await client.readAdminHarvestData(locker, '0x2222222222222222222222222222222222222222', live);
  assert.equal(admin.boostHub.pendingRewards.length, 1);
  assert.equal(admin.boostHub.voteIncentiveRewards.length, 1);
  assert.equal(admin.boostHub.pendingRewards[0].symbol, 'sdCRV');
  assert.equal(admin.boostHub.voteIncentiveRewards[0].symbol, 'sdCRV');
  assert.equal(admin.boostHub.directPendingValueUsd, 0.2);
  assert.equal(admin.boostHub.voteIncentiveValueUsd, 0.4);
  assert.ok(Math.abs(admin.boostHub.pendingValueUsd - 0.6) < 1e-12);
});
