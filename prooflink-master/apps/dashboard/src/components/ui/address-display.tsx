"use client";

import { useState, useCallback } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { cn, shortenAddress } from "@/lib/utils";

interface AddressDisplayProps {
  address: string;
  chain?: string;
  truncate?: boolean;
  className?: string;
}

const chainExplorers: Record<string, string> = {
  Ethereum: "https://etherscan.io/address/",
  Polygon: "https://polygonscan.com/address/",
  Base: "https://basescan.org/address/",
  Arbitrum: "https://arbiscan.io/address/",
  Solana: "https://solscan.io/account/",
};

const chainIcons: Record<string, string> = {
  Ethereum: "ETH",
  Polygon: "MATIC",
  Base: "BASE",
  Arbitrum: "ARB",
  Solana: "SOL",
};

export function AddressDisplay({
  address,
  chain,
  truncate = true,
  className,
}: AddressDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [address]);

  const explorerUrl = chain && chainExplorers[chain]
    ? `${chainExplorers[chain]}${address}`
    : undefined;

  const display = truncate ? shortenAddress(address) : address;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {chain && chainIcons[chain] && (
        <span className="rounded bg-secondary/80 px-1 py-0.5 text-[10px] font-bold text-muted-foreground">
          {chainIcons[chain]}
        </span>
      )}

      <code className="font-mono text-sm text-foreground/90">{display}</code>

      <button
        type="button"
        onClick={handleCopy}
        className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
        aria-label={copied ? "Copied" : "Copy address"}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>

      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          aria-label="View on block explorer"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </span>
  );
}
