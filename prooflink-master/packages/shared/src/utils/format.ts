import type { SupportedToken } from "../types/protocol.js";
import { TOKEN_DECIMALS } from "./validation.js";

// ---------------------------------------------------------------------------
// Amount formatting
// ---------------------------------------------------------------------------

/**
 * Format a numeric amount to a display string with appropriate decimal places.
 * For stablecoins (6 decimals), shows 2 decimal places.
 * For ETH (18 decimals), shows up to 6 significant decimal places.
 */
export function formatAmountDisplay(
  amount: number | string,
  token: SupportedToken,
): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;

  if (Number.isNaN(num)) {
    throw new Error(`Invalid amount: ${String(amount)}`);
  }

  const decimals = TOKEN_DECIMALS[token];

  // Stablecoins: 2 decimal places for display
  if (decimals <= 6) {
    return num.toFixed(2);
  }

  // ETH/SOL: up to 6 decimal places, strip trailing zeros
  return num.toFixed(6).replace(/\.?0+$/, "");
}

/**
 * Format a USD amount for display (e.g. "$1,234.56").
 */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ---------------------------------------------------------------------------
// Address formatting
// ---------------------------------------------------------------------------

/** Format a wallet address for display: 0x1234...abcd */
export function formatAddress(address: string, prefixLen = 6, suffixLen = 4): string {
  if (address.length <= prefixLen + suffixLen) {
    return address;
  }
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/** Format an ISO datetime string to a human-readable date. */
export function formatDate(isoString: string, locale = "en-US"): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${isoString}`);
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Format an ISO datetime string to a human-readable date+time. */
export function formatDateTime(isoString: string, locale = "en-US"): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${isoString}`);
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** Format a duration in milliseconds to a human-readable string. */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours}h ${minutes}m`;
}

// ---------------------------------------------------------------------------
// Receipt ID formatting
// ---------------------------------------------------------------------------

/** Format a receipt ID for display (type prefix + truncated UUID). */
export function formatReceiptId(receiptId: string): string {
  const parts = receiptId.split("_");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return receiptId;
  }

  const prefix = parts[0];
  const uuid = parts[1];

  const prefixLabels: Record<string, string> = {
    scr: "Sanctions",
    kya: "KYA",
    trl: "Travel Rule",
    inv: "Invoice",
    cmp: "Compliance",
    stl: "Settlement",
  };

  const label = prefixLabels[prefix] ?? prefix.toUpperCase();
  const short = uuid.length > 8 ? `${uuid.slice(0, 8)}...` : uuid;

  return `${label}#${short}`;
}
