// ---------------------------------------------------------------------------
// Cross-Protocol Permission Translator (Gap 13)
//
// Normalizes incompatible permission models from 6 payment protocols into a
// unified ProofLink format. Complements protocol-adapter.ts — the adapter
// decides WHICH compliance checks to run, this translator normalizes HOW
// permissions are expressed across protocols.
//
// Supported protocols:
//   x402  — EIP-3009 transferWithAuthorization
//   AP2   — Cryptographic mandates (intent/cart/payment)
//   MPP   — OAuth-style sessions with spending caps
//   ACP   — Shared Payment Tokens (SPT)
//   ERC-7715 — wallet_grantPermissions (session keys)
//   ERC-7710 — Smart contract delegation
//
// All translation functions are pure — no side effects, no DB calls.
// ---------------------------------------------------------------------------

import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Protocol-specific input types
// ---------------------------------------------------------------------------

export interface X402Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
  asset: string;
  chain: string;
}

export type AP2MandateType = "intent" | "cart" | "payment";

export interface AP2Mandate {
  mandateId: string;
  mandateType: AP2MandateType;
  issuer: string;
  subject: string;
  maxAmount: string;
  allowedAssets: string[];
  allowedChains: string[];
  expiresAt: number;
  revocable: boolean;
  signature: string;
}

export interface MPPSession {
  sessionId: string;
  grantedTo: string;
  grantedBy: string;
  spendingCapUsd: number;
  spentUsd: number;
  allowedAssets: string[];
  allowedChains: string[];
  expiresAt: number;
  scopes: string[];
}

export interface ACPSharedPaymentToken {
  tokenId: string;
  merchant: string;
  payer: string;
  maxAmountUsd: number;
  allowedAssets: string[];
  allowedChains: string[];
  expiresAt: number;
  checkoutScope: string;
}

export interface ERC7715Permission {
  sessionKey: string;
  granter: string;
  permissions: Array<{
    type: string;
    data: {
      allowedAssets?: string[];
      allowedChains?: string[];
      maxAmount?: string;
      validUntil?: number;
    };
  }>;
  expiresAt: number;
  revocable: boolean;
}

export interface ERC7710Delegation {
  delegator: string;
  delegate: string;
  contractAddress: string;
  allowedMethods: string[];
  maxAmountPerTx: string;
  maxAmountTotal: string;
  allowedAssets: string[];
  allowedChains: string[];
  expiresAt: number;
  revocable: boolean;
}

// ---------------------------------------------------------------------------
// Unified permission format
// ---------------------------------------------------------------------------

export type PermissionProtocol = "x402" | "ap2" | "mpp" | "acp" | "erc7715" | "erc7710";

