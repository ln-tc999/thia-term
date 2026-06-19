"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink, FileText } from "lucide-react"
import { hashkeyChain } from "@/lib/hashkey"

interface Payment {
  id: string
  paymentLinkId: string | null
  payer: string | null
  amount: number
  currency: string
  txHash: string | null
  status: string
  kycPassed: boolean
  sanctionsChecked: boolean
  createdAt: string
}

export function PaymentsTable() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/payments?limit=50")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setPayments(json.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Recent Payments</CardTitle>
            <CardDescription>View completed payments and on-chain receipts</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Payer</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Compliance</TableHead>
              <TableHead>Tx Hash</TableHead>
              <TableHead>Explorer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Loading payments…
                </TableCell>
              </TableRow>
            ) : payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No payments yet
                </TableCell>
              </TableRow>
            ) : (
              payments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell>{new Date(payment.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {payment.payer ? `${payment.payer.slice(0, 6)}...${payment.payer.slice(-4)}` : "—"}
                  </TableCell>
                  <TableCell>
                    {payment.amount} {payment.currency}
                  </TableCell>
                  <TableCell>
                    <Badge variant={payment.status === "completed" ? "default" : "secondary"} className="text-xs capitalize">
                      {payment.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Badge variant={payment.kycPassed ? "default" : "secondary"} className="text-xs">
                        {payment.kycPassed ? "KYC ✓" : "KYC —"}
                      </Badge>
                      <Badge variant={payment.sanctionsChecked ? "default" : "secondary"} className="text-xs">
                        {payment.sanctionsChecked ? "AML ✓" : "AML —"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {payment.txHash
                      ? `${payment.txHash.slice(0, 10)}...${payment.txHash.slice(-8)}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {payment.txHash && (
                      <Button size="sm" variant="outline" asChild>
                        <a
                          href={`${hashkeyChain.blockExplorers.default.url}/tx/${payment.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
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
  )
}
