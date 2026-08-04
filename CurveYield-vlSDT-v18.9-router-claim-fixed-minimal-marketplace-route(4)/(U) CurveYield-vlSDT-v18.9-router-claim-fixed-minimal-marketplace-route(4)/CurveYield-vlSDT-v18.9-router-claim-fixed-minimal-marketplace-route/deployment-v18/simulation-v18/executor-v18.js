"use strict";

const { ethers } = require("../lib-v18");

const BUILTIN_ERRORS = new ethers.Interface([
  "error Error(string)",
  "error Panic(uint256)"
]);

function serializable(value) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return ethers.hexlify(value);
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === "object") {
    if (typeof value.toJSON === "function") return serializable(value.toJSON());
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!/^\d+$/.test(key)) result[key] = serializable(entry);
    }
    return result;
  }
  return value;
}

function errorData(error) {
  const candidates = [
    error && error.data,
    error && error.error && error.error.data,
    error && error.info && error.info.error && error.info.error.data,
    error && error.receipt && error.receipt.revertReason
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.startsWith("0x")) return candidate;
    if (candidate && typeof candidate.data === "string") return candidate.data;
  }
  return null;
}

function formatParsedError(parsed) {
  const args = [...parsed.args].map(value => {
    if (typeof value === "bigint") return value.toString();
    return String(value);
  });
  return `${parsed.name}(${args.join(",")})`;
}

function decodeRevert(error, contractInterface) {
  const data = errorData(error);
  let parsed = null;
  if (data) {
    for (const iface of [contractInterface, BUILTIN_ERRORS]) {
      if (!iface) continue;
      try {
        parsed = iface.parseError(data);
        if (parsed) break;
      } catch (_) {
        // Try the next interface.
      }
    }
  }
  return {
    message: error && (error.shortMessage || error.reason || error.message)
      ? String(error.shortMessage || error.reason || error.message)
      : "unknown revert",
    code: error && error.code ? String(error.code) : null,
    data,
    decoded: parsed ? formatParsedError(parsed) : null
  };
}

function serializeExecutionError(error, contractInterface = null) {
  const decoded = decodeRevert(
    error,
    contractInterface || (error && error.simulationContractInterface)
  );
  const rpcError = error && (
    (error.info && error.info.error)
    || error.error
  );
  return {
    ...decoded,
    stage: error && error.simulationStage ? String(error.simulationStage) : null,
    rpcCode: rpcError && rpcError.code !== undefined ? rpcError.code : null,
    rpcMessage: rpcError && rpcError.message ? String(rpcError.message) : null
  };
}

async function blockContext(provider) {
  if (!provider) return {};
  try {
    const block = await provider.getBlock("latest");
    return {
      localBlock: block.number,
      timestamp: block.timestamp
    };
  } catch (_) {
    return {};
  }
}

async function traceFailure(provider, transactionHash) {
  if (!provider || !transactionHash) return null;
  try {
    const trace = await provider.send("debug_traceTransaction", [
      transactionHash,
      { disableMemory: true, disableStorage: true, disableStack: false }
    ]);
    return {
      failed: Boolean(trace.failed),
      gas: trace.gas === undefined ? null : String(trace.gas),
      returnValue: trace.returnValue || null,
      structLogCount: Array.isArray(trace.structLogs) ? trace.structLogs.length : null,
      lastOp: Array.isArray(trace.structLogs) && trace.structLogs.length
        ? trace.structLogs[trace.structLogs.length - 1].op
        : null
    };
  } catch (error) {
    return { unavailable: String(error.shortMessage || error.message || error) };
  }
}

class CallExecutor {
  constructor({ provider = null, ledger }) {
    this.provider = provider;
    this.ledger = ledger;
  }

  async execute({
    id,
    expected,
    operation,
    contractInterface = null,
    caller = null,
    args = [],
    scenario = "direct-call",
    context = null
  }) {
    const executionContext = context || await blockContext(this.provider);
    const base = {
      scenario,
      expected,
      caller,
      args: serializable(args),
      ...executionContext
    };
    try {
      const result = await operation();
      let receipt = null;
      let value = result;
      if (result && typeof result.wait === "function") {
        receipt = await result.wait();
        value = null;
      }
      const status = expected === "revert"
        ? "failed-unexpected-success"
        : "passed-success";
      return this.ledger.record(id, {
        ...base,
        status,
        returnValue: serializable(value),
        transactionHash: receipt ? receipt.hash : null,
        gasUsed: receipt && receipt.gasUsed !== undefined ? receipt.gasUsed.toString() : null
      });
    } catch (error) {
      const decoded = decodeRevert(error, contractInterface);
      const transactionHash = error && (
        error.transactionHash
        || (error.receipt && error.receipt.hash)
        || (error.transaction && error.transaction.hash)
      );
      const status = expected === "revert" || expected === "success-or-revert"
        ? "passed-expected-revert"
        : "failed-unexpected-revert";
      return this.ledger.record(id, {
        ...base,
        status,
        error: decoded,
        transactionHash: transactionHash || null,
        trace: await traceFailure(this.provider, transactionHash)
      });
    }
  }
}

module.exports = {
  serializable,
  errorData,
  decodeRevert,
  serializeExecutionError,
  blockContext,
  traceFailure,
  CallExecutor
};
