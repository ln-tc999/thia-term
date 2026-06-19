"use client"

import { useState, useEffect } from "react"
import { ShaderBackground } from "@/components/landing/ShaderBackground"
import { signIn, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useAccount, useSignMessage } from "wagmi"
import { SiweMessage } from "siwe"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import {
  Shield, Wallet, ArrowRight, Chrome, Loader2, Mail,
  UserCheck, Ban, FileCheck, CheckCircle, Lock,
} from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"

export default function LoginPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const { address, isConnected, chain } = useAccount()
  const { signMessageAsync } = useSignMessage()

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard")
  }, [status, router])

  const [googleLoading, setGoogleLoading] = useState(false)
  const [walletLoading, setWalletLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [mode, setMode] = useState<"login" | "register">("login")
  const [tab, setTab] = useState<"email" | "google" | "wallet">("email")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    await signIn("google", { callbackUrl: "/dashboard" })
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === "register") {
      if (password !== confirmPassword) { toast.error("Passwords do not match"); return }
      if (password.length < 8) { toast.error("Password must be at least 8 characters"); return }
      setEmailLoading(true)
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        })
        const data = await res.json()
        if (!res.ok) { toast.error(data.error || "Registration failed"); return }
        toast.success("Account created! Signing you in…")
        const result = await signIn("email-password", { email, password, redirect: false, callbackUrl: "/dashboard?setup=wallet" })
        if (result?.ok) router.push("/dashboard?setup=wallet")
        else toast.error("Sign-in after registration failed")
      } finally { setEmailLoading(false) }
    } else {
      setEmailLoading(true)
      try {
        const result = await signIn("email-password", { email, password, redirect: false, callbackUrl: "/dashboard" })
        if (result?.ok) router.push("/dashboard")
        else toast.error("Invalid email or password")
      } finally { setEmailLoading(false) }
    }
  }

  const handleWalletSignIn = async () => {
    if (!isConnected || !address) { toast.error("Connect your wallet first"); return }
    try {
      setWalletLoading(true)
      const nonceRes = await fetch("/api/auth/nonce")
      const { nonce } = await nonceRes.json()
      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to FlowLink",
        uri: window.location.origin,
        version: "1",
        chainId: chain?.id ?? 133,
        nonce,
      })
      const signature = await signMessageAsync({ message: message.prepareMessage() })
      const result = await signIn("siwe", { message: JSON.stringify(message), signature, redirect: false, callbackUrl: "/dashboard" })
      if (result?.ok) router.push("/dashboard")
      else toast.error("Wallet sign-in failed")
    } catch (err: any) {
      toast.error(err?.code === 4001 ? "Signature rejected" : "Something went wrong")
    } finally { setWalletLoading(false) }
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-[#071a1a]/95 via-[#0a2420]/90 to-[#0d2d2d]/95 flex flex-col">
      <ShaderBackground />
      {/* Top nav — same as landing */}
      <header className="border-b border-slate-100 px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <img src="/flowlink-logo-final.png" alt="FlowLink" className="w-9 h-9 rounded-xl object-cover" />
          <span className="font-bold text-xl tracking-tight">
            <span className="text-slate-900">Flow</span><span className="text-emerald-600">Link</span>
          </span>
        </Link>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
          ← Back to home
        </Link>
      </header>

      {/* Main — split layout */}
      <div className="flex flex-1">

        {/* Left — branding panel */}
        <div className="hidden lg:flex flex-col justify-between w-1/2 bg-slate-900 p-14">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium mb-10">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Now live on HashKey Chain
            </div>
            <h2 className="text-4xl font-black text-white leading-tight tracking-tight mb-4">
              Crypto Payments with{" "}
              <span className="text-emerald-400">Built-in<br />Compliance Tools</span>
            </h2>
            <p className="text-slate-400 text-lg leading-relaxed max-w-sm">
              KYC checks, sanctions screening, and on-chain settlement — tools to help your team handle crypto payments responsibly.
            </p>
          </div>

          {/* Compliance checks preview */}
          <div className="space-y-3">
            {[
              { icon: UserCheck, label: "KYC Verification", status: "Passed" },
              { icon: Ban,       label: "Sanctions Screening", status: "Clear" },
              { icon: FileCheck, label: "AML Check", status: "Clear" },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3 px-4 py-3 bg-white/5 border border-white/10 rounded-xl">
                <item.icon className="h-4 w-4 text-emerald-400 shrink-0" />
                <span className="text-sm text-slate-300 flex-1">{item.label}</span>
                <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" /> {item.status}
                </span>
              </div>
            ))}
            <p className="text-xs text-slate-600 text-center pt-1">Real-time compliance on every payment</p>
          </div>
        </div>

        {/* Right — auth form */}
        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">

            <div className="mb-8">
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                {mode === "login" ? "Welcome back" : "Create account"}
              </h1>
              <p className="text-slate-500 mt-1">
                {mode === "login"
                  ? "Sign in to your FlowLink account"
                  : "Get started with compliant crypto payments"}
              </p>
            </div>

            {/* Method tabs */}
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6">
              {(["email", "google", "wallet"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all capitalize ${
                    tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Email tab */}
            {tab === "email" && (
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                {mode === "register" && (
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Name</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="mt-1.5" />
                  </div>
                )}
                <div>
                  <Label className="text-sm font-medium text-slate-700">Email</Label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required className="mt-1.5" />
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-700">Password</Label>
                  <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required className="mt-1.5" />
                </div>
                {mode === "register" && (
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Confirm Password</Label>
                    <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" required className="mt-1.5" />
                  </div>
                )}
                <Button type="submit" disabled={emailLoading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-11 font-semibold" size="lg">
                  {emailLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
                  {emailLoading
                    ? (mode === "register" ? "Creating account…" : "Signing in…")
                    : (mode === "register" ? "Create Account" : "Sign In")}
                </Button>

                <p className="text-center text-sm text-slate-500 pt-1">
                  {mode === "login" ? (
                    <>Don&apos;t have an account?{" "}
                      <button type="button" onClick={() => { setMode("register"); setPassword(""); setConfirmPassword("") }} className="text-emerald-600 font-medium hover:underline">Register</button>
                    </>
                  ) : (
                    <>Already have an account?{" "}
                      <button type="button" onClick={() => { setMode("login"); setPassword(""); setConfirmPassword("") }} className="text-emerald-600 font-medium hover:underline">Sign in</button>
                    </>
                  )}
                </p>
              </form>
            )}

            {/* Google tab */}
            {tab === "google" && (
              <div className="space-y-4">
                <Button onClick={handleGoogleSignIn} disabled={googleLoading}
                  className="w-full bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 h-11 font-medium" size="lg">
                  {googleLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Chrome className="mr-2 h-4 w-4" />}
                  {googleLoading ? "Redirecting…" : "Continue with Google"}
                </Button>
                <p className="text-xs text-center text-slate-400">A new account is created automatically on first sign-in.</p>
              </div>
            )}

            {/* Wallet tab */}
            {tab === "wallet" && (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <ConnectButton label="Connect Wallet" accountStatus="address" showBalance={false} />
                </div>
                {isConnected && address && (
                  <Button onClick={handleWalletSignIn} disabled={walletLoading}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-11 font-semibold" size="lg">
                    {walletLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
                    {walletLoading ? "Signing…" : "Sign in with Wallet"}
                    {!walletLoading && <ArrowRight className="ml-2 h-4 w-4" />}
                  </Button>
                )}
                <p className="text-xs text-center text-slate-400">Sign a message to verify wallet ownership. No gas required.</p>
              </div>
            )}

            {/* Trust row */}
            <div className="flex items-center justify-center gap-6 mt-8 pt-6 border-t border-slate-100">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Shield className="h-3.5 w-3.5 text-emerald-500" /> KYC / AML
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Lock className="h-3.5 w-3.5 text-emerald-500" /> Encrypted
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Compliant
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
