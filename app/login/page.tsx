"use client"

import { useState, useEffect } from "react"
import { ShaderBackground } from "@/components/landing/ShaderBackground"
import { signIn, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Shield, Chrome, Loader2, Mail,
  UserCheck, Ban, FileCheck, CheckCircle, Lock,
  ArrowRight, Sparkles, Zap, TrendingUp,
} from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"

export default function LoginPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard")
  }, [status, router])

  const [googleLoading, setGoogleLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [mode, setMode] = useState<"login" | "register">("login")
  const [tab, setTab] = useState<"email" | "google">("email")
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

  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col">
      {/* Animated Background */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* Animated mesh gradients */}
        <motion.div
          className="absolute w-[600px] h-[600px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(14,165,233,0.15) 0%, transparent 70%)" }}
          animate={{
            x: ["-25%", "25%", "-25%"],
            y: ["-25%", "25%", "-25%"],
            scale: [1, 1.2, 1],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute right-0 bottom-0 w-[500px] h-[500px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(14,165,233,0.1) 0%, transparent 70%)" }}
          animate={{
            x: ["25%", "-25%", "25%"],
            y: ["25%", "-25%", "25%"],
            scale: [1.2, 1, 1.2],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(14,165,233,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.03)_1px,transparent_1px)] bg-[size:72px_72px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_50%,black,transparent)]" />
      </div>

      {/* Top nav — glassmorphism */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="relative backdrop-blur-xl bg-white/5 border-b border-white/10 px-6 h-16 flex items-center justify-between z-10"
      >
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 p-[1px] shadow-lg shadow-sky-500/20 group-hover:shadow-sky-500/40 transition-all">
            <img src="/thia-term-logo.png" alt="Thia-Term" className="w-full h-full rounded-xl object-cover" />
          </div>
          <span className="font-bold text-xl tracking-tight">
            <span className="text-white">Thia</span><span className="text-sky-400">-Term</span>
          </span>
        </Link>
        <Link href="/" className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1 group">
          <span>Back to home</span>
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </motion.header>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8 relative">

        {/* Floating features — desktop only */}
        <div className="hidden xl:block absolute left-[10%] top-1/2 -translate-y-1/2 space-y-6 max-w-sm">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-sm font-medium mb-6 backdrop-blur-xl">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              Powered by T3N
            </div>
            <h2 className="text-4xl font-black text-white leading-tight tracking-tight mb-3">
              Crypto Payments with{" "}
              <span className="bg-gradient-to-r from-sky-400 to-cyan-400 bg-clip-text text-transparent">
                Built-in Compliance
              </span>
            </h2>
            <p className="text-slate-400 text-base leading-relaxed">
              KYC checks, sanctions screening, and on-chain settlement — handle crypto payments responsibly.
            </p>
          </motion.div>

          {/* Animated feature cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="space-y-3"
          >
            {[
              { icon: Zap, label: "Instant Settlement", desc: "Real-time on-chain" },
              { icon: Shield, label: "Auto Compliance", desc: "KYC + AML checks" },
              { icon: TrendingUp, label: "Smart Analytics", desc: "Track all payments" },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + i * 0.1 }}
                whileHover={{ x: 4, transition: { duration: 0.2 } }}
                className="flex items-center gap-3 px-4 py-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl hover:bg-white/10 transition-colors cursor-default"
              >
                <div className="w-9 h-9 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
                  <item.icon className="h-4 w-4 text-sky-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-white">{item.label}</p>
                  <p className="text-xs text-slate-400">{item.desc}</p>
                </div>
                <CheckCircle className="h-4 w-4 text-sky-400/60" />
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Auth card — glassmorphism */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="relative backdrop-blur-2xl bg-white/[0.07] border border-white/10 rounded-3xl p-8 shadow-2xl shadow-black/20">
            {/* Glow effect */}
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-sky-500/20 via-transparent to-cyan-500/20 rounded-3xl blur-2xl" />

            {/* Header */}
            <div className="mb-8 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 flex items-center justify-center shadow-lg shadow-sky-500/30"
              >
                <Sparkles className="w-8 h-8 text-white" />
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-3xl font-black text-white tracking-tight"
              >
                {mode === "login" ? "Welcome back" : "Get Started"}
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-slate-400 mt-2"
              >
                {mode === "login"
                  ? "Sign in to your Thia-Term account"
                  : "Create your account in seconds"}
              </motion.p>
            </div>

            {/* Method tabs */}
            <div className="relative flex gap-2 p-1.5 bg-white/5 backdrop-blur-xl rounded-2xl mb-6 border border-white/10">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  layoutId="activeTab"
                  className="absolute inset-y-1.5 bg-gradient-to-r from-sky-500 to-sky-600 rounded-xl shadow-lg shadow-sky-500/20"
                  style={{
                    left: tab === "email" ? "6px" : "calc(50% + 2px)",
                    right: tab === "email" ? "calc(50% + 2px)" : "6px",
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              </AnimatePresence>
              {(["email", "google"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`relative flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors capitalize z-10 ${
                    tab === t ? "text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Email tab */}
            <AnimatePresence mode="wait">
              {tab === "email" && (
                <motion.form
                  key="email-form"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                  onSubmit={handleEmailSubmit}
                  className="space-y-4"
                >
                  {mode === "register" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <Label className="text-sm font-medium text-slate-300">Name</Label>
                      <Input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Your name"
                        className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-sky-500/50 focus:bg-white/10 transition-all"
                      />
                    </motion.div>
                  )}
                  <div>
                    <Label className="text-sm font-medium text-slate-300">Email</Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-sky-500/50 focus:bg-white/10 transition-all"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-300">Password</Label>
                    <Input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-sky-500/50 focus:bg-white/10 transition-all"
                    />
                  </div>
                  {mode === "register" && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <Label className="text-sm font-medium text-slate-300">Confirm Password</Label>
                      <Input
                        type="password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="mt-1.5 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-sky-500/50 focus:bg-white/10 transition-all"
                      />
                    </motion.div>
                  )}
                  <Button
                    type="submit"
                    disabled={emailLoading}
                    className="w-full bg-gradient-to-r from-sky-600 to-sky-500 hover:from-sky-500 hover:to-sky-400 text-white h-12 font-semibold shadow-lg shadow-sky-500/20 hover:shadow-sky-500/40 transition-all"
                  >
                    {emailLoading ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Mail className="mr-2 h-5 w-5" />
                    )}
                    {emailLoading
                      ? (mode === "register" ? "Creating account…" : "Signing in…")
                      : (mode === "register" ? "Create Account" : "Sign In")}
                  </Button>

                  <p className="text-center text-sm text-slate-400 pt-2">
                    {mode === "login" ? (
                      <>
                        Don&apos;t have an account?{" "}
                        <button
                          type="button"
                          onClick={() => { setMode("register"); setPassword(""); setConfirmPassword("") }}
                          className="text-sky-400 font-medium hover:text-sky-300 hover:underline transition-colors"
                        >
                          Register
                        </button>
                      </>
                    ) : (
                      <>
                        Already have an account?{" "}
                        <button
                          type="button"
                          onClick={() => { setMode("login"); setPassword(""); setConfirmPassword("") }}
                          className="text-sky-400 font-medium hover:text-sky-300 hover:underline transition-colors"
                        >
                          Sign in
                        </button>
                      </>
                    )}
                  </p>
                </motion.form>
              )}

              {tab === "google" && (
                <motion.div
                  key="google-form"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-4"
                >
                  <Button
                    onClick={handleGoogleSignIn}
                    disabled={googleLoading}
                    className="w-full bg-white hover:bg-slate-50 text-slate-900 border-2 border-white/20 h-12 font-semibold shadow-lg hover:shadow-xl transition-all"
                  >
                    {googleLoading ? (
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    ) : (
                      <Chrome className="mr-2 h-5 w-5" />
                    )}
                    {googleLoading ? "Redirecting…" : "Continue with Google"}
                  </Button>
                  <p className="text-xs text-center text-slate-400">
                    A new account is created automatically on first sign-in.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Trust badges */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="flex items-center justify-center gap-6 mt-8 pt-6 border-t border-white/10"
            >
              {[
                { icon: Shield, label: "KYC/AML" },
                { icon: Lock, label: "Encrypted" },
                { icon: CheckCircle, label: "Compliant" },
              ].map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                  className="flex items-center gap-1.5 text-xs text-slate-400 group cursor-default"
                >
                  <item.icon className="h-4 w-4 text-sky-400 group-hover:text-sky-300 transition-colors" />
                  <span className="font-medium">{item.label}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.div>

        {/* Mobile features — shown below form on mobile */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="xl:hidden absolute bottom-8 left-0 right-0 px-4"
        >
          <div className="max-w-md mx-auto grid grid-cols-3 gap-3">
            {[
              { icon: Zap, label: "Fast" },
              { icon: Shield, label: "Secure" },
              { icon: TrendingUp, label: "Analytics" },
            ].map((item) => (
              <div
                key={item.label}
                className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-xl p-3 text-center"
              >
                <div className="w-8 h-8 mx-auto mb-1.5 rounded-lg bg-sky-500/10 flex items-center justify-center">
                  <item.icon className="h-4 w-4 text-sky-400" />
                </div>
                <p className="text-xs font-medium text-slate-300">{item.label}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
