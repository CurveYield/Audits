function text(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value?.message === "string") return value.message;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function normalizeAppError(error, context = {}) {
  const timestamp = Number(context.timestamp || Date.now());
  const action = context.action || "unknown";
  const lockerId = context.lockerId || null;
  const message = error?.shortMessage || error?.reason || error?.message || context.message || "Unknown error";
  return {
    id: `${timestamp}-${action}-${lockerId || "global"}`,
    timestamp,
    action,
    lockerId,
    chain: context.chain || null,
    scope: context.scope || (String(action).includes("refresh") || String(action).includes("read") ? "data" : "transaction"),
    status: context.status || "problem",
    contractAddress: text(context.contractAddress),
    message: String(message),
    reason: text(error?.reason),
    code: text(error?.code),
    transactionHash: text(error?.transactionHash || error?.receipt?.hash || error?.transaction?.hash),
    details: text(error?.data?.message || error?.info?.error?.message || error?.data || context.details),
  };
}

function sameErrorFingerprint(left, right) {
  if (!left?.action || !left?.message || !right?.action || !right?.message) return false;
  return left.action === right.action
    && left.lockerId === right.lockerId
    && left.chain === right.chain
    && left.scope === right.scope
    && left.message === right.message
    && left.code === right.code
    && left.reason === right.reason;
}

export function appendErrorLog(entries = [], entry, maxEntries = 1000, maxOccurrences = 20) {
  const duplicate = entries.find((item) => sameErrorFingerprint(item, entry));
  const currentTimestamp = Number(entry.timestamp || Date.now());
  const previousOccurrences = duplicate?.occurrences?.length
    ? duplicate.occurrences
    : duplicate
      ? [Number(duplicate.lastTimestamp || duplicate.timestamp || currentTimestamp)]
      : [];
  const occurrences = [currentTimestamp, ...previousOccurrences.filter((timestamp) => Number(timestamp) !== currentTimestamp)]
    .slice(0, Math.max(1, Number(maxOccurrences) || 20));
  const next = duplicate
    ? {
        ...duplicate,
        ...entry,
        id: duplicate.id,
        count: Number(duplicate.count || 1) + 1,
        firstTimestamp: Number(duplicate.firstTimestamp || duplicate.timestamp || currentTimestamp),
        lastTimestamp: currentTimestamp,
        timestamp: currentTimestamp,
        occurrences,
      }
    : {
        ...entry,
        count: Number(entry.count || 1),
        firstTimestamp: currentTimestamp,
        lastTimestamp: currentTimestamp,
        occurrences,
      };
  return [next, ...entries.filter((item) => item.id !== entry.id && !sameErrorFingerprint(item, entry))].slice(0, maxEntries);
}
