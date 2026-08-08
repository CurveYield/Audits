export function createRpcHealth(urls = [], maxFailures = 4, rotateAfterSuccesses = 5) {
  const unique = [...new Set(urls.filter(Boolean))];
  const records = new Map(unique.map((url) => [url, {
    url,
    consecutiveFailures: 0,
    retired: false,
    lastError: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    successfulGroups: 0,
    lastLatencyMs: null,
    retirementReason: null,
  }]));
  let activeIndex = 0;
  let activeSuccesses = 0;

  function status(url) {
    return records.get(url) || null;
  }

  function available() {
    return unique.filter((url) => !records.get(url).retired);
  }

  function current() {
    const healthy = available();
    if (!healthy.length) return null;
    const activeUrl = unique[activeIndex];
    if (activeUrl && !records.get(activeUrl).retired) return activeUrl;
    const next = healthy[0];
    activeIndex = unique.indexOf(next);
    activeSuccesses = 0;
    return next;
  }

  function advance(fromUrl = current()) {
    const healthy = available();
    if (healthy.length <= 1) {
      activeIndex = fromUrl ? unique.indexOf(fromUrl) : 0;
      activeSuccesses = 0;
      return current();
    }
    const fromIndex = Math.max(0, unique.indexOf(fromUrl));
    for (let offset = 1; offset <= unique.length; offset += 1) {
      const candidateIndex = (fromIndex + offset) % unique.length;
      const candidate = unique[candidateIndex];
      if (!records.get(candidate).retired) {
        activeIndex = candidateIndex;
        activeSuccesses = 0;
        return candidate;
      }
    }
    return current();
  }

  function order() {
    const start = current();
    if (!start) return [];
    const startIndex = unique.indexOf(start);
    return Array.from({ length: unique.length }, (_value, offset) => unique[(startIndex + offset) % unique.length])
      .filter((url) => !records.get(url).retired);
  }

  function recordFailure(url, error = null) {
    const record = records.get(url);
    if (!record || record.retired) return record;
    record.consecutiveFailures += 1;
    record.lastFailureAt = Date.now();
    record.lastError = error ? String(error.shortMessage || error.message || error) : "RPC request failed";
    if (record.consecutiveFailures >= maxFailures) {
      record.retired = true;
      record.retirementReason = record.lastError;
      if (current() === url || unique[activeIndex] === url) advance(url);
    }
    return record;
  }

  function recordSuccess(url, latencyMs = null) {
    const record = records.get(url);
    if (!record || record.retired) return record;
    record.consecutiveFailures = 0;
    record.lastSuccessAt = Date.now();
    record.lastError = null;
    record.retirementReason = null;
    if (Number.isFinite(Number(latencyMs))) record.lastLatencyMs = Math.max(0, Math.round(Number(latencyMs)));
    record.successfulGroups += 1;
    if (url !== current()) {
      activeIndex = unique.indexOf(url);
      activeSuccesses = 0;
    }
    activeSuccesses += 1;
    if (activeSuccesses >= rotateAfterSuccesses) advance(url);
    return record;
  }

  function reset(url = null) {
    const targets = url ? [url] : unique;
    for (const target of targets) {
      const record = records.get(target);
      if (!record) continue;
      record.consecutiveFailures = 0;
      record.retired = false;
      record.lastError = null;
      record.lastFailureAt = null;
      record.lastSuccessAt = null;
      record.lastLatencyMs = null;
      record.retirementReason = null;
    }
    if (!url) {
      activeIndex = 0;
      activeSuccesses = 0;
    } else if (records.has(url)) {
      activeIndex = unique.indexOf(url);
      activeSuccesses = 0;
    }
    return rotationStatus();
  }

  function rotationStatus() {
    const activeUrl = current();
    const healthy = available();
    const currentHealthyIndex = Math.max(0, healthy.indexOf(activeUrl));
    return {
      activeUrl,
      nextUrl: healthy.length > 1 ? healthy[(currentHealthyIndex + 1) % healthy.length] : activeUrl,
      successfulGroups: activeSuccesses,
      rotateAfterSuccesses,
      successesUntilRotation: Math.max(0, rotateAfterSuccesses - activeSuccesses),
    };
  }

  return {
    available,
    all: () => unique.map((url) => ({ ...records.get(url), active: current() === url })),
    status,
    current,
    order,
    advance,
    recordFailure,
    recordSuccess,
    rotationStatus,
    reset,
    maxFailures,
    rotateAfterSuccesses,
  };
}
