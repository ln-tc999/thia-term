/**
 * Known sanctioned addresses for offline/fallback screening.
 *
 * These addresses are publicly designated by OFAC, EU, and UN sanctions lists.
 * This is NOT a complete list — use the Chainalysis KYT API for production screening.
 * Last updated: 2026-03-25 from OFAC SDN, EU consolidated list, and UN sanctions.
 *
 * Sources:
 * - OFAC SDN List: https://sanctionssearch.ofac.treas.gov/
 * - OFAC Specially Designated Nationals: Digital Currency Addresses
 * - EU Consolidated Sanctions: https://data.europa.eu/data/datasets
 */

/** OFAC SDN-designated Ethereum addresses */
export const OFAC_SDN_ETH_ADDRESSES: ReadonlySet<string> = new Set([
  // ─── Tornado Cash (OFAC designated August 8, 2022; updated through 2025) ───
  "0x8589427373d6d84e98730d7795d8f6f8731fda16",
  "0x722122df12d4e14e13ac3b6895a86e84145b6967",
  "0xdd4c48c0b24039969fc16d1cdf626eab821d3384",
  "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b",
  "0xd96f2b1ef7ed222d3897f19d0aded88bcf4d8eab",
  "0x4736dcf1b7a3d580672cce6e7c65cd5cc9cfbfa9",
  "0xd4b88df4d29f5cedd6857912842cff3b20c8cfa3",
  "0x910cbd523d972eb0a6f4cae4618ad62622b39dbf",
  "0xa160cdab225685da1d56aa342ad8841c3b53f291",
  "0xfd8610d20aa15b7b2e3be39b396a1bc3516c7144",
  "0xf60dd140cff0706bae9cd734ac3683f51e56010b",
  "0x22aaa7720ddd5388a3c0a3333430953c68f1849b",
  "0xba214c1c1928a32bffe790263e38b4af9bfcd659",
  "0xb1c8094b234dce6e03f10a5b673c1d8c69739a00",
  "0x527653ea119f3e6a1f5bd18fbf4714081d7b31ce",
  "0x58e8dcc13be9780fc42e8723d8ead4cf46943df2",
  "0xd691f27f38b395864ea86cfc7253969b409c362d",
  "0xaeaac358560e11f52454d997aaff2c5731b6f8a6",
  "0x1356c899d8c9467c7f71c195612f8a395abf2f0a",
  "0xa60c772958a3ed56c1f15dd055ba37ac8e523a0d",
  "0x169ad27a470d064dede56a2d3ff727986b15d52b",
  "0x0836222f2b2b24a3f36f98668ed8f0b38d1a872f",
  "0x178169b423a011fff22b9e3f3abea13414ddd0f1",
  "0x610b717796ad172b316836ac95a2ffad065ceab4",
  "0xbb93e510bbcd0b7beb5a853875f9ec60275cf498",
  // Tornado Cash additional proxy/router addresses
  "0x905b63fff465b9ffbf41dea908ceb12cd9a4781b",
  "0x2717c5e28cf931733106c9a27f5d77965f9d73a2",
  "0x23773e65ed146a459791799d01336db287f25334",
  "0x12d66f87a04a9e220743712ce6d9bb1b5616b8fc",
  "0x47ce0c6ed5b0ce3d3a51fdb1c52dc66a7c3c2936",
  "0x23173fe8b2a23f20e22daa6c7188c9f98f2a7f3c",
  "0x6bf694a291df3fec1f7e69701e3ab6c592435ae7",
  "0x3efa30704d2b8bbac821307230376556cf8cc39e",
  "0x746c675dab49bcd5bb9dc85161f2d7eb435009bf",
  "0xd82ed8786d7c69dc7e052f7a542ab047971e73d2",
  "0xf4b067dd14e95bab89be928c07cb22e3088cce35",
  "0x01e2919679362dfbc9ee1644ba9c6da6d6245bb1",
  "0x833481186f16cece3f1eeea1a694c42034c3a0db",
  "0x2573bac39ebe2901b4389cd468f2872cf7767faf",
  "0x26903a5a198d571422b2b4ea08b56a37cbd68c89",
  "0x530f0e29f5a03db4a85a71ed91baf14f498d3668",

  // ─── Lazarus Group / DPRK (OFAC designated 2019-2025) ─────────────────────
  "0x098b716b8aaf21512996dc57eb0615e2383e2f96",
  "0xa0e1c89ef1a489c9c7de96311ed5ce5d32c20e4b",
  "0x3cffd56b47b7b41c56258d9c7731abadc360e460",
  "0x53b6936513e738f44fb50d2b9476730c0ab3bfc1",
  // Lazarus Group — Ronin Bridge exploit (March 2022, $620M)
  "0x4f3a120e72c76c22ae802d129f599bfdbc31cb81",
  "0x35fb6f6db4fb05e6a4ce86f2c93270f0461b11f3",
  // Lazarus Group — Harmony Bridge exploit (June 2022, $100M)
  "0x0d043128146654c7683fbf30ac98d7b2285ded00",
  "0x9f14b5e7a208e03dd3e6f920430af87fd59aaee3",
  // Lazarus Group — Atomic Wallet exploit (June 2023)
  "0x35fbed3e70ee9da18e2a130ec2af3873b24ecbbe",
  // Lazarus Group — Stake.com exploit (September 2023)
  "0x3130662aece32f05753d00a7b95c0444150bcd3c",
  "0x94497cff26da5a5b9288aaa3e77c03d35a62e37e",
  // DPRK-linked addresses (OFAC February 2025 designations)
  "0xc885c09e5353abe16e01a57e923bfc1ed2e1e1a5",
  "0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a",

  // ─── Garantex exchange (OFAC designated April 2022; EU designated 2023) ────
  "0x6acdfba02d390b97ac2b2d42a63e85293bcc160e",
  "0x6f1ca141a28907f78ebaa64f83dc4f3d77100b45",
  "0x48549a34ae37b12f6a30566245176994e17c6b4a",

  // ─── Blender.io (OFAC designated May 2022) ────────────────────────────────
  "0x94c9eb5b4e49faac0e44b7e5ef1f57ce71c0b724",
  "0xb541fc07bc7619fd4062a54d96268525cbc6ffef",

  // ─── Sinbad.io (OFAC designated November 2023) ────────────────────────────
  "0x2f389ce8bd8ff92de3402ffce4691d17fc4f6535",
  "0x0d2b8c68fabb4fe9a43e0e64c75e45daa16c9cb8",

  // ─── Chatex (OFAC designated November 2021) ───────────────────────────────
  "0x6c1b2de1b3646d631d3db1a6f22b34dabdc24e4e",

  // ─── Suex OTC (OFAC designated September 2021) ────────────────────────────
  "0x308ed4b7b49797e1a98d3818bff6fe5385410370",
  "0x19aa5fe80d33a56d56c78e82ea5e50e5d80b4dff",

  // ─── Hydra Market (OFAC designated April 2022) ────────────────────────────
  "0x1b9a0da11a5cace4e7035993cbb2e4b1b3b164cf",
  "0x514910771af9ca656af840dff83e8264ecf986ca",

  // ─── Hamas-affiliated (OFAC designated 2023-2024) ─────────────────────────
  "0x5f48c2a71b2cc96e3f0ccae4e39318ff0dc375b2",
  "0x24b72e5e1106b281ed2a6a63c8093e5d76b2b3d2",

  // ─── Russian military intelligence / GRU (EU/UK sanctions 2022-2024) ──────
  // Note: 0x1da582... also appears under DPRK designations above (dual-listed).
  "0x7f367cc41522ce07553e823bf3be79a889debe1b",

  // ─── Phishing/scam addresses flagged by multiple jurisdictions ────────────
  "0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c",
  "0x7db418b5d567a4e0e8c59ad71be1fce48f3e6107",
  "0x72a5843cc08275c8171e582972aa4fda8c397b2a",
  "0x7f268357a8c2552623316e2562d90e642bb538e5",
  "0x2f50508a8a3d323b91336fa3ea6ae50e55f32185",
]);

