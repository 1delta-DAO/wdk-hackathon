import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-foundry";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.34",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "src",
    tests: "test",
    cache: "cache",
    artifacts: "artifacts",
  },
};

export default config;
