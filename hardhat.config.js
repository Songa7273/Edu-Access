require("@nomicfoundation/hardhat-toolbox");

const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL || "";
const privateKey = process.env.DEPLOYER_PRIVATE_KEY || "";

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    sepolia: {
      url: sepoliaRpcUrl,
      accounts: privateKey ? [privateKey] : []
    }
  }
};
