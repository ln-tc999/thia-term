const { ethers } = require("hardhat")

async function main() {
  // Replace with your deployed contract address
  const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3" // Update this

  console.log("Testing PolicyGuardV0 contract...")

  // Get contract instance
  const PolicyGuardV0 = await ethers.getContractFactory("PolicyGuardV0")
  const policyGuard = PolicyGuardV0.attach(contractAddress)

  // Get signers
  const [owner, merchant, payer] = await ethers.getSigners()

  console.log("Owner:", owner.address)
  console.log("Merchant:", merchant.address)
  console.log("Payer:", payer.address)

  // Test 1: Create a payment policy
  console.log("\n--- Test 1: Creating Payment Policy ---")

  const linkId = ethers.utils.formatBytes32String("test-link-1")
  const mockUSDCAddress = "0x1234567890123456789012345678901234567890" // Mock USDC address

  const policy = {
    requireKYC: true,
    checkSanctions: true,
    merchant: merchant.address,
    token: mockUSDCAddress,
    amount: ethers.utils.parseUnits("100", 6), // 100 USDC (6 decimals)
    active: true,
  }

  const tx1 = await policyGuard.connect(merchant).setPolicy(linkId, policy)
  await tx1.wait()
  console.log("Policy created for link:", ethers.utils.parseBytes32String(linkId))

  // Test 2: Check policy details
  console.log("\n--- Test 2: Checking Policy Details ---")
  const storedPolicy = await policyGuard.getPolicy(linkId)
  console.log("Stored policy:", {
    requireKYC: storedPolicy.requireKYC,
    checkSanctions: storedPolicy.checkSanctions,
    merchant: storedPolicy.merchant,
    token: storedPolicy.token,
    amount: ethers.utils.formatUnits(storedPolicy.amount, 6),
    active: storedPolicy.active,
  })

  // Test 3: Check if payer can pay (should fail - no KYC)
  console.log("\n--- Test 3: Checking Payment Eligibility (No KYC) ---")
  const [canPayBefore, reasonBefore] = await policyGuard.canPay(linkId, payer.address)
  console.log("Can pay before KYC:", canPayBefore, "Reason:", reasonBefore)

  // Test 4: Set KYC status for payer
  console.log("\n--- Test 4: Setting KYC Status ---")
  const tx2 = await policyGuard.setKYCStatus(payer.address, true)
  await tx2.wait()
  console.log("KYC status set for payer")

  // Test 5: Check if payer can pay (should succeed)
  console.log("\n--- Test 5: Checking Payment Eligibility (With KYC) ---")
  const [canPayAfter, reasonAfter] = await policyGuard.canPay(linkId, payer.address)
  console.log("Can pay after KYC:", canPayAfter, "Reason:", reasonAfter)

  // Test 6: Test sanctions blocking
  console.log("\n--- Test 6: Testing Sanctions Blocking ---")
  const tx3 = await policyGuard.setSanctionsStatus(payer.address, true)
  await tx3.wait()
  console.log("Sanctions status set for payer")

  const [canPaySanctioned, reasonSanctioned] = await policyGuard.canPay(linkId, payer.address)
  console.log("Can pay when sanctioned:", canPaySanctioned, "Reason:", reasonSanctioned)

  // Test 7: Remove sanctions and test deactivation
  console.log("\n--- Test 7: Testing Link Deactivation ---")
  const tx4 = await policyGuard.setSanctionsStatus(payer.address, false)
  await tx4.wait()

  const tx5 = await policyGuard.connect(merchant).deactivateLink(linkId)
  await tx5.wait()
  console.log("Link deactivated by merchant")

  const [canPayDeactivated, reasonDeactivated] = await policyGuard.canPay(linkId, payer.address)
  console.log("Can pay when deactivated:", canPayDeactivated, "Reason:", reasonDeactivated)

  console.log("\n--- Contract Testing Complete ---")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
