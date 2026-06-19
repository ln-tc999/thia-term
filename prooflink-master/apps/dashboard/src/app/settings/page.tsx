"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Key,
  Webhook,
  Shield,
  Bell,
  Users,
  Plus,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Save,
  RotateCcw,
  Settings,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Mail,
  UserPlus,
} from "lucide-react";
import {
  getApiKeys,
  getWebhooks,
  getTeamMembers,
  getCompliancePolicy,
  getNotificationPreferences,
  type ApiKey,
  type CompliancePolicy,
  type NotificationPreferences,
  type TeamMember,
  type Webhook as WebhookType,
} from "@/lib/api";
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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableSkeleton,
  TableEmpty,
} from "@/components/ui/table";
import { formatDate, cn } from "@/lib/utils";

type SettingsTab = "general" | "api-keys" | "webhooks" | "compliance" | "notifications" | "team";

const tabs: { id: SettingsTab; label: string; icon: typeof Key }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "compliance", label: "Compliance Policy", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "team", label: "Team", icon: Users },
];

// ─── Toggle Switch ──────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        checked ? "bg-primary" : "bg-secondary"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

// ─── General Section ─────────────────────────────────────────────────────────

function ApiKeyConnect() {
  const [key, setKey] = useState("");
  const [connected, setConnected] = useState(false);

  // Load from localStorage on mount
  useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("prooflink_api_key");
      if (saved) {
        setKey(saved);
        setConnected(true);
      }
    }
  });

  const handleConnect = () => {
    if (!key.trim()) return;
    const { setApiKey } = require("@/lib/api");
    setApiKey(key.trim());
    setConnected(true);
  };

  const handleDisconnect = () => {
    const { setApiKey } = require("@/lib/api");
    setApiKey("");
    setKey("");
    setConnected(false);
    if (typeof window !== "undefined") localStorage.removeItem("prooflink_api_key");
  };

  return (
    <Card className={connected ? "border-emerald-500/30" : "border-amber-500/30"}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4" />
            API Connection
          </CardTitle>
          {connected ? (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </span>
          ) : (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Not connected
            </span>
          )}
        </div>
        <CardDescription>
          Connect your API key to enable screening, invoice creation, and compliance checks from the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="fl_live_..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            type="password"
            className="font-mono text-sm"
          />
          {connected ? (
            <Button variant="destructive" size="sm" onClick={handleDisconnect} className="shrink-0">
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={handleConnect} disabled={!key.trim()} className="shrink-0 gap-1">
              <Key className="h-3 w-3" />
              Connect
            </Button>
          )}
        </div>
        {!connected && (
          <p className="text-xs text-muted-foreground">
            Without an API key, screening and invoice creation will use mock data.
            Your key from the seed: <code className="bg-secondary/50 px-1 rounded">fl_live_...</code>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function GeneralSection() {
  const [orgName, setOrgName] = useState("ProofLink Inc.");
  const [timezone, setTimezone] = useState("UTC");
  const [saving, setSaving] = useState(false);

  const timezones = [
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    "Europe/Berlin",
    "Asia/Tokyo",
    "Asia/Singapore",
    "Australia/Sydney",
  ];

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 1000));
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <ApiKeyConnect />
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">General Settings</h3>
          <p className="text-sm text-muted-foreground">
            Manage your organization profile and preferences
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2" size="sm">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><Save className="h-4 w-4" />Save Changes</>}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="org-name" className="text-sm font-medium">Organization Name</label>
              <Input
                id="org-name"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Your organization name"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="org-timezone" className="text-sm font-medium">Timezone</label>
              <div className="flex items-center gap-2">
                <select
                  id="org-timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors"
                >
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notification Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-4">
              <div>
                <p className="text-sm font-medium">Email Notifications</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Receive email alerts for critical events
                </p>
              </div>
              <Toggle checked={true} onChange={() => undefined} label="Email notifications" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-4">
              <div>
                <p className="text-sm font-medium">In-App Notifications</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Show real-time notifications in the dashboard
                </p>
              </div>
              <Toggle checked={true} onChange={() => undefined} label="In-app notifications" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-4">
              <div>
                <p className="text-sm font-medium">Slack Integration</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Forward alerts to your Slack workspace
                </p>
              </div>
              <Toggle checked={false} onChange={() => undefined} label="Slack integration" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── API Keys Section ───────────────────────────────────────────────────────

function ApiKeysSection() {
  const { data: keys, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: getApiKeys,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      setCreatedKey("fl_live_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6");
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey).catch(() => undefined);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setDialogOpen(false);
    setCreatedKey(null);
    setNewKeyName("");
    setShowKey(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">API Keys</h3>
          <p className="text-sm text-muted-foreground">
            Manage API keys for ProofLink integration
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleClose(); else setDialogOpen(true); }}>
          <DialogTrigger asChild>
            <Button className="gap-2" size="sm">
              <Plus className="h-4 w-4" />
              Create Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{createdKey ? "API Key Created" : "Create API Key"}</DialogTitle>
              <DialogDescription>
                {createdKey
                  ? "Copy your API key now. You won't be able to see it again."
                  : "Create a new API key for your application"}
              </DialogDescription>
            </DialogHeader>
            {createdKey ? (
              <div className="space-y-4 mt-4">
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md bg-secondary/50 px-3 py-2 text-xs font-mono break-all">
                    {showKey ? createdKey : createdKey.slice(0, 12) + "..." + "*".repeat(20)}
                  </code>
                  <Button variant="ghost" size="icon" onClick={() => setShowKey(!showKey)}>
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={handleCopy}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                {copied && <p className="text-xs text-emerald-400">Copied to clipboard!</p>}
                <Button onClick={handleClose} className="w-full">Done</Button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <label htmlFor="key-name" className="text-sm font-medium">Key Name</label>
                  <Input id="key-name" placeholder="e.g., Production API Key" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} required />
                </div>
                <Button type="submit" disabled={isCreating} className="gap-2">
                  {isCreating ? <><Loader2 className="h-4 w-4 animate-spin" />Creating...</> : <><Key className="h-4 w-4" />Create Key</>}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
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
              ) : (
                keys?.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <code className="text-xs font-mono bg-secondary/50 px-2 py-0.5 rounded">{key.prefix}...</code>
                    </TableCell>
                    <TableCell><StatusBadge status={key.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(key.createdAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{key.lastUsed ? formatDate(key.lastUsed) : "Never"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {key.status === "ACTIVE" && (
                          <>
                            <Button variant="ghost" size="sm" className="text-xs gap-1.5">
                              <RotateCcw className="h-3 w-3" />Rotate
                            </Button>
                            <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300 gap-1.5">
                              <Trash2 className="h-3 w-3" />Revoke
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Webhooks Section ───────────────────────────────────────────────────────

function WebhooksSection() {
  const { data: webhooks, isLoading } = useQuery({
    queryKey: ["webhooks"],
    queryFn: getWebhooks,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);

  const availableEvents = ["check.completed", "check.failed", "check.review", "invoice.paid", "agent.verified", "agent.revoked"];

  const toggleEvent = (event: string) => {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Webhooks</h3>
          <p className="text-sm text-muted-foreground">
            Configure webhook endpoints for real-time event notifications
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" size="sm">
              <Plus className="h-4 w-4" />
              Add Webhook
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Webhook Endpoint</DialogTitle>
              <DialogDescription>Configure a URL to receive event notifications</DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); setDialogOpen(false); }} className="space-y-4 mt-4">
              <div className="space-y-2">
                <label htmlFor="webhook-url" className="text-sm font-medium">Endpoint URL</label>
                <Input id="webhook-url" placeholder="https://api.example.com/webhooks" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Events</label>
                <div className="flex flex-wrap gap-2">
                  {availableEvents.map((event) => (
                    <button
                      key={event}
                      type="button"
                      onClick={() => toggleEvent(event)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-all",
                        newEvents.includes(event)
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border/50 bg-secondary/30 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {event}
                    </button>
                  ))}
                </div>
              </div>
              <Button type="submit" className="gap-2">
                <Webhook className="h-4 w-4" />Save Webhook
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="glass-card rounded-xl p-6 space-y-3">
              <div className="h-4 w-48 shimmer rounded" />
              <div className="h-3 w-32 shimmer rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks?.map((wh) => (
            <Card key={wh.id}>
              <CardContent className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Webhook className="h-4 w-4 text-primary" />
                    <code className="text-sm font-mono">{wh.url}</code>
                    <StatusBadge status={wh.status} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>Events: {wh.events.join(", ")}</span>
                    {wh.lastTriggered && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Last triggered: {formatDate(wh.lastTriggered)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="text-xs">Edit</Button>
                  <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300">
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Compliance Policy Section ──────────────────────────────────────────────

function CompliancePolicySection() {
  const { data: policy, isLoading } = useQuery({
    queryKey: ["compliance-policy"],
    queryFn: getCompliancePolicy,
  });

  const [localPolicy, setLocalPolicy] = useState<CompliancePolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [newJurisdiction, setNewJurisdiction] = useState("");
  const [newWatchlistAddr, setNewWatchlistAddr] = useState("");

  const current = localPolicy ?? policy;

  const updatePolicy = (updates: Partial<CompliancePolicy>) => {
    if (!current) return;
    setLocalPolicy({ ...current, ...updates });
  };

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 1000));
    setSaving(false);
  };

  if (isLoading || !current) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="glass-card rounded-xl p-6 space-y-3">
            <div className="h-4 w-32 shimmer rounded" />
            <div className="h-8 w-48 shimmer rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Compliance Policy</h3>
          <p className="text-sm text-muted-foreground">
            Configure thresholds, lists, and behavior for compliance checks
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2" size="sm">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><Save className="h-4 w-4" />Save Changes</>}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Thresholds */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thresholds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Risk Score Threshold</label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={current.riskScoreThreshold}
                  onChange={(e) => updatePolicy({ riskScoreThreshold: Number(e.target.value) })}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">Transactions above this score are flagged</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Max Transaction Amount</label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  value={current.maxTransactionAmount}
                  onChange={(e) => updatePolicy({ maxTransactionAmount: Number(e.target.value) })}
                  className="w-32"
                />
                <span className="text-xs text-muted-foreground">USDC</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Velocity Limit</label>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={0}
                  value={current.velocityLimit}
                  onChange={(e) => updatePolicy({ velocityLimit: Number(e.target.value) })}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">transactions per {current.velocityWindow}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fail-Open Toggle */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Behavior</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-4">
              <div>
                <p className="text-sm font-medium">Fail-Open Mode</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When enabled, transactions are approved if the compliance engine is unavailable
                </p>
              </div>
              <Toggle
                checked={current.failOpen}
                onChange={(v) => updatePolicy({ failOpen: v })}
                label="Fail-open mode"
              />
            </div>
            {current.failOpen && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-400">
                  Fail-open mode may allow unchecked transactions during outages.
                  Use with caution.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Blocked Jurisdictions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Blocked Jurisdictions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {current.blockedJurisdictions.map((j) => (
                <span
                  key={j}
                  className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-400"
                >
                  {j}
                  <button
                    onClick={() => updatePolicy({ blockedJurisdictions: current.blockedJurisdictions.filter((x) => x !== j) })}
                    className="hover:text-red-300"
                    aria-label={`Remove ${j}`}
                  >
                    <XCircle className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Country code (e.g., RU)"
                value={newJurisdiction}
                onChange={(e) => setNewJurisdiction(e.target.value.toUpperCase())}
                className="w-48"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (newJurisdiction && !current.blockedJurisdictions.includes(newJurisdiction)) {
                    updatePolicy({ blockedJurisdictions: [...current.blockedJurisdictions, newJurisdiction] });
                    setNewJurisdiction("");
                  }
                }}
              >
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Custom Watchlist */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Custom Watchlist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {current.customWatchlist.map((addr) => (
              <div key={addr} className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
                <code className="text-xs font-mono truncate max-w-[240px]">{addr}</code>
                <button
                  onClick={() => updatePolicy({ customWatchlist: current.customWatchlist.filter((x) => x !== addr) })}
                  className="text-red-400 hover:text-red-300 shrink-0"
                  aria-label="Remove address"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                placeholder="0x..."
                value={newWatchlistAddr}
                onChange={(e) => setNewWatchlistAddr(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (newWatchlistAddr && !current.customWatchlist.includes(newWatchlistAddr)) {
                    updatePolicy({ customWatchlist: [...current.customWatchlist, newWatchlistAddr] });
                    setNewWatchlistAddr("");
                  }
                }}
              >
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Notifications Section ──────────────────────────────────────────────────

function NotificationsSection() {
  const { data: prefs, isLoading } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: getNotificationPreferences,
  });

  const [localPrefs, setLocalPrefs] = useState<NotificationPreferences | null>(null);
  const [saving, setSaving] = useState(false);

  const current = localPrefs ?? prefs;

  const updatePref = (key: keyof NotificationPreferences, value: boolean) => {
    if (!current) return;
    setLocalPrefs({ ...current, [key]: value });
  };

  const handleSave = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 1000));
    setSaving(false);
  };

  if (isLoading || !current) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="glass-card rounded-xl p-4 space-y-2">
            <div className="h-4 w-32 shimmer rounded" />
            <div className="h-3 w-48 shimmer rounded" />
          </div>
        ))}
      </div>
    );
  }

  const notificationItems: { key: keyof NotificationPreferences; label: string; description: string }[] = [
    { key: "emailOnFailedCheck", label: "Failed Check Alerts", description: "Receive email when a compliance check fails" },
    { key: "emailOnHighRisk", label: "High Risk Alerts", description: "Receive email when a high-risk transaction is detected" },
    { key: "emailOnNewAgent", label: "New Agent Alerts", description: "Receive email when a new agent is registered" },
    { key: "webhookOnAllChecks", label: "Webhook on All Checks", description: "Send webhook for every compliance check" },
    { key: "dailyDigest", label: "Daily Digest", description: "Receive a daily summary email" },
    { key: "weeklyReport", label: "Weekly Report", description: "Receive a weekly analytics report" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Notification Preferences</h3>
          <p className="text-sm text-muted-foreground">
            Configure how and when you receive notifications
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-2" size="sm">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving...</> : <><Save className="h-4 w-4" />Save Changes</>}
        </Button>
      </div>

      <Card>
        <CardContent className="divide-y divide-border/50">
          {notificationItems.map((item) => (
            <div key={item.key} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
              </div>
              <Toggle
                checked={current[item.key]}
                onChange={(v) => updatePref(item.key, v)}
                label={item.label}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Team Section ───────────────────────────────────────────────────────────

function TeamSection() {
  const { data: members, isLoading } = useQuery({
    queryKey: ["team-members"],
    queryFn: getTeamMembers,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newMember, setNewMember] = useState({ email: "", role: "MEMBER" as TeamMember["role"] });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Team Members</h3>
          <p className="text-sm text-muted-foreground">
            Manage who has access to your ProofLink dashboard
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" size="sm">
              <UserPlus className="h-4 w-4" />
              Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
              <DialogDescription>Send an invitation to join your team</DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); setDialogOpen(false); }} className="space-y-4 mt-4">
              <div className="space-y-2">
                <label htmlFor="invite-email" className="text-sm font-medium">Email</label>
                <Input id="invite-email" type="email" placeholder="name@example.com" value={newMember.email} onChange={(e) => setNewMember((p) => ({ ...p, email: e.target.value }))} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Role</label>
                <div className="flex gap-2">
                  {(["ADMIN", "MEMBER", "VIEWER"] as const).map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setNewMember((p) => ({ ...p, role }))}
                      className={cn(
                        "rounded-lg border px-4 py-2 text-xs transition-all",
                        newMember.role === role
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border/50 bg-secondary/30 text-muted-foreground"
                      )}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
              <Button type="submit" className="gap-2">
                <Mail className="h-4 w-4" />Send Invitation
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableSkeleton rows={4} cols={5} />
              ) : (
                members?.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-teal-600 text-xs font-bold text-white">
                          {m.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{m.name}</p>
                          <p className="text-xs text-muted-foreground">{m.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        m.role === "ADMIN" ? "border-blue-500/30 bg-blue-500/10 text-blue-400" :
                        m.role === "MEMBER" ? "border-blue-500/30 bg-blue-500/10 text-blue-400" :
                        "border-zinc-500/30 bg-zinc-500/10 text-zinc-400"
                      )}>
                        {m.role}
                      </span>
                    </TableCell>
                    <TableCell><StatusBadge status={m.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(m.joinedAt)}</TableCell>
                    <TableCell className="text-right">
                      {m.role !== "ADMIN" && (
                        <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300">
                          Remove
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
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <div className="space-y-6">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your ProofLink configuration and team
        </p>
      </div>

      <div className="flex gap-6">
        {/* Tab Navigation */}
        <nav className="w-56 shrink-0 space-y-1" aria-label="Settings navigation">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                activeTab === tab.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {activeTab === tab.id && <ChevronRight className="h-3 w-3 ml-auto" />}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 animate-fade-in">
          {activeTab === "general" && <GeneralSection />}
          {activeTab === "api-keys" && <ApiKeysSection />}
          {activeTab === "webhooks" && <WebhooksSection />}
          {activeTab === "compliance" && <CompliancePolicySection />}
          {activeTab === "notifications" && <NotificationsSection />}
          {activeTab === "team" && <TeamSection />}
        </div>
      </div>
    </div>
  );
}