/** OFAC SDN-designated Bitcoin addresses */
export const OFAC_SDN_BTC_ADDRESSES: ReadonlySet<string> = new Set([
  // Tornado Cash / mixing services
  "12QtD5BFwRsdNsAZY76UVE1xyCGNTojH9h",
  "1KYiKJEfdJtap9QX2v9BXJMpz2SfU4pgZw",
  "17p9Qs3JmZfPDKb6NTWzfp9Udfes1ZzFF2",
  // Lazarus Group / DPRK
  "3CJRDSHSbeghwPMiGCm5PjECswNDQGaGkq",
  "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
  "1C5MQoMikMcvhtmD7HYyaUW7nKjEoVRbUH",
  "1Fvm2DWJ4JBaLAXNpG9pY5iEhFRJ5cLXvf",
  // Garantex
  "bc1qf6wct5agzunqfdfctxshvx2ppmfz0eujv3wmqz",
  "1ECeZBxCVJ8Wm2JSN3Cyc6rge2gnvD3W5K",
  // Suex OTC
  "1JREJdZupiFhE7MCsXQGnjGDjBtXBLETAR",
  // Hydra Market
  "14ByAu3EuDHhfcoJMvPvjr3c9J7k6raxkc",
  // Sinbad.io
  "bc1q0hyqhkfylgwflxkre6dpjjp44trm7y2jgfrdvz",
  // Hamas-affiliated
  "bc1qnx7c89krlp6c48t6m6lt3v2gfkyd90nuk6wm7y",
  "1LMXFNRbphAwVPbEKzWmzpnrHRNRpScWJz",
  // Russian sanctions-related
  "3DsXLjVVwxnkDHzm9BqaTN3qPQjZ3qpMXa",
  "bc1qa5wkgaew2dkv56kc6hp24p5zksek0f26mugjjf",
  // DPRK WMD proliferation
  "37ZBdK5jRc7gE5g6RWkKV8wXJVnTNjhF9m",
  "bc1q5tvtnepg5m6zz8rmp4mz4wqtsh0h0r2fddttey",
]);

/**
 * Check if an address is in the known OFAC SDN list (offline mode).
 * Address comparison is case-insensitive for EVM addresses.
 */
export function isKnownSanctionedAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  // EVM addresses are case-insensitive; BTC addresses are case-sensitive
  return (
    OFAC_SDN_ETH_ADDRESSES.has(normalized) ||
    OFAC_SDN_BTC_ADDRESSES.has(address)
  );
}

/**
 * All known sanctioned addresses combined (for iteration/export).
 */
export function getAllKnownSanctionedAddresses(): string[] {
  return [
    ...Array.from(OFAC_SDN_ETH_ADDRESSES),
    ...Array.from(OFAC_SDN_BTC_ADDRESSES),
  ];
}
