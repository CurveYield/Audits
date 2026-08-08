const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function vaultAddressFor(locker) {
  const address = String(locker?.vaultAddress || "");
  if (!ADDRESS_RE.test(address)) throw new Error(`Invalid vault address for ${locker?.id || "locker"}`);
  return address;
}

export function vaultOperationTargets(locker) {
  const address = vaultAddressFor(locker);
  return {
    allowanceSpender: address,
    depositContract: address,
    withdrawContract: address,
    balanceContract: address,
    ppsContract: address,
    apyContract: address,
    strategyLookupContract: address,
  };
}
