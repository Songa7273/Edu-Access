# EduAccess

EduAccess is an Ethereum smart contract prototype for transparent educational
resource access.


## Requirements

- Node.js and npm
- MetaMask or another Ethereum wallet
- Sepolia test ETH
- A Sepolia RPC URL

## Install

```bash
npm install
```

## Compile and test

```bash
npm run compile
npm test
```

## Deploy to Sepolia

Set environment variables in PowerShell:

```powershell
$env:SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_PROJECT_ID"
$env:DEPLOYER_PRIVATE_KEY="YOUR_TEST_PRIVATE_KEY"
npm run deploy:sepolia
```

Save the printed contract address and deployment transaction hash. Never use a
real-wallet private key or commit secrets.
