import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatDateShort(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function formatAmount(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatCompactNumber(num: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(num);
}

export function shortenAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function getStatusColor(status: string): string {
  switch (status.toUpperCase()) {
    case "PASS":
    case "VERIFIED":
    case "PAID":
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "FAIL":
    case "REVOKED":
    case "REJECTED":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "REVIEW":
    case "PENDING":
    case "DRAFT":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "EXPIRED":
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
    default:
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  }
}
