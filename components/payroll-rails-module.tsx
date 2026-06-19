"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Users,
  Plus,
  Upload,
  Download,
  Send,
  Clock,
  CheckCircle,
  AlertTriangle,
  Globe,
  DollarSign,
  Shield,
  Filter,
  Eye,
  Settings,
  BarChart3,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"

async function exportPayrollCsv(setExporting: (v: boolean) => void) {
  setExporting(true)
  try {
    const res = await fetch('/api/reports?type=payroll')
    if (!res.ok) { toast.error(`Export failed (${res.status})`); return }
    const text = await res.text()
    const lines = text.trim().split('\n')
    if (lines.length <= 1) { toast.info('No payroll data to export yet.'); return }
    const blob = new Blob([text], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `flowlink-payroll-${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success(`${lines.length - 1} payroll record${lines.length - 1 === 1 ? '' : 's'} exported.`)
  } catch {
    toast.error('Export failed — check your connection and try again.')
  } finally {
    setExporting(false)
  }
}

interface PayrollBatch {
  id: string
  name: string
  totalAmount: string
  currency: string
  recipients: number
  status: "draft" | "processing" | "completed" | "failed"
  created: string
  scheduled: string
  completedAt?: string
  complianceScore: number
}

interface Recipient {
  id: string
  name: string
  email: string
  walletAddress: string
  amount: string
  currency: string
  country: string
  kycLevel: "basic" | "enhanced" | "institutional"
  status: "pending" | "verified" | "blocked" | "paid"
  complianceFlags: string[]
}

interface CountryLimit {
  country: string
  code: string
  dailyLimit: number
  monthlyLimit: number
  kycRequired: boolean
  currentUsage: number
}

export function PayrollRailsModule() {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedBatch, setSelectedBatch] = useState<PayrollBatch | null>(null)
  const [showRecipientsDialog, setShowRecipientsDialog] = useState(false)
  const [payrollBatches, setPayrollBatches] = useState<PayrollBatch[]>([])
  const [rawBatches, setRawBatches] = useState<any[]>([])
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [recipients, setRecipients] = useState<Recipient[]>([])

  const fetchBatches = async () => {
    try {
      const res = await fetch("/api/payroll?includeRecipients=true")
      const json = await res.json()
      if (json.success) {
        setRawBatches(json.data)
        setPayrollBatches(
          json.data.map((b: any) => ({
            id: b.id,
            name: b.name,
            totalAmount: Number(b.totalAmount).toLocaleString(),
            currency: b.currency,
            recipients: b.recipients?.length ?? 0,
            status: b.status as PayrollBatch["status"],
            created: b.createdAt.split("T")[0],
            scheduled: b.scheduledAt ? b.scheduledAt.split("T")[0] : b.createdAt.split("T")[0],
            completedAt: b.completedAt ? b.completedAt.replace("T", " ").slice(0, 16) : undefined,
            complianceScore: 0,
          }))
        )
      }
    } catch (e) {
      console.error("Failed to fetch payroll batches", e)
    } finally {
      setLoadingBatches(false)
    }
  }

  useEffect(() => { fetchBatches() }, [])

  useEffect(() => {
    if (!selectedBatch) { setRecipients([]); return }
    const batchData = rawBatches.find(b => b.id === selectedBatch.id)
    if (!batchData?.recipients) { setRecipients([]); return }
    setRecipients(batchData.recipients.map((r: any) => ({
      id: r.id,
      name: r.name,
      email: r.email ?? '',
      walletAddress: r.walletAddress,
      amount: String(r.amount),
      currency: r.currency,
      country: r.country ?? 'Unknown',
      kycLevel: r.kycStatus === 'verified' ? 'enhanced' : 'basic',
      status: r.status as Recipient['status'],
      complianceFlags: [],
    })))
  }, [selectedBatch])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-card-foreground">Payroll Rails</h2>
          <p className="text-muted-foreground mt-1">Cross-border batch payments with per-recipient compliance rules</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setShowRecipientsDialog(true)}>
            <Users className="h-4 w-4 mr-2" />
            Manage Recipients
          </Button>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">
                <Plus className="h-4 w-4 mr-2" />
                Create Batch
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>Create Payroll Batch</DialogTitle>
                <DialogDescription>Set up a new batch payment with compliance rules</DialogDescription>
              </DialogHeader>
              <CreatePayrollBatchForm onClose={() => setShowCreateDialog(false)} onSuccess={() => { fetchBatches(); setShowCreateDialog(false) }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Overview */}
      {(() => {
        const totalProcessed = payrollBatches
          .filter((b) => b.status === "completed")
          .reduce((sum, b) => sum + parseFloat(b.totalAmount.replace(/,/g, "")), 0)
        const totalRecipients = payrollBatches.reduce((sum, b) => sum + b.recipients, 0)
        const completedCount = payrollBatches.filter((b) => b.status === "completed").length
        const successRate = payrollBatches.length > 0
          ? Math.round((completedCount / payrollBatches.length) * 100)
          : 0
        return (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-card-foreground">Total Processed</span>
                </div>
                <p className="text-2xl font-bold text-card-foreground">
                  {totalProcessed > 0 ? `$${totalProcessed.toLocaleString()}` : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Completed batches</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-card-foreground">Recipients</span>
                </div>
                <p className="text-2xl font-bold text-card-foreground">
                  {totalRecipients > 0 ? totalRecipients.toLocaleString() : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Across all batches</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-card-foreground">Completed</span>
                </div>
                <p className="text-2xl font-bold text-green-600">{completedCount}</p>
                <p className="text-xs text-muted-foreground mt-1">of {payrollBatches.length} batches</p>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-card-foreground">Success Rate</span>
                </div>
                <p className="text-2xl font-bold text-green-600">
                  {payrollBatches.length > 0 ? `${successRate}%` : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">By batch count</p>
              </CardContent>
            </Card>
          </div>
        )
      })()}

      <Tabs defaultValue="batches" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="batches">Payroll Batches</TabsTrigger>
          <TabsTrigger value="recipients">Recipients</TabsTrigger>
          <TabsTrigger value="limits">Country Limits</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="batches" className="space-y-4">
          <div className="grid gap-4">
            {loadingBatches ? (
              <div className="text-center py-12 text-muted-foreground">Loading batches…</div>
            ) : payrollBatches.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No payroll batches yet. Create your first batch.</div>
            ) : (
              payrollBatches.map((batch) => (
                <PayrollBatchCard key={batch.id} batch={batch} onSelect={setSelectedBatch} />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="recipients" className="space-y-4">
          <RecipientsManagement recipients={recipients} />
        </TabsContent>

        <TabsContent value="limits" className="space-y-4">
          <CountryLimitsPanel limits={[]} />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <PayrollAnalytics />
        </TabsContent>
      </Tabs>

      {/* Batch Details Dialog */}
      {selectedBatch && (
        <Dialog open={!!selectedBatch} onOpenChange={() => setSelectedBatch(null)}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>{selectedBatch.name}</DialogTitle>
              <DialogDescription>Batch payment details and recipient status</DialogDescription>
            </DialogHeader>
            <PayrollBatchDetails batch={selectedBatch} recipients={recipients} />
          </DialogContent>
        </Dialog>
      )}

      {/* Recipients Management Dialog */}
      {showRecipientsDialog && (
        <Dialog open={showRecipientsDialog} onOpenChange={setShowRecipientsDialog}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Manage Recipients</DialogTitle>
              <DialogDescription>Add, edit, and manage payroll recipients</DialogDescription>
            </DialogHeader>
            <RecipientsManagement recipients={recipients} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function PayrollBatchCard({ batch, onSelect }: { batch: PayrollBatch; onSelect: (batch: PayrollBatch) => void }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      case "processing":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      case "draft":
        return "bg-white/[0.06] text-slate-400 border-white/[0.08]"
      case "failed":
        return "bg-red-500/10 text-red-400 border-red-500/20"
      default:
        return "bg-white/[0.06] text-slate-400 border-white/[0.08]"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "processing":
        return <Clock className="h-4 w-4 text-emerald-500" />
      case "failed":
        return <AlertTriangle className="h-4 w-4 text-red-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-500" />
    }
  }

  return (
    <Card
      className="bg-card border-border hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => onSelect(batch)}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="font-semibold text-card-foreground">{batch.name}</h3>
              <Badge className={getStatusColor(batch.status)}>{batch.status}</Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Total Amount</p>
                <p className="font-medium text-card-foreground">
                  {batch.totalAmount} {batch.currency}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Recipients</p>
                <p className="font-medium text-card-foreground">{batch.recipients}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Scheduled</p>
                <p className="font-medium text-card-foreground">{batch.scheduled}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Compliance</p>
                <p className="font-medium text-green-600">{batch.complianceScore}%</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {getStatusIcon(batch.status)}
            <Button variant="outline" size="sm">
              <Eye className="h-4 w-4 mr-2" />
              Details
            </Button>
            {batch.status === "draft" && (
              <Button size="sm" className="bg-primary hover:bg-primary/90">
                <Send className="h-4 w-4 mr-2" />
                Process
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CreatePayrollBatchForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [batchName, setBatchName] = useState("")
  const [selectedCurrency, setSelectedCurrency] = useState("USDC")
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    if (!batchName.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: batchName.trim(), currency: selectedCurrency, totalAmount: 0 }),
      })
      if (res.ok) onSuccess()
    } catch (e) {
      console.error("Failed to create batch", e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Batch Configuration */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-card-foreground">Batch Configuration</h3>

          <div className="space-y-2">
            <Label htmlFor="batch-name">Batch Name</Label>
            <Input
              id="batch-name"
              placeholder="e.g., Q1 2024 Developer Salaries"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">Payment Currency</Label>
            <Select value={selectedCurrency} onValueChange={setSelectedCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USDC">USDC</SelectItem>
                <SelectItem value="USDT">USDT</SelectItem>
                <SelectItem value="SGD">SGD Stable</SelectItem>
                <SelectItem value="HKD">HKD Stable</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule">Execution Schedule</Label>
            <Select defaultValue="immediate">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">Execute Immediately</SelectItem>
                <SelectItem value="scheduled">Schedule for Later</SelectItem>
                <SelectItem value="recurring">Recurring Payment</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Recipients Upload</Label>
            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">Upload CSV file with recipient details</p>
              <Button variant="outline" size="sm">
                Choose File
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                Required columns: name, email, wallet_address, amount, country
              </p>
            </div>
          </div>
        </div>

        {/* Compliance Rules */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-card-foreground">Compliance Rules</h3>

          <Card className="bg-muted/50 border-border">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-card-foreground">KYC Verification</p>
                  <p className="text-sm text-muted-foreground">Require KYC for all recipients</p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-card-foreground">Sanctions Screening</p>
                  <p className="text-sm text-muted-foreground">Check against global sanctions lists</p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-card-foreground">Country Limits</p>
                  <p className="text-sm text-muted-foreground">Enforce per-country transaction limits</p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-card-foreground">Auto-Retry Failed</p>
                  <p className="text-sm text-muted-foreground">Automatically retry failed payments</p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label>Risk Tolerance</Label>
            <Select defaultValue="conservative">
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conservative">Conservative</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="aggressive">Aggressive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Batch Notes</Label>
            <Textarea id="notes" placeholder="Optional notes for this batch..." rows={3} />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button className="bg-primary hover:bg-primary/90" onClick={handleCreate} disabled={!batchName.trim() || saving}>
          {saving ? "Creating…" : "Create Batch"}
        </Button>
      </div>
    </div>
  )
}

function RecipientsManagement({ recipients }: { recipients: Recipient[] }) {
  const getKycLevelColor = (level: string) => {
    switch (level) {
      case "institutional":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      case "enhanced":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      case "basic":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20"
      default:
        return "bg-white/[0.06] text-slate-400 border-white/[0.08]"
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "verified":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      case "pending":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20"
      case "blocked":
        return "bg-red-500/10 text-red-400 border-red-500/20"
      case "paid":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      default:
        return "bg-white/[0.06] text-slate-400 border-white/[0.08]"
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-card-foreground">Recipients ({recipients.length})</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button size="sm" className="bg-primary hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-2" />
            Add Recipient
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {recipients.map((recipient) => (
          <Card key={recipient.id} className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="font-medium text-card-foreground">{recipient.name}</h4>
                    <Badge className={getStatusColor(recipient.status)}>{recipient.status}</Badge>
                    <Badge className={getKycLevelColor(recipient.kycLevel)}>{recipient.kycLevel}</Badge>
                    {recipient.complianceFlags.length > 0 && (
                      <Badge variant="outline" className="border-red-200 text-red-600">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {recipient.complianceFlags.length} flags
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Email</p>
                      <p className="font-medium text-card-foreground">{recipient.email}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Amount</p>
                      <p className="font-medium text-card-foreground">
                        {recipient.amount} {recipient.currency}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Country</p>
                      <p className="font-medium text-card-foreground">{recipient.country}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Wallet</p>
                      <p className="font-medium text-card-foreground font-mono text-xs">{recipient.walletAddress}</p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm">
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm">
                    <Settings className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function CountryLimitsPanel({ limits }: { limits: CountryLimit[] }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-card-foreground">Country Limits & Usage</h3>
        <Button variant="outline" size="sm">
          <Settings className="h-4 w-4 mr-2" />
          Configure Limits
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {limits.map((limit) => (
          <Card key={limit.code} className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <h4 className="font-semibold text-card-foreground">{limit.country}</h4>
                    <p className="text-sm text-muted-foreground">{limit.code}</p>
                  </div>
                </div>
                {limit.kycRequired && (
                  <Badge variant="outline" className="border-accent/20 text-accent">
                    <Shield className="h-3 w-3 mr-1" />
                    KYC Required
                  </Badge>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Daily Usage</span>
                    <span>
                      ${limit.currentUsage.toLocaleString()} / ${limit.dailyLimit.toLocaleString()}
                    </span>
                  </div>
                  <Progress value={(limit.currentUsage / limit.dailyLimit) * 100} className="h-2" />
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Daily Limit</p>
                    <p className="font-medium text-card-foreground">${limit.dailyLimit.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Monthly Limit</p>
                    <p className="font-medium text-card-foreground">${limit.monthlyLimit.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function PayrollBatchDetails({ batch, recipients }: { batch: PayrollBatch; recipients: Recipient[] }) {
  const [exporting, setExporting] = useState(false)
  return (
    <div className="space-y-6">
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="recipients">Recipients</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Total Amount</span>
                </div>
                <p className="text-2xl font-bold text-card-foreground">
                  {batch.totalAmount} {batch.currency}
                </p>
                <p className="text-xs text-muted-foreground">Across {batch.recipients} recipients</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Success Rate</span>
                </div>
                <p className="text-2xl font-bold text-green-600">97.8%</p>
                <p className="text-xs text-muted-foreground">44 of 45 successful</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Compliance Score</span>
                </div>
                <p className="text-2xl font-bold text-green-600">{batch.complianceScore}%</p>
                <p className="text-xs text-muted-foreground">All checks passed</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="recipients" className="space-y-4">
          <RecipientsManagement recipients={recipients} />
        </TabsContent>

        <TabsContent value="compliance" className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Compliance Checks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">KYC Verification</span>
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Passed</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">Sanctions Screening</span>
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Passed</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">Country Limits</span>
                  </div>
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Within Limits</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm">Risk Assessment</span>
                  </div>
                  <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20">1 Medium Risk</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                Audit Trail
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting}
                  onClick={() => exportPayrollCsv(setExporting)}
                  className="text-slate-200 border-white/[0.12] hover:bg-white/[0.06] hover:text-white bg-transparent"
                >
                  {exporting
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <Download className="h-4 w-4 mr-2" />}
                  Export CSV
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">Audit trail events will appear here as the batch is processed.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function PayrollAnalytics() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Payment Volume by Country</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-6 text-muted-foreground">
              <p className="text-sm">Country breakdown will appear once payroll batches have been processed.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Compliance Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-6 text-muted-foreground">
              <p className="text-sm">Compliance metrics will populate as batches are processed.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
