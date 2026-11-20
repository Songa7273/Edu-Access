const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying EduAccess with account:", deployer.address);

  const EduAccess = await hre.ethers.getContractFactory("EduAccess");
  const contract = await EduAccess.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("EduAccess deployed to:", address);
  console.log("Network:", hre.network.name);
  console.log("Transaction:", contract.deploymentTransaction().hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
