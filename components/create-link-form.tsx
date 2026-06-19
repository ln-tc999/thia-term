"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Copy, Plus } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { SUPPORTED_CHAINS, DEFAULT_CHAIN_KEY } from "@/lib/chains"

const CHAINS = SUPPORTED_CHAINS

export function CreateLinkForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const [network, setNetwork] = useState(DEFAULT_CHAIN_KEY)
  const [sourceToken, setSourceToken] = useState(CHAINS.find(c => c.key === DEFAULT_CHAIN_KEY)?.tokens[0]?.symbol ?? 'HSK')
  const [amount, setAmount] = useState("")
  const [memo, setMemo] = useState("")
  const [generatedLink, setGeneratedLink] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const { toast } = useToast()

  const selectedChain = CHAINS.find(c => c.key === network) ?? CHAINS[0]

  const handleNetworkChange = (key: string) => {
    setNetwork(key)
    const chain = CHAINS.find(c => c.key === key)
    // Default to first stablecoin on the new chain
    setSourceToken(chain?.tokens[0]?.symbol ?? '')
  }

  const handleCreateLink = async () => {
    if (!amount) {
      toast({ title: "Error", description: "Please enter an amount", variant: "destructive" })
      return
    }

    setIsCreating(true)
    try {
      const response = await fetch("/api/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: `pay-${Date.now()}`,
          name: memo || null,
          network,
          sourceToken,
          amountMin: parseFloat(amount),
          amountMax: parseFloat(amount),
        }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to create payment link")

      setGeneratedLink(`${window.location.origin}/l/${data.data?.code}`)
      toast({ title: "Payment link created", description: "Your payment request is ready to share" })

      setAmount("")
      setMemo("")
      setNetwork(DEFAULT_CHAIN_KEY)
      setSourceToken(CHAINS.find(c => c.key === DEFAULT_CHAIN_KEY)?.tokens[0]?.symbol ?? 'HSK')
      onSuccess?.()
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create payment link",
        variant: "destructive",
      })
    } finally {
      setIsCreating(false)
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink)
    toast({ title: "Copied!", description: "Payment link copied to clipboard" })
  }

  return (
    <Card className="border-primary/20 shadow-lg hover:shadow-xl transition-shadow duration-300">
      <CardHeader className="bg-gradient-to-r from-primary/5 to-accent/5 border-b border-primary/10">
        <CardTitle className="flex items-center gap-2 text-primary">
          <Plus className="w-5 h-5" />
          Create Payment Request
        </CardTitle>
        <CardDescription>
          Generate a shareable payment link — payer pays directly to your wallet
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">

        {/* Network */}
        <div className="space-y-2">
          <Label>Network</Label>
          <Select value={network} onValueChange={handleNetworkChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAINS.map(c => (
                <SelectItem key={c.key} value={c.key}>
                  {c.name}
                  {c.testnet && <span className="ml-2 text-xs text-muted-foreground">(testnet)</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Token */}
        <div className="space-y-2">
          <Label>Token</Label>
          <Select value={sourceToken} onValueChange={setSourceToken}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {selectedChain.tokens.map(t => (
                <SelectItem key={t.symbol} value={t.symbol}>
                  {t.symbol} — {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <Label htmlFor="amount">Amount ({sourceToken})</Label>
          <Input
            id="amount"
            type="number"
            placeholder="100.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        {/* Memo */}
        <div className="space-y-2">
          <Label htmlFor="memo">Description (optional)</Label>
          <Textarea
            id="memo"
            placeholder="Invoice #123 — Freelance services..."
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
          />
        </div>

        <Button
          onClick={handleCreateLink}
          className="w-full bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 shadow-lg"
          disabled={isCreating}
        >
          {isCreating ? "Creating..." : "Create Payment Request"}
        </Button>

        {generatedLink && (
          <div className="space-y-2">
            <Label>Your payment link</Label>
            <div className="flex gap-2">
              <Input value={generatedLink} readOnly className="font-mono text-sm" />
              <Button size="icon" variant="outline" onClick={copyToClipboard}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Share this link — payer connects wallet, switches to {selectedChain.name}, and pays {sourceToken} directly to you.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
