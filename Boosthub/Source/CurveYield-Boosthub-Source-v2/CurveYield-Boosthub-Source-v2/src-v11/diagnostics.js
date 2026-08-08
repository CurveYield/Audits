const REDACTED = "[REDACTED]";
const SECRET_KEY_PATTERN = /(?:private.?key|seed|mnemonic|signature|auth(?:orization)?|bearer|password|secret|api.?key|access.?token|refresh.?token|jwt|credential)/i;
export const DIAGNOSTIC_PAGE_SIZES = Object.freeze([50, 100, 200, 500]);

function redactString(value) {
  let text = String(value ?? "");
  text = text.replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`);
  text = text.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`);
  text = text.replace(/https?:\/\/([^/@\s]+):([^/@\s]+)@/gi, "https://[REDACTED]@[REDACTED_HOST]/");
  text = text.replace(/https?:\/\/[^\s"']+/gi, (url) => {
    try {
      const parsed = new URL(url);
      for (const key of [...parsed.searchParams.keys()]) {
        if (SECRET_KEY_PATTERN.test(key) || /project.?id/i.test(key)) parsed.searchParams.set(key, REDACTED);
      }
      if (/(?:key|token|secret|credential)/i.test(parsed.pathname)) parsed.pathname = "/[REDACTED_PATH]";
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    } catch {
      return REDACTED;
    }
  });
  return text;
}

export function redactDiagnosticValue(value, key = "") {
  if (SECRET_KEY_PATTERN.test(String(key))) return REDACTED;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactDiagnosticValue(childValue, childKey)]));
  }
  if (typeof value === "string") return redactString(value);
  return value;
}

export function redactDiagnosticRecord(record = {}) {
  return redactDiagnosticValue(record);
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function entryHealth(entry) {
  const explicit = normalized(entry?.status);
  if (["healthy", "ok", "live", "success"].includes(explicit)) return "healthy";
  return "problem";
}

export function filterErrorEntries(entries = [], filters = {}) {
  const scope = normalized(filters.scope || "all");
  const chain = normalized(filters.chain || "all");
  const status = normalized(filters.status || "all");
  const contractAddress = normalized(filters.contractAddress || "all");
  const transactionHash = normalized(filters.transactionHash || "");
  const query = normalized(filters.query || "");

  return entries.filter((entry) => {
    if (scope !== "all" && normalized(entry.scope || "unknown") !== scope) return false;
    if (chain !== "all" && normalized(entry.chain || "none") !== chain) return false;
    if (status !== "all" && entryHealth(entry) !== status) return false;
    if (contractAddress !== "all" && normalized(entry.contractAddress) !== contractAddress) return false;
    if (transactionHash && !normalized(entry.transactionHash).includes(transactionHash)) return false;
    if (!query) return true;
    const haystack = [entry.action, entry.message, entry.reason, entry.code, entry.details, entry.lockerId, entry.chain, entry.scope, entry.contractAddress, entry.transactionHash]
      .filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

export function paginateEntries(entries = [], { page = 1, pageSize = 200 } = {}) {
  const size = Number(pageSize);
  if (!DIAGNOSTIC_PAGE_SIZES.includes(size)) throw new RangeError(`Unsupported diagnostic page size: ${pageSize}`);
  const totalItems = entries.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
  const start = (safePage - 1) * size;
  return {
    items: entries.slice(start, start + size),
    page: safePage,
    pageSize: size,
    totalItems,
    totalPages,
  };
}

export function selectVisibleErrors(entries = [], { expanded = false, limit = 12 } = {}) {
  return expanded ? [...entries] : entries.slice(0, Math.max(1, Number(limit) || 12));
}

export function diagnosticExport(entries = [], { generatedAt = Date.now(), maxEntries = 1000, metadata = {} } = {}) {
  const payload = {
    version: 2,
    generatedAt,
    metadata: redactDiagnosticRecord(metadata),
    errors: entries.slice(0, Math.max(1, Number(maxEntries) || 1000)).map(redactDiagnosticRecord),
  };
  return JSON.stringify(payload, null, 2);
}
