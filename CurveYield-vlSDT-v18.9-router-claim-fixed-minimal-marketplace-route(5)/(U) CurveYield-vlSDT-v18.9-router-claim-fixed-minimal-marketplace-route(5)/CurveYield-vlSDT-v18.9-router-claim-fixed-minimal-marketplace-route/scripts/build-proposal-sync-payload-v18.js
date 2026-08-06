#!/usr/bin/env node
"use strict";

const fs = require("fs");
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

async function main() {
  const provider = new ethers.JsonRpcProvider(required("RPC_URL"));
  const signer = new ethers.Wallet(required("PROPOSAL_REGISTRAR_PRIVATE_KEY"), provider);
  const stakingAddress = address("GOVERNANCE_STAKING_ADDRESS");
  const pluginAddress = address("ARAGON_TOKEN_VOTING_ADDRESS");
  const startBlock = Number(required("INDEX_START_BLOCK"));
  const confirmations = Number(process.env.CONFIRMATIONS || "12");
  const chunkSize = Number(process.env.LOG_CHUNK_SIZE || DEFAULT_LOG_CHUNK);
  const deadlineSeconds = Number(process.env.SYNC_DEADLINE_SECONDS || "900");
  const caller = address("PROPOSAL_SYNC_CALLER");

  if (!Number.isSafeInteger(startBlock) || startBlock < 0) throw new Error("INDEX_START_BLOCK must be a block number");
  if (!Number.isSafeInteger(confirmations) || confirmations < 0) throw new Error("CONFIRMATIONS must be non-negative");
  if (!Number.isSafeInteger(deadlineSeconds) || deadlineSeconds <= 0) {
    throw new Error("SYNC_DEADLINE_SECONDS must be a positive integer");
  }

  const stakingAbi = [
    "function name() view returns (string)",
    "function governanceBoostStrategy() view returns (address)"
  ];
  const strategyAbi = [
    "function isProposalRegistrar(address) view returns (bool)",
    "function registeredProposalCount() view returns (uint256)",
    "function canonicalProposalWindowCount() view returns (uint256)",
    "function canonicalProposals(uint256) view returns (uint256 proposalId,uint64 endDate,uint64 snapshotTimepoint)"
  ];
  const pluginAbi = [
    "function getProposal(uint256) view returns (bool open,bool executed,tuple(uint8 votingMode,uint32 supportThreshold,uint64 startDate,uint64 endDate,uint64 snapshotTimepoint,uint256 minVotingPower) parameters,tuple(uint256 abstain,uint256 yes,uint256 no) tally,tuple(address to,uint256 value,bytes data)[] actions,uint256 allowFailureMap,tuple(address target,uint8 operation) targetConfig)"
  ];
  const staking = new ethers.Contract(stakingAddress, stakingAbi, provider);
  const strategyAddress = await staking.governanceBoostStrategy();
  if (strategyAddress === ZERO) throw new Error("Governance boost strategy is not configured");
  const strategy = new ethers.Contract(strategyAddress, strategyAbi, provider);
  const plugin = new ethers.Contract(pluginAddress, pluginAbi, provider);

  if (!(await strategy.isProposalRegistrar(signer.address))) {
    throw new Error(`Signer ${signer.address} does not have the proposal-registrar role`);
  }

  const latest = await provider.getBlockNumber();
  const safeBlock = latest - confirmations;
  if (safeBlock < startBlock) throw new Error("No confirmed proposal-log range is available yet");

  const orderedIds = await discoverProposalIds(provider, pluginAddress, startBlock, safeBlock, chunkSize);
  const registeredCount = await strategy.registeredProposalCount();
  if (registeredCount > BigInt(orderedIds.length)) {
    throw new Error(`On-chain registered count ${registeredCount} exceeds ${orderedIds.length} discovered logs`);
  }
  if (registeredCount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Registered proposal count exceeds JavaScript safe integer range");
  }

  const startIndex = Number(registeredCount);
  const windowCountValue = await strategy.canonicalProposalWindowCount();
  if (windowCountValue > registeredCount || windowCountValue > BigInt(MAX_RETAINED_WINDOW)) {
    throw new Error(`Invalid on-chain proposal window size ${windowCountValue}`);
  }
  const windowCount = Number(windowCountValue);
  for (let i = 0; i < windowCount; i++) {
    const stored = await strategy.canonicalProposals(i);
    const expectedId = orderedIds[startIndex - windowCount + i];
    if (stored.proposalId !== expectedId) {
      throw new Error(
        `Proposal-history mismatch at retained window index ${i}: on-chain=${stored.proposalId}, log=${expectedId}`
      );
    }
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const proposalIds = [];
  for (let i = startIndex; i < orderedIds.length; i++) {
    const proposalId = orderedIds[i];
    const proposal = await plugin.getProposal(proposalId);
    const endDate = BigInt(proposal.parameters.endDate);
    if (proposal.open || endDate === 0n || endDate > now) break;
    proposalIds.push(proposalId);
    if (proposalIds.length === MAX_PROPOSAL_BATCH) break;
  }

  if (proposalIds.length === 0) {
    const empty = {
      hasProposalSync: false,
      expectedStartIndex: registeredCount.toString(),
      proposalIds: [],
      reason: "No finalized canonical proposals require synchronization"
    };
    console.log(JSON.stringify(empty, null, 2));
    return;
  }

  const network = await provider.getNetwork();
  const deadline = now + BigInt(deadlineSeconds);
  const proposalIdsHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [proposalIds])
  );
  const domain = {
    name: await staking.name(),
    version: "1",
    chainId: network.chainId,
    verifyingContract: stakingAddress
  };
  const types = {
    ProposalSync: [
      { name: "caller", type: "address" },
      { name: "expectedStartIndex", type: "uint256" },
      { name: "proposalIdsHash", type: "bytes32" },
      { name: "deadline", type: "uint256" }
    ]
  };
  const value = {
    caller,
    expectedStartIndex: registeredCount,
    proposalIdsHash,
    deadline
  };
  const signature = await signer.signTypedData(domain, types, value);

  const payload = {
    hasProposalSync: true,
    signer: signer.address,
    caller,
    domain: {
      ...domain,
      chainId: domain.chainId.toString()
    },
    expectedStartIndex: registeredCount.toString(),
    proposalIds: proposalIds.map((id) => id.toString()),
    proposalIdsHash,
    deadline: deadline.toString(),
    signature,
    supportedAtomicMethods: [
      "stakeWithProposalSync",
      "stakeForWithProposalSync",
      "requestWithdrawalWithProposalSync",
      "claimRewardsWithProposalSync",
      "kickWithProposalSync"
    ]
  };

  const json = JSON.stringify(payload, null, 2);
  const output = process.env.SYNC_PAYLOAD_OUTPUT;
  if (output) fs.writeFileSync(output, `${json}\n`);
  console.log(json);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
