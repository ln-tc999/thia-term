"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { 
  Plus, 
  Search, 
  Filter, 
  MoreHorizontal, 
  Eye, 
  Edit, 
  Copy,
  QrCode,
  TrendingUp,
  TrendingDown,
  Loader2
} from "lucide-react"
import { usePaymentLinks } from "@/hooks/use-api"
import { useToast } from "@/hooks/use-toast"

interface PaymentLink {
  id: string
  code: string
  sourceToken: string
  destStable: string
  amountMin: number
  amountMax: number
  status: 'DRAFT' | 'ACTIVE' | 'DISABLED'
  createdAt: string
  transactions: number
  volume: number
}

export function PaymentLinksTable() {
  const [searchTerm, setSearchTerm] = useState("")
  const { data: paymentLinksData, loading, error, refetch } = usePaymentLinks()
  const { toast } = useToast()
  
  const paymentLinks: PaymentLink[] = paymentLinksData || []

  const filteredLinks = paymentLinks.filter(link =>
    link.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    link.sourceToken.toLowerCase().includes(searchTerm.toLowerCase()) ||
    link.destStable.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'success' as const
      case 'DRAFT': return 'warning' as const
      case 'DISABLED': return 'destructive' as const
      default: return 'outline' as const
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatVolume = (volume: number) => {
    if (volume >= 1000) {
      return `$${(volume / 1000).toFixed(1)}k`
    }
    return `$${volume}`
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5" />
              Payment Links
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Create and manage your payment links
            </p>
          </div>
          <Button className="bg-gradient-to-r from-emerald-600 to-purple-600 hover:from-emerald-700 hover:to-purple-700">
            <Plus className="h-4 w-4 mr-2" />
            Create Link
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search payment links..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="outline">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-md border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-4 font-medium">Link Code</th>
                  <th className="text-left p-4 font-medium">Token Pair</th>
                  <th className="text-left p-4 font-medium">Amount Range</th>
                  <th className="text-left p-4 font-medium">Status</th>
                  <th className="text-left p-4 font-medium">Transactions</th>
                  <th className="text-left p-4 font-medium">Volume</th>
                  <th className="text-left p-4 font-medium">Created</th>
                  <th className="text-right p-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="text-center p-8">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Loading payment links...</span>
                      </div>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={8} className="text-center p-8">
                      <div className="text-red-500">
                        <p>Error loading payment links: {error.message}</p>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => refetch()}
                          className="mt-2"
                        >
                          Retry
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : filteredLinks.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center p-8 text-muted-foreground">
                      No payment links found
                    </td>
                  </tr>
                ) : (
                  filteredLinks.map((link) => (
                  <tr key={link.id} className="border-t hover:bg-muted/25 transition-colors">
                    <td className="p-4">
                      <div className="font-medium">{link.code}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{link.sourceToken}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-medium">{link.destStable}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm">
                        {link.amountMin} - {link.amountMax}
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge variant={getStatusColor(link.status)}>
                        {link.status}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-600" />
                        <span className="font-medium">{link.transactions}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="font-medium">{formatVolume(link.volume)}</div>
                    </td>
                    <td className="p-4">
                      <div className="text-sm text-muted-foreground">
                        {formatDate(link.createdAt)}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon">
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {filteredLinks.length === 0 && (
          <div className="text-center py-12">
            <QrCode className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No payment links found</h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm ? "Try adjusting your search criteria" : "Create your first payment link to get started"}
            </p>
            {!searchTerm && (
              <Button className="bg-gradient-to-r from-emerald-600 to-purple-600 hover:from-emerald-700 hover:to-purple-700">
                <Plus className="h-4 w-4 mr-2" />
                Create Payment Link
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
