"use strict";

const { expect } = require("chai");

describe("V18.9 fixed handoff state-file propagation", function () {
  const modulePath = require.resolve("../../deployment-v18/propose-handoff-v18.9-fixed");
  const libPath = require.resolve("../../deployment-v18/lib-v18");
  const verifyPath = require.resolve("../../deployment-v18/verify-deployment-v18");
  const originalEntries = new Map();

  beforeEach(function () {
    for (const key of [modulePath, libPath, verifyPath]) {
      originalEntries.set(key, require.cache[key]);
      delete require.cache[key];
    }
  });

  afterEach(function () {
    for (const key of [modulePath, libPath, verifyPath]) {
      delete require.cache[key];
      const original = originalEntries.get(key);
      if (original) require.cache[key] = original;
    }
    originalEntries.clear();
  });

  it("passes the exact deployment state file into the handoff context", async function () {
    const finalOwner = "0x0000000000000000000000000000000000000001";
    const finalAdmin = "0x0000000000000000000000000000000000000002";
    const deployer = "0x0000000000000000000000000000000000000003";
    const stateFile = "/tmp/curve-yield-explicit-state.json";
    let contextOptions;

    require.cache[libPath] = {
      id: libPath,
      filename: libPath,
      loaded: true,
      exports: {
        makeContext: async options => {
          contextOptions = options;
          return {
            config: { finalOwner, finalAdmin },
            wallet: { address: deployer },
            state: { phase: "configured", transactions: [] },
            stateFile
          };
        },
        contract: () => ({ admin: async () => finalAdmin }),
        send: async () => {},
        OWNABLE_CONTRACTS: [],
        saveState: () => {}
      }
    };
    require.cache[verifyPath] = {
      id: verifyPath,
      filename: verifyPath,
      loaded: true,
      exports: { verifyDeployment: async () => {} }
    };

    const { proposeHandoff } = require(modulePath);
    await proposeHandoff({
      configPath: "config-mainnet-v18.json",
      rpcUrl: "http://127.0.0.1:8545",
      privateKey: "test-key",
      tag: "test-tag",
      confirmations: 1,
      stateFile,
      simulation: true
    });

    expect(contextOptions.stateFile).to.equal(stateFile);
  });
});
