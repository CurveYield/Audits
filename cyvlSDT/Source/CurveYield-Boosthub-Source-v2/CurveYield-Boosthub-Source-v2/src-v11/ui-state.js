const TARGETS = ["staking", "vault"];

export function createLockerActionState(lockers = []) {
  return Object.fromEntries(lockers.map((locker) => [locker.id, Object.fromEntries(TARGETS.map((target) => [target, { mode: "deposit", input: "" }]))]));
}

export function getLockerActionState(state, lockerId, target) {
  const lockerState = state?.[lockerId] || {};
  return lockerState[target] || { mode: "deposit", input: "" };
}

export function updateLockerActionState(state, lockerId, target, patch = {}) {
  if (!state[lockerId]) state[lockerId] = {};
  state[lockerId][target] = { ...getLockerActionState(state, lockerId, target), ...patch };
  return state[lockerId][target];
}

export function resolveRoute(hashValue, lockers = []) {
  const hash = String(hashValue || "").replace(/^#\/?/, "");
  const known = new Set(lockers.map((locker) => locker.id));
  if (!hash) return { page: "overview", redirect: false };
  if (hash === "admin") return { page: "admin", redirect: false };
  if (hash.startsWith("locker/")) {
    const id = hash.split("/")[1] || "";
    if (known.has(id)) return { page: "locker", id, redirect: false };
  }
  return { page: "overview", redirect: true };
}
