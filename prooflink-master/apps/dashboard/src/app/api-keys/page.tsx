"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Key,
  Plus,
  Copy,
  Eye,
  EyeOff,
  Trash2,
  Clock,
  Loader2,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { getApiKeys } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableSkeleton, TableEmpty } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

export default function ApiKeysPage() {
  const { data: keys, isLoading, isError } = useQuery({
    queryKey: ["api-keys"],
    queryFn: getApiKeys,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  // Revoke confirmation state
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      setCreatedKey("fl_live_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0");
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyKey = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey).catch(() => undefined);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setCreatedKey(null);
    setNewKeyName("");
    setShowKey(false);
  };

  const handleRevokeClick = (keyId: string, keyName: string) => {
    setRevokeTarget({ id: keyId, name: keyName });
    setRevokeDialogOpen(true);
  };

  const handleRevokeConfirm = async () => {
    if (!revokeTarget) return;
    setIsRevoking(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      setRevokeDialogOpen(false);
      setRevokeTarget(null);
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage API keys for ProofLink integration
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); else setDialogOpen(true); }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Create API Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {createdKey ? "API Key Created" : "Create API Key"}
              </DialogTitle>
              <DialogDescription>
                {createdKey
                  ? "Copy your API key now. You won't be able to see it again."
                  : "Create a new API key for your application"}
              </DialogDescription>
            </DialogHeader>

            {createdKey ? (
              <div className="space-y-4 mt-4">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="h-4 w-4 text-amber-400" />
                    <p className="text-sm font-medium text-amber-400">
                      Save this key securely
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This is the only time you&apos;ll see this key. Store it in a
                    secure location.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md bg-secondary/50 px-3 py-2 text-xs font-mono break-all">
                    {showKey
                      ? createdKey
                      : createdKey.slice(0, 12) + "..." + "*".repeat(20)}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowKey(!showKey)}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyKey}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                {copied && (
                  <p className="text-xs text-emerald-400">
                    Copied to clipboard!
                  </p>
                )}
                <Button onClick={handleCloseDialog} className="w-full">
                  Done
                </Button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <label htmlFor="key-name" className="text-sm font-medium">Key Name</label>
                  <Input
                    id="key-name"
                    placeholder="e.g., Production API Key"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    A descriptive name to identify this key
                  </p>
                </div>
                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={isCreating} className="gap-2">
                    {isCreating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Key className="h-4 w-4" />
                        Create Key
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCloseDialog}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Revoke Confirmation Dialog */}
      <Dialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Revoke API Key
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke the key &quot;{revokeTarget?.name}&quot;? This action cannot be undone. Any applications using this key will immediately lose access.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-4">
            <Button
              variant="destructive"
              onClick={handleRevokeConfirm}
              disabled={isRevoking}
              className="gap-2"
            >
              {isRevoking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Revoking...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Revoke Key
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => setRevokeDialogOpen(false)}
              disabled={isRevoking}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Key className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Your API Keys</CardTitle>
              <CardDescription>
                Keys are used to authenticate API requests to ProofLink
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton rows={3} cols={6} />
              ) : isError ? (
                <TableEmpty message="Failed to load API keys." colSpan={6} />
              ) : (
                keys?.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <code className="text-xs font-mono bg-secondary/50 px-2 py-0.5 rounded">
                        {key.prefix}{"****...****"}
                      </code>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={key.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(key.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {key.lastUsed ? (
                        <span className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3" />
                          {formatDate(key.lastUsed)}
                        </span>
                      ) : (
                        <span className="text-zinc-500">Never</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {key.status === "ACTIVE" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-red-400 hover:text-red-300 gap-1.5"
                          onClick={() => handleRevokeClick(key.id, key.name)}
                        >
                          <Trash2 className="h-3 w-3" />
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Usage Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Start</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-secondary/30 border border-border/50 p-4">
            <pre className="text-xs font-mono text-muted-foreground overflow-x-auto">
              <code>{`import { ProofLink } from '@prooflink/sdk';

const client = new ProofLink({
  apiKey: 'fl_live_...',
});

// Run a compliance check
const result = await client.compliance.check({
  address: '0x...',
  chain: 'base',
  amount: 1000,
  currency: 'USDC',
});

console.log(result.status); // 'PASS' | 'FAIL' | 'REVIEW'`}</code>
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
