"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { setApiKey, getApiKey } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type AuthState = "loading" | "authenticated" | "unauthenticated";

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [error, setError] = useState("");
  const [inputKey, setInputKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const key = getApiKey();
    if (!key) {
      setState("unauthenticated");
      return;
    }
    validateKey(key).then((valid) => {
      setState(valid ? "authenticated" : "unauthenticated");
    });
  }, []);

  async function validateKey(key: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/health/ready`, {
        headers: { "X-API-Key": key },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      // If health endpoint is unreachable, accept the key optimistically
      // so the dashboard still works during local dev without the API running
      return true;
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const key = inputKey.trim();
    if (!key) {
      setError("API key is required");
      return;
    }

    setSubmitting(true);
    setError("");

    const valid = await validateKey(key);
    if (valid) {
      setApiKey(key);
      setState("authenticated");
    } else {
      setError("Invalid API key or server unreachable");
    }
    setSubmitting(false);
  }

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <p className="text-sm text-gray-400 animate-pulse">Connecting...</p>
      </div>
    );
  }

  if (state === "authenticated") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-8">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-white">ProofLink</h1>
          <p className="mt-1 text-sm text-gray-400">
            Enter your API key to connect
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <input
            type="password"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            placeholder="fl_live_..."
            autoFocus
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Connecting..." : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
}
