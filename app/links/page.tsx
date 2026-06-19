'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CreateLinkForm } from '@/components/create-link-form'
import { Plus, Link2, QrCode, DollarSign, TrendingUp, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Link {
  id: string
  code: string
  name: string | null
  sourceToken: string
  amountMin: number | null
  amountMax: number | null
  status: string
  totalVolume: number
  transactions: number
  createdAt: string
}

export default function PaymentLinksPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [links, setLinks] = useState<Link[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const fetchLinks = useCallback(async () => {
    try {
      const res = await fetch('/api/payment-links')
      const data = await res.json()
      if (data.success) setLinks(data.data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated') fetchLinks()
  }, [status, fetchLinks])

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/l/${code}`)
    toast.success('Link copied!')
  }

  const totalVolume = links.reduce((s, l) => s + l.totalVolume, 0)
  const activeLinks = links.filter(l => l.status === 'active')

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payment Links</h1>
          <p className="text-slate-500 text-sm mt-0.5">Create and share compliant payment links</p>
        </div>
        <Button className="bg-teal-600 hover:bg-teal-500 text-white" onClick={() => setActiveTab('create')}>
          <Plus className="h-4 w-4 mr-2" /> Create Link
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Links', value: links.length, icon: Link2 },
          { label: 'Active Links', value: activeLinks.length, icon: QrCode },
          { label: 'Total Volume', value: `$${totalVolume.toLocaleString()}`, icon: DollarSign },
          { label: 'Total Payments', value: links.reduce((s, l) => s + l.transactions, 0), icon: TrendingUp },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">{s.label}</p>
                  <p className="text-2xl font-bold text-slate-900 mt-0.5">{s.value}</p>
                </div>
                <div className="p-2.5 rounded-xl bg-teal-50">
                  <s.icon className="h-5 w-5 text-teal-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">My Links</TabsTrigger>
          <TabsTrigger value="create">Create New</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-3">
          {links.length === 0 ? (
            <div className="text-center py-16 text-slate-400 border border-dashed rounded-2xl">
              <QrCode className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No links yet</p>
              <p className="text-sm mt-1">Create your first payment link</p>
              <Button className="mt-4 bg-teal-600 hover:bg-teal-500 text-white" size="sm" onClick={() => setActiveTab('create')}>
                <Plus className="h-4 w-4 mr-1" /> Create Link
              </Button>
            </div>
          ) : (
            links.map(link => (
              <Card key={link.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-5 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-slate-900 truncate">{link.name ?? link.code}</p>
                      <Badge className={link.status === 'active' ? 'bg-teal-100 text-teal-800 border-teal-200 text-xs' : 'bg-slate-100 text-slate-600 text-xs'}>
                        {link.status}
                      </Badge>
                    </div>
                    <p className="text-xs font-mono text-slate-400 mb-2 truncate">/l/{link.code}</p>
                    <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                      <span>{link.sourceToken}</span>
                      {link.amountMin && <span>Min {link.amountMin}</span>}
                      {link.amountMax && <span>Max {link.amountMax}</span>}
                      <span>{link.transactions} payments</span>
                      <span>${link.totalVolume.toLocaleString()} volume</span>
                      <span>{new Date(link.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" size="sm" onClick={() => copyLink(link.code)}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy
                    </Button>
                    <a href={`/l/${link.code}`} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="create" className="mt-4">
          <Card>
            <CardContent className="p-6">
              <CreateLinkForm onSuccess={() => { fetchLinks(); setActiveTab('overview') }} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
