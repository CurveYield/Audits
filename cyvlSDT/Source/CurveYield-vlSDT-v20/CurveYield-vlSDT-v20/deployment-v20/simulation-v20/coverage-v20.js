"use strict";

const { DEPLOYABLES, loadArtifact } = require("../lib-v20");

const PASS_STATUSES = new Set([
  "passed-success",
  "passed-expected-revert",
  "passed-deployment-configuration"
]);

const FAIL_STATUSES = new Set([
  "failed-unexpected-revert",
  "failed-unexpected-success",
  "failed-assertion",
  "blocked-precondition"
]);

const TERMINAL_STATUSES = new Set([...PASS_STATUSES, ...FAIL_STATUSES]);

function canonicalType(input) {
  if (!input.type.startsWith("tuple")) return input.type;
  const suffix = input.type.slice("tuple".length);
  const components = (input.components || []).map(canonicalType).join(",");
  return `(${components})${suffix}`;
}

function canonicalSignature(fragment) {
  return `${fragment.name}(${(fragment.inputs || []).map(canonicalType).join(",")})`;
}

function buildAbiInventory() {
  const inventory = [];
  for (const [contractKey, contractName] of DEPLOYABLES) {
    const artifact = loadArtifact(contractName);
    for (const fragment of artifact.abi) {
      if (fragment.type !== "function") continue;
      const signature = canonicalSignature(fragment);
      inventory.push({
        id: `${contractKey}:${signature}`,
        contractKey,
        contractName,
        signature,
        stateMutability: fragment.stateMutability,
        inputs: fragment.inputs || [],
        outputs: fragment.outputs || [],
        fragment
      });
    }
  }
  return inventory;
}

class CoverageLedger {
  constructor(inventory) {
    this.inventory = [...inventory];
    this.byId = new Map();
    this.records = new Map();
    for (const item of this.inventory) {
      if (this.byId.has(item.id)) throw new Error(`duplicate ABI inventory id: ${item.id}`);
      this.byId.set(item.id, item);
      this.records.set(item.id, []);
    }
  }

  record(id, result) {
    if (!this.byId.has(id)) throw new Error(`unknown ABI inventory id: ${id}`);
    if (!result || !TERMINAL_STATUSES.has(result.status)) {
      throw new Error(`invalid coverage status for ${id}: ${result && result.status}`);
    }
    const record = {
      contractKey: this.byId.get(id).contractKey,
      signature: this.byId.get(id).signature,
      ...result
    };
    this.records.get(id).push(record);
    return record;
  }

  resultsFor(id) {
    if (!this.byId.has(id)) throw new Error(`unknown ABI inventory id: ${id}`);
    return [...this.records.get(id)];
  }

  missing() {
    return this.inventory.filter(item => this.records.get(item.id).length === 0);
  }

  failures() {
    return [...this.records.values()].flat().filter(record => FAIL_STATUSES.has(record.status));
  }

  assertComplete() {
    const missing = this.missing();
    if (missing.length) {
      throw new Error(`missing ABI coverage: ${missing.map(item => item.id).join(", ")}`);
    }
    return true;
  }

  assertPassing() {
    this.assertComplete();
    const failures = this.failures();
    if (failures.length) {
      throw new Error(`failing ABI coverage: ${failures.map(item => `${item.contractKey}:${item.signature}`).join(", ")}`);
    }
    return true;
  }

  toJSON() {
    return this.inventory.map(item => ({
      ...item,
      fragment: undefined,
      records: this.resultsFor(item.id)
    }));
  }

  summary() {
    const records = [...this.records.values()].flat();
    const statuses = {};
    for (const record of records) statuses[record.status] = (statuses[record.status] || 0) + 1;
    return {
      inventoryCount: this.inventory.length,
      classifiedCount: this.inventory.length - this.missing().length,
      missingCount: this.missing().length,
      failureCount: this.failures().length,
      statuses
    };
  }
}

module.exports = {
  PASS_STATUSES,
  FAIL_STATUSES,
  TERMINAL_STATUSES,
  canonicalType,
  canonicalSignature,
  buildAbiInventory,
  CoverageLedger
};
