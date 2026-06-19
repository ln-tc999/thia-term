const { ethers } = require("hardhat")

async function main() {
  console.log("Deploying PolicyGuardV0 contract...")

  // Get the contract factory
  const PolicyGuardV0 = await ethers.getContractFactory("PolicyGuardV0")

  // Deploy the contract
  const policyGuard = await PolicyGuardV0.deploy()
  await policyGuard.deployed()

  console.log("PolicyGuardV0 deployed to:", policyGuard.address)

  // Set up some initial KYC and sanctions data for testing
  console.log("Setting up test compliance data...")

  // Test addresses that pass KYC
  const kycPassAddresses = ["0x1234567890123456789012345678901234567890", "0x0987654321098765432109876543210987654321"]

  // Test addresses that are sanctioned
  const sanctionedAddresses = [
    "0x6666666666666666666666666666666666666666",
    "0x1111111111111111111111111111111111111111",
  ]

  // Set KYC status for test addresses
  for (const address of kycPassAddresses) {
    await policyGuard.setKYCStatus(address, true)
    console.log(`Set KYC verified for ${address}`)
  }

  // Set sanctions status for test addresses
  for (const address of sanctionedAddresses) {
    await policyGuard.setSanctionsStatus(address, true)
    console.log(`Set sanctions blocked for ${address}`)
  }

  console.log("Deployment and setup complete!")

  // Save deployment info
  const deploymentInfo = {
    contractAddress: policyGuard.address,
    network: (await ethers.provider.getNetwork()).name,
    deployedAt: new Date().toISOString(),
    deployer: (await ethers.getSigners())[0].address,
  }

  console.log("Deployment Info:", deploymentInfo)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
