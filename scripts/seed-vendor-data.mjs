// Seed test vendor data into T3N maps
// Usage: T3N_API_KEY=0x... node scripts/seed-vendor-data.mjs [supplierDID]

const SUPPLIER_DID = process.argv[2] || "did:t3n:02153a2434e7972d33573f024aedfc530c76a3a3"

const {
  T3nClient, TenantClient, setEnvironment,
  loadWasmComponent, createEthAuthInput, eth_get_address,
  metamask_sign, getNodeUrl,
} = await import("@terminal3/t3n-sdk")

async function main() {
  const apiKey = process.env.T3N_API_KEY
  if (!apiKey) throw new Error("T3N_API_KEY not set")

  setEnvironment(process.env.T3N_ENVIRONMENT || "testnet")

  const wasmComponent = await loadWasmComponent()
  const address = eth_get_address(apiKey)

  const t3n = new T3nClient({
    wasmComponent,
    handlers: { EthSign: metamask_sign(address, undefined, apiKey) },
  })

  await t3n.handshake()
  const did = await t3n.authenticate(createEthAuthInput(address))
  const tenantDid = did.value
  console.log("Authenticated as:", tenantDid)

  const tenant = new TenantClient({ t3n, baseUrl: getNodeUrl(), tenantDid })

  // Seed supplier credentials
  const supplierProfile = {
    company_name: "PT Supplier Example",
    tax_id: "12.345.678.9-012.345",
    compliance_status: "compliant",
    verified_at: "2026-06-01T00:00:00Z",
    director_name: "John Doe",
    registration_number: "AHU-1234567",
  }

  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("supplier-creds"),
    key: SUPPLIER_DID,
    value: JSON.stringify(supplierProfile),
  })
  console.log(`Seeded supplier credentials for ${SUPPLIER_DID}`)

  // Seed public status
  await tenant.executeControl("map-entry-set", {
    map_name: tenant.canonicalName("public-ofac-list"),
    key: "sanctioned_addresses",
    value: JSON.stringify([
      "did:t3n:badc0ffee00000000000000000000000000000000",
      "did:t3n:deadbeef000000000000000000000000000000001",
    ]),
  })
  console.log("Updated OFAC list with test addresses")
}

main().catch(console.error)
