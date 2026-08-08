import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../../src-v11/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../styles-v11.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../../src-v11/config.js', import.meta.url), 'utf8');

const count = (source, needle) => source.split(needle).length - 1;

test('v10 shell uses versioned white runtime assets', () => {
  assert.match(html, /styles-v11\.css/);
  assert.match(html, /src-v11\/app\.js/);
  assert.match(html, /theme-color" content="#f7f7f5"/);
  assert.match(app, /appVersion:\s*"v11"/);
});

test('homepage aggregate row uses meaningful non-TVL stats', () => {
  for (const label of ['Delegated vlSDT', 'Highest Boosted Staking APR', 'Highest Vault APY', 'Live Reward Streams']) assert.match(app, new RegExp(label));
  assert.doesNotMatch(app, /metric\("Total Value Locked"/);
  assert.doesNotMatch(app, /metric\("Active Lockers"/);
});

test('locker keeps existing production metric semantics', () => {
  for (const label of ['Default APR', 'BoostHub APY', 'Boost Multiplier', 'Yield Boosting Tokens']) assert.match(app, new RegExp(label));
});

test('white redesign has sidebar, two reward columns, chart and activity surfaces', () => {
  for (const token of ['app-sidebar', 'home-reward-columns', 'staking-reward-column', 'vault-reward-column', 'yield-history-panel', 'recent-activity-panel']) assert.ok(css.includes(`.${token}`) || app.includes(token), token);
});

test('production sdCRV vault and strategy remain unchanged', () => {
  assert.equal(count(config, '0xdB6AA572243b9617C4b39FB20468843b2CB97bA5'), 1);
  assert.equal(count(config, '0x93DFEfeFd5D3736381086eFa5A8810F278138ADf'), 1);
});
