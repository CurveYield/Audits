import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const math = await import(pathToFileURL(path.join(ROOT, 'src-v11/yield-math.js')));

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('v11 effective yield includes retained Yield Boosting Tokens in user return', () => {
  assert.equal(typeof math.calculateEffectiveBoostHubYield, 'function');
  const result = math.calculateEffectiveBoostHubYield({
    minAprBps: 1000,
    maxAprBps: 2500,
    voteBoostMultiplier: 2.5,
    gaugeBalance: 140,
    accountedPrincipal: 100,
  });
  close(result.yieldBoostingFactor, 1.4);
  close(result.boostHubAprBps, 3500);
  close(result.boostMultiplier, 3.5);
  assert.ok(result.vaultApyBps > result.boostHubAprBps);
});

test('v11 sdFXS uses StakeDAO default APR plus retained stake rather than smoothed receipt/strategy APR', () => {
  assert.equal(typeof math.calculateEffectiveBoostHubYield, 'function');
  const result = math.calculateEffectiveBoostHubYield({
    minAprBps: 1000,
    maxAprBps: 1800,
    voteBoostMultiplier: 1,
    gaugeBalance: 193,
    accountedPrincipal: 100,
  });
  close(result.defaultAprBps, 1000);
  close(result.boostHubAprBps, 1930);
  close(result.boostMultiplier, 1.93);

  const live = read('src-v11/live-data.js');
  assert.doesNotMatch(live, /if \(locker\.gaugeModel === "xchain-uniform"\) boostMultiplier = 1/);
  assert.match(live, /calculateEffectiveBoostHubYield/);
});

test('v11 Admin pending BoostHub rewards queries the external gauge claimable_reward path', () => {
  const abi = read('src-v11/abi.js');
  const live = read('src-v11/live-data.js');
  assert.match(abi, /claimable_reward\(address,address\)/);
  assert.match(live, /claimable_reward\(topology\.boostHubAddress/);
  assert.doesNotMatch(live, /pendingRewards\(topology\.pid, locker\.stakingAddress\)/);
});

test('v11 removes placeholder TOKEN rows from Admin pending reward display', () => {
  const app = read('src-v11/app.js');
  const live = read('src-v11/live-data.js');
  assert.doesNotMatch(app, />TOKEN</);
  assert.match(live, /filter\(.*amount.*>\s*0/s);
});

test('v11 removes the unsolicited XChain boost explanation and puts Contract Information last', () => {
  const app = read('src-v11/app.js');
  assert.doesNotMatch(app, /XChain gauge distributes rewards uniformly; no working-balance boost/);
  const start = app.indexOf('function renderLocker(id)');
  const end = app.indexOf('function renderActionModules', start);
  const block = app.slice(start, end);
  const contractAt = block.lastIndexOf('${renderContractSummary(locker, live)}');
  const trustAt = block.lastIndexOf('locker-trust-strip');
  const insightsAt = block.lastIndexOf('locker-insights-grid');
  assert.ok(contractAt > trustAt && contractAt > insightsAt, 'Contract Information must be final locker row');
});

test('v11 historical chart makes both real series independently visible with latest values', () => {
  const app = read('src-v11/app.js');
  assert.match(app, /StakeDAO Default APR/);
  assert.match(app, /BoostHub Vault APY/);
  assert.match(app, /latest-history-value/);
  assert.match(app, /staking-apr-series/);
  assert.match(app, /vault-apy-series/);
});

test('v11 uses corrected crvUSD and StakeDAO elephant assets plus non-placeholder Home metric icons', () => {
  const config = read('src-v11/config.js');
  const app = read('src-v11/app.js');
  assert.match(config, /cdn\.jsdelivr\.net\/gh\/curvefi\/curve-assets\/images\/assets\/0xf939e0a03fb07f59a73314e73794be0e57ac1b4e\.png/);
  assert.match(config, /fallbackIcon:\s*"\.\/assets\/tokens\/crvusd-clean\.png"/);
  assert.match(app, /data-icon-fallback/);
  assert.match(app, /installImageFallbacks/);
  assert.match(config, /stakedao-elephant\.svg/);
  assert.equal(fs.existsSync(path.join(ROOT, 'assets/tokens/crvusd.png')), false, 'obsolete crvUSD asset must not ship');
  assert.equal(fs.existsSync(path.join(ROOT, 'assets/tokens/crvusdlogo.jpg')), false, 'obsolete crvUSD logo asset must not ship');
  const serviceWorker = read('service-worker.js');
  assert.doesNotMatch(serviceWorker, /assets\/tokens\/crvusd\.png/);
  assert.doesNotMatch(serviceWorker, /assets\/tokens\/crvusdlogo\.jpg/);
  assert.match(app, /summaryMetricIcon/);
  assert.doesNotMatch(app, /summaryMetric\([^\n]+"◆"\)/);
  assert.doesNotMatch(app, /summaryMetric\([^\n]+"◉"\)/);
  assert.doesNotMatch(app, /summaryMetric\([^\n]+"⌁"\)/);
});


test('v11 StakeDAO gauge ABI exposes claimable_reward used by Admin pending reads', async () => {
  const abiModule = await import(pathToFileURL(path.join(ROOT, 'src-v11/abi.js')));
  assert.ok(
    abiModule.STAKEDAO_GAUGE_ABI.some((entry) => String(entry).includes('claimable_reward(address,address)')),
    'STAKEDAO_GAUGE_ABI must include claimable_reward(address,address)',
  );
});

test('v11 Admin discovers configured StakeDAO claim executor and separates vote-incentive pending value', () => {
  const abi = read('src-v11/abi.js');
  const live = read('src-v11/live-data.js');
  const app = read('src-v11/app.js');
  assert.match(abi, /stakeDaoClaimExecutor\(\)/);
  assert.match(abi, /pendingTokens\(uint256\)/);
  assert.match(abi, /getClaim\(address\)/);
  assert.match(live, /stakeDaoClaimExecutor\(\)/);
  assert.match(live, /pendingTokens\(topology\.pid\)/);
  assert.match(live, /voteIncentiveRewards/);
  assert.match(live, /directPendingValueUsd/);
  assert.match(live, /voteIncentiveValueUsd/);
  assert.match(app, /Gauge rewards/);
  assert.match(app, /Vote incentives \/ airdrops/);
});
