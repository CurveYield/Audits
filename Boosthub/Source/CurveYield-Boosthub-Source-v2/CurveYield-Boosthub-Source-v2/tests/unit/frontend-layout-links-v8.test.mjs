import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  LOCKERS,
  blockscoutInteractionUrl,
  blockscoutSourceUrl,
} from '../../src-v11/config.js';

const visible = LOCKERS.filter((locker) => !locker.hidden);
const appSource = await readFile(new URL('../../src-v11/app.js', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../../styles-v11.css', import.meta.url), 'utf8');

const expectedStakingInteractionUrls = {
  sdcrv: 'https://eth.blockscout.com/token/0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C?tab=read_write_contract',
  sdfxn: 'https://eth.blockscout.com/token/0x7d53B437f950d6F515C8871aC985F1e875d6B52E?tab=read_write_contract',
  sdfxs: 'https://explorer.mainnet.frax.com/token/0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183?tab=read_write_contract',
};

test('sdCRV replacement vault remains configured in every visible build', () => {
  const sdcrv = visible.find((locker) => locker.id === 'sdcrv');
  assert.equal(sdcrv.vaultAddress, '0xdB6AA572243b9617C4b39FB20468843b2CB97bA5');
  assert.equal(sdcrv.strategyAddress, '0x93DFEfeFd5D3736381086eFa5A8810F278138ADf');
});

test('all staking contracts use chain-native Blockscout read/write pages', () => {
  for (const locker of visible) {
    assert.equal(locker.stakingInteractionUrl, expectedStakingInteractionUrls[locker.id]);
    assert.equal(
      locker.stakingInteractionUrl,
      blockscoutInteractionUrl(locker.chainId, locker.stakingAddress, { token: true }),
    );
    assert.equal(
      locker.stakingSourceUrl,
      blockscoutSourceUrl(locker.chainId, locker.stakingAddress, { token: true }),
    );
  }
});

test('home reward summary renders separate staking and vault table columns', () => {
  assert.match(appSource, /class="home-reward-column staking-reward-column"/);
  assert.match(appSource, /class="home-reward-column vault-reward-column"/);
  assert.match(appSource, /<h3>Staking Rewards<\/h3>/);
  assert.match(appSource, /<h3>Vault Rewards<\/h3>/);
  assert.doesNotMatch(appSource, /Staking &amp; Vault Rewards/);
  assert.match(stylesSource, /home-reward-columns[\s\S]*grid-template-columns/);
  assert.match(stylesSource, /\.reward-cell-list[\s\S]*flex-direction:\s*column/);
});

test('desktop contract summary uses three equal cards and mobile stacks them', () => {
  assert.match(stylesSource, /\.contract-summary\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.doesNotMatch(stylesSource, /\.strategy-contract-summary\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(stylesSource, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.contract-summary\s*\{\s*grid-template-columns:\s*1fr;/);
});

test('contract cards use Blockscout read/write as primary and source as secondary', () => {
  assert.match(appSource, /Read \/ Write/);
  assert.match(appSource, /Verified source/);
  assert.match(appSource, /blockscoutInteractionUrl/);
  assert.match(appSource, /blockscoutSourceUrl/);
});
