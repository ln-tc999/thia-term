'use client'

import { useState, useRef, useEffect } from "react"
import { useSession } from "next-auth/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Camera, Loader2 } from "lucide-react"

interface ProfileDialogProps {
  open: boolean
  onClose: () => void
}

export function ProfileDialog({ open, onClose }: ProfileDialogProps) {
  const { data: session, update } = useSession()
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null)
  const [editName, setEditName] = useState("")
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const sessionWallet = session?.user?.walletAddress as string | null | undefined
  const currentAvatar = avatarPreview ?? session?.user?.image ?? null
  const currentName = session?.user?.name ?? ""

  useEffect(() => {
    if (open) {
      setEditName(session?.user?.name ?? "")
      setAvatarPreview(null)
      setMsg(null)
    }
  }, [open, session?.user?.name])

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) { setMsg({ text: "Please select an image file.", type: "error" }); return }
    if (file.size > 750_000) { setMsg({ text: "Image must be under 750KB.", type: "error" }); return }
    const reader = new FileReader()
    reader.onload = (ev) => setAvatarPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const saveProfile = async () => {
    setSaving(true)
    setMsg(null)
    try {
      if (avatarPreview) {
        setUploadingAvatar(true)
        const avatarRes = await fetch('/api/user/avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: avatarPreview }),
        })
        const avatarData = await avatarRes.json()
        setUploadingAvatar(false)
        if (!avatarData.success) { setMsg({ text: avatarData.error ?? "Failed to upload avatar.", type: "error" }); return }
        await update({ picture: avatarPreview })
      }
      if (editName !== currentName) {
        const res = await fetch('/api/user', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: editName }),
        })
        const data = await res.json()
        if (!data.success) { setMsg({ text: data.error ?? "Failed to save name.", type: "error" }); return }
        await update({ name: editName })
      }
      setMsg({ text: "Profile updated!", type: "success" })
      setAvatarPreview(null)
    } catch {
      setMsg({ text: "Something went wrong.", type: "error" })
    } finally {
      setSaving(false)
      setUploadingAvatar(false)
    }
  }

  const initials = currentName
    ? currentName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "FL"

  const isDirty = avatarPreview !== null || editName !== currentName

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-glass border-glass text-white shadow-2xl shadow-black/60">
        <DialogHeader>
          <DialogTitle className="text-white font-semibold tracking-tight">Profile Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-1">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative group">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-emerald-900/40 flex items-center justify-center border border-white/[0.08] shadow-lg shadow-black/40 ring-2 ring-emerald-500/10">
                {currentAvatar ? (
                  <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-emerald-400 font-bold text-2xl">{initials}</span>
                )}
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Camera className="h-5 w-5 text-white" />
              </button>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-emerald-400 hover:text-emerald-300 font-medium tracking-wide"
            >
              Change photo
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500 tracking-wider uppercase">Display Name</Label>
            <Input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Your name"
              className="field-glass"
            />
          </div>

          {/* Email (read-only) */}
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500 tracking-wider uppercase">Email <span className="text-slate-700 normal-case">(read-only)</span></Label>
            <Input value={session?.user?.email ?? "—"} readOnly className="field-disabled" />
          </div>

          {/* Save button */}
          {isDirty && (
            <Button
              onClick={saveProfile}
              disabled={saving}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-lg shadow-emerald-900/40"
            >
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{uploadingAvatar ? "Uploading…" : "Saving…"}</> : "Save Changes"}
            </Button>
          )}

          {/* Wallet */}
          <div className="pt-2 border-t border-white/[0.06] space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 tracking-wider uppercase">T3N Wallet</Label>
              <Input
                value={sessionWallet ?? "No wallet linked"}
                readOnly
                className="field-disabled font-mono text-xs"
              />
            </div>
          </div>

          {msg && (
            <p className={`text-xs ${msg.type === "success" ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
