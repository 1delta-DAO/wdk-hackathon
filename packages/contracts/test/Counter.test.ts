import { expect } from "chai";
import hre from "hardhat";

describe("Counter", function () {
  it("should increment", async function () {
    const counter = await hre.ethers.deployContract("Counter");

    await counter.setNumber(0);
    await counter.increment();

    expect(await counter.number()).to.equal(1n);
  });

  it("should set number", async function () {
    const counter = await hre.ethers.deployContract("Counter");

    await counter.setNumber(42);

    expect(await counter.number()).to.equal(42n);
  });
});
