#!/usr/bin/env node
"use strict";

const { ethers } = require("ethers");

const ZERO = ethers.ZeroAddress;
const MAX_PROPOSAL_BATCH = 25;
const MAX_RETAINED_WINDOW = 15;
const DEFAULT_LOG_CHUNK = 10_000;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function address(name) {
  const value = required(name);
  if (!ethers.isAddress(value) || value === ZERO) throw new Error(`${name} must be a non-zero address`);
  return ethers.getAddress(value);
}

async function getLogsChunked(provider, filter, fromBlock, toBlock, chunkSize) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    logs.push(...await provider.getLogs({ ...filter, fromBlock: start, toBlock: end }));
  }
  return logs;
}

function sortLogs(logs) {
  return logs.sort((a, b) =>
    a.blockNumber - b.blockNumber
    || (a.transactionIndex ?? 0) - (b.transactionIndex ?? 0)
    || a.index - b.index
  );
}

async function discoverProposalIds(provider, pluginAddress, fromBlock, toBlock, chunkSize) {
  const proposalInterface = new ethers.Interface([
    "event ProposalCreated(uint256 indexed proposalId,address indexed creator,uint64 startDate,uint64 endDate,bytes metadata,tuple(address to,uint256 value,bytes data)[] actions,uint256 allowFailureMap)"
  ]);
  const logs = await getLogsChunked(
    provider,
    { address: pluginAddress, topics: [proposalInterface.getEvent("ProposalCreated").topicHash] },
    fromBlock,
    toBlock,
    chunkSize
  );
  return sortLogs(logs).map((log) => proposalInterface.parseLog(log).args.proposalId);
}

function optionalKickAccounts() {
  const raw = process.env.PARTICIPATION_KICK_ACCOUNTS || "";
  if (!raw.trim()) return [];
  return [...new Set(raw.split(",").map((value) => ethers.getAddress(value.trim())))];
}

async function main() {
  const provider = new ethers.JsonRpcProvider(required("RPC_URL"));
  const wallet = new ethers.Wallet(required("PROPOSAL_REGISTRAR_PRIVATE_KEY"), provider);
  const stakingAddress = address("GOVERNANCE_STAKING_ADDRESS");
  const pluginAddress = address("ARAGON_TOKEN_VOTING_ADDRESS");
  const startBlock = Number(required("INDEX_START_BLOCK"));
  const confirmations = Number(process.env.CONFIRMATIONS || "12");
  const chunkSize = Number(process.env.LOG_CHUNK_SIZE || DEFAULT_LOG_CHUNK);

  if (!Number.isSafeInteger(startBlock) || startBlock < 0) throw new Error("INDEX_START_BLOCK must be a block number");
  if (!Number.isSafeInteger(confirmations) || confirmations < 0) throw new Error("CONFIRMATIONS must be non-negative");

  const stakingAbi = [
    "function isProposalRegistrar(address) view returns (bool)",
    "function canonicalProposalCount() view returns (uint256)",
    "function canonicalProposalWindowCount() view returns (uint256)",
    "function canonicalProposals(uint256) view returns (uint256 proposalId,uint64 endDate,uint64 snapshotTimepoint)",
    "function registerFinalizedProposals(uint256 expectedStartIndex,uint256[] proposalIds)",
    "function kick(address account) returns (uint256 evaluatedProposals)"
  ];
  const pluginAbi = [
    "function getProposal(uint256) view returns (bool open,bool executed,tuple(uint8 votingMode,uint32 supportThreshold,uint64 startDate,uint64 endDate,uint64 snapshotTimepoint,uint256 minVotingPower) parameters,tuple(uint256 abstain,uint256 yes,uint256 no) tally,tuple(address to,uint256 value,bytes data)[] actions,uint256 allowFailureMap,tuple(address target,uint8 operation) targetConfig)"
  ];
  const staking = new ethers.Contract(stakingAddress, stakingAbi, wallet);
  const plugin = new ethers.Contract(pluginAddress, pluginAbi, provider);

  if (!(await staking.isProposalRegistrar(wallet.address))) {
    throw new Error(`Registrar wallet ${wallet.address} does not have the proposal-registrar role`);
  }

  const latest = await provider.getBlockNumber();
  const safeBlock = latest - confirmations;
  if (safeBlock < startBlock) {
    console.log("No confirmed block range is available yet.");
    return;
  }

  const orderedIds = await discoverProposalIds(provider, pluginAddress, startBlock, safeBlock, chunkSize);
  const registeredCount = await staking.canonicalProposalCount();
  if (registeredCount > BigInt(orderedIds.length)) {
    throw new Error(
      `On-chain registered count ${registeredCount} exceeds ${orderedIds.length} discovered ProposalCreated logs`
    );
  }

  if (registeredCount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Registered proposal count exceeds JavaScript safe integer range");
  }
  const startIndex = Number(registeredCount);
  const windowCountValue = await staking.canonicalProposalWindowCount();
  if (windowCountValue > registeredCount || windowCountValue > BigInt(MAX_RETAINED_WINDOW)) {
    throw new Error(`Invalid on-chain proposal window size ${windowCountValue}`);
  }
  const windowCount = Number(windowCountValue);
  for (let i = 0; i < windowCount; i++) {
    const stored = await staking.canonicalProposals(i);
    const expectedId = orderedIds[startIndex - windowCount + i];
    if (stored.proposalId !== expectedId) {
      throw new Error(
        `Proposal-history mismatch at retained window index ${i}: on-chain=${stored.proposalId}, log=${expectedId}`
      );
    }
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const batch = [];

  for (let i = startIndex; i < orderedIds.length; i++) {
    const proposalId = orderedIds[i];
    const proposal = await plugin.getProposal(proposalId);
    const endDate = BigInt(proposal.parameters.endDate);
    // Preserve event order: stop at the first unregistered proposal that is not finalized.
    if (proposal.open || endDate === 0n || endDate > now) break;
    batch.push(proposalId);
    if (batch.length === MAX_PROPOSAL_BATCH) break;
  }

  if (batch.length !== 0) {
    const registerTx = await staking.registerFinalizedProposals(registeredCount, batch);
    await registerTx.wait();
    console.log(`Registered ${batch.length} canonical proposals: ${registerTx.hash}`);
  } else {
    console.log("No finalized canonical proposals need registration.");
  }

  for (const account of optionalKickAccounts()) {
    const tx = await staking.kick(account);
    await tx.wait();
    console.log(`Kicked participation weight for ${account}: ${tx.hash}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