export interface UnifiedPermission {
  protocol: PermissionProtocol;
  grantedTo: string;
  grantedBy: string;
  maxAmountUsd: number;
  allowedAssets: string[];
  allowedChains: string[];
  expiresAt: number;
  scope: string;
  revocable: boolean;
  originalPermission: unknown;
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface PermissionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Reference prices (reuse from price-guard concept — inline for purity)
// ---------------------------------------------------------------------------

const REFERENCE_PRICES_USD: Record<string, number> = {
  USDC: 1.0,
  USDT: 1.0,
  EURC: 1.08,
  DAI: 1.0,
  ETH: 3500,
  BTC: 87000,
};

function estimateUsd(amount: string, asset: string): number {
  const price = REFERENCE_PRICES_USD[asset.toUpperCase()] ?? 0;
  const parsed = parseFloat(amount);
  if (Number.isNaN(parsed)) return 0;
  return parsed * price;
}

// ---------------------------------------------------------------------------
// Translation: protocol-specific → unified
// ---------------------------------------------------------------------------

export function translateX402Permission(auth: X402Authorization): UnifiedPermission {
  return {
    protocol: "x402",
    grantedTo: auth.to,
    grantedBy: auth.from,
    maxAmountUsd: estimateUsd(auth.value, auth.asset),
    allowedAssets: [auth.asset],
    allowedChains: [auth.chain],
    expiresAt: auth.validBefore,
    scope: "single_transfer",
    revocable: false, // EIP-3009 authorizations are single-use, not revocable
    originalPermission: auth,
  };
}

export function translateAP2Mandate(mandate: AP2Mandate): UnifiedPermission {
  const scopeMap: Record<AP2MandateType, string> = {
    intent: "intent_authorization",
    cart: "cart_authorization",
    payment: "payment_execution",
  };

  return {
    protocol: "ap2",
    grantedTo: mandate.subject,
    grantedBy: mandate.issuer,
    maxAmountUsd: estimateUsd(mandate.maxAmount, mandate.allowedAssets[0] ?? "USDC"),
    allowedAssets: mandate.allowedAssets,
    allowedChains: mandate.allowedChains,
    expiresAt: mandate.expiresAt,
    scope: scopeMap[mandate.mandateType] ?? "unknown",
    revocable: mandate.revocable,
    originalPermission: mandate,
  };
}

export function translateMPPSession(session: MPPSession): UnifiedPermission {
  return {
    protocol: "mpp",
    grantedTo: session.grantedTo,
    grantedBy: session.grantedBy,
    maxAmountUsd: session.spendingCapUsd - session.spentUsd,
    allowedAssets: session.allowedAssets,
    allowedChains: session.allowedChains,
    expiresAt: session.expiresAt,
    scope: session.scopes.join(","),
    revocable: true, // OAuth-style sessions are always revocable
    originalPermission: session,
  };
}

export function translateACPToken(spt: ACPSharedPaymentToken): UnifiedPermission {
  return {
    protocol: "acp",
    grantedTo: spt.merchant,
    grantedBy: spt.payer,
    maxAmountUsd: spt.maxAmountUsd,
    allowedAssets: spt.allowedAssets,
    allowedChains: spt.allowedChains,
    expiresAt: spt.expiresAt,
    scope: spt.checkoutScope,
    revocable: true,
    originalPermission: spt,
  };
}

export function translateERC7715Permission(perm: ERC7715Permission): UnifiedPermission {
  // Merge all permission entries into unified allowed sets
  const allowedAssets = new Set<string>();
  const allowedChains = new Set<string>();
  let maxAmountUsd = 0;
  let latestExpiry = perm.expiresAt;
  const scopes: string[] = [];

  for (const p of perm.permissions) {
    scopes.push(p.type);
    if (p.data.allowedAssets) {
      for (const a of p.data.allowedAssets) allowedAssets.add(a);
    }
    if (p.data.allowedChains) {
      for (const c of p.data.allowedChains) allowedChains.add(c);
    }
    if (p.data.maxAmount) {
      const firstAsset = p.data.allowedAssets?.[0] ?? "USDC";
      maxAmountUsd += estimateUsd(p.data.maxAmount, firstAsset);
    }
    if (p.data.validUntil && p.data.validUntil < latestExpiry) {
      latestExpiry = p.data.validUntil;
    }
  }

  return {
    protocol: "erc7715",
    grantedTo: perm.sessionKey,
    grantedBy: perm.granter,
    maxAmountUsd,
    allowedAssets: [...allowedAssets],
    allowedChains: [...allowedChains],
    expiresAt: latestExpiry,
    scope: scopes.join(","),
    revocable: perm.revocable,
    originalPermission: perm,
  };
}

export function translateERC7710Delegation(delegation: ERC7710Delegation): UnifiedPermission {
  const firstAsset = delegation.allowedAssets[0] ?? "USDC";
  return {
    protocol: "erc7710",
    grantedTo: delegation.delegate,
    grantedBy: delegation.delegator,
    maxAmountUsd: estimateUsd(delegation.maxAmountTotal, firstAsset),
    allowedAssets: delegation.allowedAssets,
    allowedChains: delegation.allowedChains,
    expiresAt: delegation.expiresAt,
    scope: delegation.allowedMethods.join(","),
    revocable: delegation.revocable,
    originalPermission: delegation,
  };
}

// ---------------------------------------------------------------------------
// Reverse translation: unified → protocol-specific
// ---------------------------------------------------------------------------

export function translateToProtocol(
  unified: UnifiedPermission,
  targetProtocol: PermissionProtocol,
): Record<string, unknown> {
  switch (targetProtocol) {
    case "x402":
      return {
        from: unified.grantedBy,
        to: unified.grantedTo,
        value: String(unified.maxAmountUsd),
        validAfter: 0,
        validBefore: unified.expiresAt,
        nonce: "0x0",
        asset: unified.allowedAssets[0] ?? "USDC",
        chain: unified.allowedChains[0] ?? "base",
      };

    case "ap2":
      return {
        mandateId: `mandate_${Date.now()}`,
        mandateType: unified.scope.includes("intent")
          ? "intent"
          : unified.scope.includes("cart")
            ? "cart"
            : "payment",
        issuer: unified.grantedBy,
        subject: unified.grantedTo,
        maxAmount: String(unified.maxAmountUsd),
        allowedAssets: unified.allowedAssets,
        allowedChains: unified.allowedChains,
        expiresAt: unified.expiresAt,
        revocable: unified.revocable,
        signature: "0x0",
      };

    case "mpp":
      return {
        sessionId: `session_${Date.now()}`,
        grantedTo: unified.grantedTo,
        grantedBy: unified.grantedBy,
        spendingCapUsd: unified.maxAmountUsd,
        spentUsd: 0,
        allowedAssets: unified.allowedAssets,
        allowedChains: unified.allowedChains,
        expiresAt: unified.expiresAt,
        scopes: unified.scope.split(",").filter(Boolean),
      };

    case "acp":
      return {
        tokenId: `spt_${Date.now()}`,
        merchant: unified.grantedTo,
        payer: unified.grantedBy,
        maxAmountUsd: unified.maxAmountUsd,
        allowedAssets: unified.allowedAssets,
        allowedChains: unified.allowedChains,
        expiresAt: unified.expiresAt,
        checkoutScope: unified.scope,
      };

    case "erc7715":
      return {
        sessionKey: unified.grantedTo,
        granter: unified.grantedBy,
        permissions: unified.scope.split(",").filter(Boolean).map((type) => ({
          type,
          data: {
            allowedAssets: unified.allowedAssets,
            allowedChains: unified.allowedChains,
            maxAmount: String(unified.maxAmountUsd),
            validUntil: unified.expiresAt,
          },
        })),
        expiresAt: unified.expiresAt,
        revocable: unified.revocable,
      };

    case "erc7710":
      return {
        delegator: unified.grantedBy,
        delegate: unified.grantedTo,
        contractAddress: "0x0",
        allowedMethods: unified.scope.split(",").filter(Boolean),
        maxAmountPerTx: String(unified.maxAmountUsd),
        maxAmountTotal: String(unified.maxAmountUsd),
        allowedAssets: unified.allowedAssets,
        allowedChains: unified.allowedChains,
        expiresAt: unified.expiresAt,
        revocable: unified.revocable,
      };

    default: {
      const _exhaustive: never = targetProtocol;
      throw new Error(`Unsupported target protocol: ${_exhaustive}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validatePermission(unified: UnifiedPermission): PermissionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  // Expiry check
  if (unified.expiresAt <= now) {
    errors.push(`Permission expired at ${unified.expiresAt} (current: ${now})`);
  } else if (unified.expiresAt - now < 300) {
    warnings.push(`Permission expires in less than 5 minutes`);
  }

  // Amount limit
  if (unified.maxAmountUsd <= 0) {
    errors.push("maxAmountUsd must be positive");
  }
  if (unified.maxAmountUsd > 1_000_000) {
    warnings.push(`High-value permission: $${unified.maxAmountUsd.toLocaleString()}`);
  }

  // Asset and chain restrictions
  if (unified.allowedAssets.length === 0) {
    errors.push("allowedAssets must contain at least one asset");
  }
  if (unified.allowedChains.length === 0) {
    errors.push("allowedChains must contain at least one chain");
  }

  // Address validation (basic)
  if (!unified.grantedTo || unified.grantedTo.length < 2) {
    errors.push("grantedTo address is missing or invalid");
  }
  if (!unified.grantedBy || unified.grantedBy.length < 2) {
    errors.push("grantedBy address is missing or invalid");
  }

  // Scope check
  if (!unified.scope || unified.scope.trim() === "") {
    warnings.push("No scope defined — permission has unrestricted scope");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Merge permissions (intersection of allowed sets, minimum of limits)
// ---------------------------------------------------------------------------

export function mergePermissions(permissions: UnifiedPermission[]): UnifiedPermission {
  if (permissions.length === 0) {
    throw new Error("Cannot merge empty permissions array");
  }

  if (permissions.length === 1) {
    return permissions[0]!;
  }

  const first = permissions[0]!;

  // Intersection of allowed assets
  let mergedAssets = new Set(first.allowedAssets);
  for (const p of permissions.slice(1)) {
    const pAssets = new Set(p.allowedAssets);
    mergedAssets = new Set([...mergedAssets].filter((a) => pAssets.has(a)));
  }

  // Intersection of allowed chains
  let mergedChains = new Set(first.allowedChains);
  for (const p of permissions.slice(1)) {
    const pChains = new Set(p.allowedChains);
    mergedChains = new Set([...mergedChains].filter((c) => pChains.has(c)));
  }

  // Minimum amount, earliest expiry
  const minAmount = Math.min(...permissions.map((p) => p.maxAmountUsd));
  const earliestExpiry = Math.min(...permissions.map((p) => p.expiresAt));

  // All must be revocable for merged to be revocable
  const allRevocable = permissions.every((p) => p.revocable);

  // Intersection of scopes
  const scopeSets = permissions.map((p) => new Set(p.scope.split(",").filter(Boolean)));
  let mergedScopes = scopeSets[0]!;
  for (const s of scopeSets.slice(1)) {
    mergedScopes = new Set([...mergedScopes].filter((sc) => s.has(sc)));
  }

  logger.info("Permissions merged", {
    count: permissions.length,
    protocols: permissions.map((p) => p.protocol),
    resultAssets: [...mergedAssets],
    resultChains: [...mergedChains],
  });

  return {
    protocol: first.protocol,
    grantedTo: first.grantedTo,
    grantedBy: first.grantedBy,
    maxAmountUsd: minAmount,
    allowedAssets: [...mergedAssets],
    allowedChains: [...mergedChains],
    expiresAt: earliestExpiry,
    scope: [...mergedScopes].join(","),
    revocable: allRevocable,
    originalPermission: permissions.map((p) => p.originalPermission),
  };
}

// ---------------------------------------------------------------------------
// Dispatch translator by protocol string
// ---------------------------------------------------------------------------

export function translatePermission(
  protocol: PermissionProtocol,
  rawPermission: unknown,
): UnifiedPermission {
  switch (protocol) {
    case "x402":
      return translateX402Permission(rawPermission as X402Authorization);
    case "ap2":
      return translateAP2Mandate(rawPermission as AP2Mandate);
    case "mpp":
      return translateMPPSession(rawPermission as MPPSession);
    case "acp":
      return translateACPToken(rawPermission as ACPSharedPaymentToken);
    case "erc7715":
      return translateERC7715Permission(rawPermission as ERC7715Permission);
    case "erc7710":
      return translateERC7710Delegation(rawPermission as ERC7710Delegation);
    default: {
      const _exhaustive: never = protocol;
      throw new Error(`Unsupported protocol: ${_exhaustive}`);
    }
  }
}
