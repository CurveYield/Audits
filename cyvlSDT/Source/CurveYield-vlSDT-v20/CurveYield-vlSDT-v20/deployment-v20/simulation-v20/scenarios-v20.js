"use strict";

const { ethers } = require("../lib-v20");

function arrayType(type) {
  const match = type.match(/^(.*)\[([0-9]*)\]$/);
  if (!match) return null;
  return { elementType: match[1], length: match[2] === "" ? null : Number(match[2]) };
}

function synthesizeInput(input, context) {
  const array = arrayType(input.type);
  if (array) {
    if (array.length === null) return [];
    const element = { ...input, type: array.elementType };
    return Array.from({ length: array.length }, () => synthesizeInput(element, context));
  }
  if (input.type === "tuple") {
    return (input.components || []).map(component => synthesizeInput(component, context));
  }
  if (input.type === "address") return context.defaultAddress || ethers.ZeroAddress;
  if (input.type === "bool") return false;
  if (input.type === "string") return "";
  if (input.type === "bytes") return "0x";
  if (/^bytes[0-9]+$/.test(input.type)) {
    const length = Number(input.type.slice(5));
    return `0x${"00".repeat(length)}`;
  }
  if (/^u?int[0-9]*$/.test(input.type)) return 0n;
  if (input.type === "function") return `0x${"00".repeat(24)}`;
  throw new Error(`unsupported ABI input type: ${input.type}`);
}

function synthesizeArguments(inputs, context = {}) {
  return (inputs || []).map(input => synthesizeInput(input, context));
}

function buildScenarioPlan(inventory) {
  return inventory.map(item => ({
    ...item,
    scenario: item.stateMutability === "view" || item.stateMutability === "pure"
      ? "read-probe"
      : "state-probe",
    expected: "success-or-revert"
  }));
}

async function withSnapshot(provider, operation) {
  const snapshot = await provider.send("evm_snapshot", []);
  try {
    return await operation();
  } finally {
    const restored = await provider.send("evm_revert", [snapshot]);
    if (!restored) throw new Error(`failed to restore Anvil snapshot ${snapshot}`);
  }
}

async function runAbiProbes({
  inventory,
  contractsByKey,
  signer,
  defaultAddress,
  executor
}) {
  const plan = buildScenarioPlan(inventory);
  const caller = await signer.getAddress();
  const provider = signer.provider;
  const block = await provider.getBlock("latest");
  const context = {
    localBlock: Number(block.number),
    timestamp: Number(block.timestamp)
  };
  const results = [];
  for (const item of plan) {
    const target = contractsByKey[item.contractKey];
    if (!target) throw new Error(`missing scenario contract: ${item.contractKey}`);
    const args = synthesizeArguments(item.inputs, { defaultAddress });
    const connected = target.connect(signer);
    results.push(await executor.execute({
      id: item.id,
      expected: item.expected,
      contractInterface: connected.interface,
      caller,
      args,
      scenario: item.scenario,
      context,
      operation: async () => connected.getFunction(item.signature).staticCall(...args)
    }));
  }
  return results;
}

module.exports = {
  arrayType,
  synthesizeInput,
  synthesizeArguments,
  buildScenarioPlan,
  withSnapshot,
  runAbiProbes
};
