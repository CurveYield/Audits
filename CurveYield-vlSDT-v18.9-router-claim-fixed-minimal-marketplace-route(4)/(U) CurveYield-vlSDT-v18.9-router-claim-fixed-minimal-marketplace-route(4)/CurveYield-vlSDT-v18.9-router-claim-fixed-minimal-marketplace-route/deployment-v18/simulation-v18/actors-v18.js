"use strict";

const { ethers } = require("../lib-v18");

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)"
];

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

function extractTransferRecipients(logs) {
  const seen = new Set();
  const recipients = [];
  for (const log of logs) {
    if (!log.topics || log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;
    const address = ethers.getAddress(ethers.dataSlice(log.topics[2], 12));
    if (address === ethers.ZeroAddress || seen.has(address)) continue;
    seen.add(address);
    recipients.push(address);
  }
  return recipients;
}

async function setEthBalance(provider, address, amount = ethers.parseEther("100")) {
  await provider.send("anvil_setBalance", [address, ethers.toBeHex(amount)]);
}

async function createEphemeralActors(provider, names) {
  const actors = {};
  for (const name of names) {
    if (actors[name]) throw new Error(`duplicate actor name: ${name}`);
    const wallet = ethers.Wallet.createRandom().connect(provider);
    await setEthBalance(provider, wallet.address);
    actors[name] = wallet;
  }
  return actors;
}

async function withImpersonatedSigner(provider, address, operation) {
  const normalized = ethers.getAddress(address);
  await setEthBalance(provider, normalized);
  await provider.send("anvil_impersonateAccount", [normalized]);
  try {
    const signer = await provider.getSigner(normalized);
    return await operation(signer);
  } finally {
    await provider.send("anvil_stopImpersonatingAccount", [normalized]);
  }
}

async function pendingImpersonatedOverrides(provider, address, gasLimit) {
  const nonce = await provider.getTransactionCount(address, "pending");
  return { gasLimit, nonce };
}

function isRetryableForkTransportError(error) {
  const rpcError = error && (
    (error.info && error.info.error)
    || error.error
  );
  if (!rpcError || Number(rpcError.code) !== -32603) return false;
  const message = String(rpcError.message || "");
  return message.includes("Fork Error")
    && (message.includes("status: 408") || message.includes("Request timeout"));
}

async function firstFundedCandidate(token, candidates, minimum) {
  const unique = [...new Set(candidates.map(ethers.getAddress))];
  for (let offset = 0; offset < unique.length; offset += 12) {
    const batch = unique.slice(offset, offset + 12);
    const balances = await Promise.all(batch.map(address =>
      token.balanceOf(address).catch(() => 0n)
    ));
    for (let i = 0; i < batch.length; i++) {
      if (balances[i] >= minimum) return { address: batch[i], balance: balances[i] };
    }
  }
  return null;
}

async function findRealTokenHolder({
  provider,
  tokenAddress,
  minimum,
  candidates = [],
  lookbackBlocks = 5_000,
  maxWindows = 3
}) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  let result = await firstFundedCandidate(token, candidates, minimum);
  if (result) return result;

  const latest = await provider.getBlockNumber();
  for (let window = 0; window < maxWindows; window++) {
    const toBlock = latest - window * lookbackBlocks;
    const fromBlock = Math.max(0, toBlock - lookbackBlocks + 1);
    let logs;
    try {
      logs = await provider.getLogs({
        address: tokenAddress,
        topics: [TRANSFER_TOPIC],
        fromBlock,
        toBlock
      });
    } catch (error) {
      throw new Error(
        `unable to query real token holders for ${tokenAddress} in blocks ${fromBlock}-${toBlock}: `
        + String(error.shortMessage || error.message || error)
      );
    }
    const recentRecipients = extractTransferRecipients(logs).reverse().slice(0, 72);
    result = await firstFundedCandidate(token, recentRecipients, minimum);
    if (result) return result;
  }
  throw new Error(
    `no real holder of ${tokenAddress} with at least ${minimum} found in the bounded candidate search`
  );
}

async function fundErc20FromRealHolder({
  provider,
  tokenAddress,
  recipient,
  amount,
  candidates = []
}) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const holder = await findRealTokenHolder({
    provider,
    tokenAddress,
    minimum: amount,
    candidates
  });
  const before = await token.balanceOf(recipient);
  const transferOnce = () => withImpersonatedSigner(provider, holder.address, async signer => {
      const overrides = await pendingImpersonatedOverrides(
        provider,
        holder.address,
        150_000n
      );
      const tx = await token.connect(signer).transfer(recipient, amount, overrides);
      return tx.wait();
    });
  let receipt;
  let retryCount = 0;
  let recoveredAfterTimeout = false;
  try {
    receipt = await transferOnce();
  } catch (error) {
    if (!isRetryableForkTransportError(error)) throw error;
    const afterTimedOutAttempt = await token.balanceOf(recipient);
    if (afterTimedOutAttempt - before === amount) {
      recoveredAfterTimeout = true;
    } else {
      if (afterTimedOutAttempt !== before) {
        throw new Error(`non-exact balance change after timed-out funding transfer for ${tokenAddress}`);
      }
      retryCount = 1;
      receipt = await transferOnce();
    }
  }
  const after = await token.balanceOf(recipient);
  if (after - before !== amount) {
    throw new Error(`non-exact real-holder funding transfer for ${tokenAddress}`);
  }
  return {
    holder: holder.address,
    holderBalance: holder.balance.toString(),
    amount: amount.toString(),
    transactionHash: receipt ? receipt.hash : null,
    gasUsed: receipt ? receipt.gasUsed.toString() : null,
    retryCount,
    recoveredAfterTimeout
  };
}

module.exports = {
  ERC20_ABI,
  TRANSFER_TOPIC,
  extractTransferRecipients,
  setEthBalance,
  createEphemeralActors,
  withImpersonatedSigner,
  pendingImpersonatedOverrides,
  isRetryableForkTransportError,
  findRealTokenHolder,
  fundErc20FromRealHolder
};
