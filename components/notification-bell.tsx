'use client'

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Bell, X, CreditCard, FileText, Users, Shield, AlertCircle } from "lucide-react"

export interface AppNotification {
  id: string
  type: string
  title: string
  message: string
  read: boolean
  link: string | null
  createdAt: string
}

const notifTypeIcon: Record<string, React.ElementType> = {
  payment: CreditCard,
  invoice: FileText,
  payroll: Users,
  compliance: Shield,
  system: AlertCircle,
}

export function NotificationBell({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const fetchNotifs = async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const json = await res.json()
      setItems(json.data ?? [])
      setUnread(json.unreadCount ?? 0)
    } catch { /* silent */ }
  }

  useEffect(() => { fetchNotifs() }, [])

  useEffect(() => {
    const id = setInterval(fetchNotifs, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleOpen = async () => {
    setOpen(o => !o)
    if (!open && unread > 0) {
      setUnread(0)
      setItems(prev => prev.map(n => ({ ...n, read: true })))
      await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    }
  }

  const handleClick = (item: AppNotification) => {
    setOpen(false)
    if (item.link) onNavigate(item.link)
  }

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleOpen}
        className="text-slate-600 hover:text-slate-300 hover:bg-white/[0.04] h-8 w-8 p-0 relative"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-10 w-80 rounded-2xl border border-glass bg-glass shadow-2xl shadow-black/60 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <span className="text-sm font-semibold text-white">Notifications</span>
            <button onClick={() => setOpen(false)} className="text-slate-600 hover:text-slate-300">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-10 text-center text-slate-600 text-sm">No notifications yet</div>
            ) : (
              items.map(item => {
                const Icon = notifTypeIcon[item.type] ?? AlertCircle
                return (
                  <button
                    key={item.id}
                    onClick={() => handleClick(item)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors text-left border-b border-white/[0.04] last:border-0"
                  >
                    <div className={`mt-0.5 p-1.5 rounded-lg shrink-0 ${item.read ? 'bg-white/[0.05]' : 'bg-emerald-500/15'}`}>
                      <Icon className={`h-3.5 w-3.5 ${item.read ? 'text-slate-500' : 'text-emerald-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium truncate ${item.read ? 'text-slate-400' : 'text-white'}`}>{item.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">{item.message}</p>
                      <p className="text-[10px] text-slate-700 mt-1">{timeAgo(item.createdAt)}</p>
                    </div>
                    {!item.read && (
                      <span className="mt-2 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
