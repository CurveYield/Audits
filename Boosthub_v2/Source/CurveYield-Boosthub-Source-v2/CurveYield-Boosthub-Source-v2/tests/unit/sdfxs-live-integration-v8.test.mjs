import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAINS, LOCKERS, TOKENS } from '../../src-v11/config.js';
import { createLiveDataClient } from '../../src-v11/live-data.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const BOOST = '0xFbEF8941Da53EA724385B44E91ae9672061D0263';
const GAUGE = '0x12992595328E52267c95e45B1a97014D6Ddf8683';
const LP = '0x1AEe2382e05Dc68BDfC472F1E46d570feCca5814';
const WFRAX = '0xFc00000000000000000000000000000000000002';
const STRATEGY = '0xF64bC212C4dD190d10764B8B447C62368908c2AE';
const STAKING = '0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183';
const E18 = 10n ** 18n;

function addressEq(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }

class FakeProvider {
  destroy() {}
  async getBlockNumber() { return 123; }
}

function makeEthers(calls) {
  class FakeContract {
    constructor(address) {
      this.address = address;
      return new Proxy(this, {
        get: (target, prop) => {
          if (prop in target) return target[prop];
          return async (...args) => {
            calls.push({ address: String(address).toLowerCase(), method: String(prop), args });
            switch (prop) {
              case 'boost_hub': return BOOST;
              case 'pid': return 0n;
              case 'lp_token': return LP;
              case 'poolInfo': return [LP, GAUGE, true, 1000n * E18, [LP, WFRAX]];
              case 'working_balances': throw new Error('XChain gauge must never call working_balances');
              case 'balanceOf': return addressEq(address, GAUGE) ? 1930n * E18 : 1000n * E18;
              case 'getPricePerFullShare': return E18;
              case 'balance': return 1000n * E18;
              case 'totalSupply': return 1000n * E18;
              case 'decimals': return 18n;
              case 'strategy': return STRATEGY;
              case 'estimatedTokenAprBps': return 1000n;
              case 'aprLastUpdate': return 1_786_000_000n;
              case 'yieldBoostingTokens': return [LP, 100n * E18];
              case 'reward_tokens': {
                const index = Number(args[0]);
                return index === 0 ? LP : index === 1 ? WFRAX : ZERO;
              }
              case 'reward_token_apr_bps': return addressEq(args[0], LP) ? 500n : 500n;
              case 'symbol': return addressEq(address, LP) ? 'sdFXS' : addressEq(address, WFRAX) ? 'WFRAX' : 'TOKEN';
              default: throw new Error(`Unexpected ${String(prop)} on ${address}`);
            }
          };
        },
      });
    }
  }
  return {
    JsonRpcProvider: FakeProvider,
    Contract: FakeContract,
    formatUnits(value, decimals = 18) { return (Number(value) / 10 ** Number(decimals)).toString(); },
  };
}

test('sdFXS readLocker uses StakeDAO default APR plus retained stake and never calls XChain working_balances', async () => {
  const calls = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, async json() { return { coins: {} }; } });
  try {
    const stakeDaoClient = {
      async getLockerRange() {
        return {
          minAprBps: 1500,
          maxAprBps: 2900,
          sdTokenPriceUsd: 2,
          tokenPriceUsd: 2,
          lockerId: 'fxs',
          lastUpdate: 1_786_000_000,
          rewards: [
            { address: LP.toLowerCase(), symbol: 'sdFXS', decimals: 18, priceUsd: 2, aprBps: 450 },
            { address: WFRAX.toLowerCase(), symbol: 'WFRAX', decimals: 18, priceUsd: 1, aprBps: 200 },
          ],
        };
      },
    };
    const curveApyClient = { async getPoolMaxApy() { return null; } };
    const client = createLiveDataClient({ ethers: makeEthers(calls), chains: CHAINS, tokens: TOKENS, stakeDaoClient, curveApyClient });
    const locker = LOCKERS.find((entry) => entry.id === 'sdfxs');
    const live = await client.readLocker(locker);

    assert.equal(calls.some((call) => call.method === 'working_balances'), false);
    assert.equal(calls.filter((call) => call.method === 'reward_token_apr_bps').length, 2);
    assert.equal(live.boostModel, 'xchain-uniform');
    assert.equal(Number(live.boostMultiplier.toFixed(2)), 1.93);
    assert.equal(Math.round(live.defaultAprBps), 1500);
    assert.equal(Math.round(live.boostHubAprBps), 2895);
    assert.ok(live.vaultApyBps > live.boostHubAprBps);
    assert.equal(live.rewards.find((reward) => reward.symbol === 'sdFXS').aprBps, 450);
    assert.equal(live.rewards.find((reward) => reward.symbol === 'WFRAX').aprBps, 200);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
