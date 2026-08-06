"use strict";

const { expect } = require("chai");
const {
  advanceExactly
} = require("../../deployment-v18/simulate-live-deployment-30d-v18.9-fixed");

class CachedLatestBlockProvider {
  constructor() {
    this.block = { number: 100, timestamp: 1_000 };
    this.cachedBlock = null;
    this.nextTimestamp = null;
  }

  async getBlock() {
    if (this.cachedBlock === null) this.cachedBlock = { ...this.block };
    return { ...this.cachedBlock };
  }

  async send(method, params) {
    if (method === "eth_getBlockByNumber") {
      expect(params).to.deep.equal(["latest", false]);
      return {
        number: `0x${this.block.number.toString(16)}`,
        timestamp: `0x${this.block.timestamp.toString(16)}`
      };
    }
    if (method === "evm_setNextBlockTimestamp") {
      this.nextTimestamp = Number(params[0]);
      return null;
    }
    if (method === "evm_mine") {
      this.block = {
        number: this.block.number + 1,
        timestamp: this.nextTimestamp
      };
      return "0x0";
    }
    throw new Error(`unexpected provider method ${method}`);
  }
}

describe("V18.9 live simulation time advance", function () {
  it("reads a fresh latest block for consecutive exact Anvil advances", async function () {
    expect(advanceExactly).to.be.a("function");

    const provider = new CachedLatestBlockProvider();
    const first = await advanceExactly(provider, 604_800);
    const second = await advanceExactly(provider, 604_800);

    expect(first).to.deep.equal({
      before: { number: 100, timestamp: 1_000 },
      after: { number: 101, timestamp: 605_800 },
      elapsedSeconds: 604_800
    });
    expect(second).to.deep.equal({
      before: { number: 101, timestamp: 605_800 },
      after: { number: 102, timestamp: 1_210_600 },
      elapsedSeconds: 604_800
    });
  });
});
