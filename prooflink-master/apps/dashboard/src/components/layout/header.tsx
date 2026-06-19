"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings, User, Moon, Sun, LogOut, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "./breadcrumbs";
import { NotificationBell } from "./notification-bell";

function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  const toggle = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle("dark");
  };

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function UserDropdown() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="ml-2 flex items-center gap-2 rounded-lg border border-border/40 bg-secondary/40 px-3 py-1.5 hover:bg-secondary/60 transition-colors"
      >
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-teal-600"
          aria-hidden="true"
        >
          <User className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="hidden sm:block text-left">
          <p className="text-sm font-medium leading-none">Akash</p>
          <p className="text-xs text-muted-foreground">Admin</p>
        </div>
        <ChevronDown className="h-3 w-3 text-muted-foreground hidden sm:block" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-48 rounded-xl border border-border/50 bg-card/95 backdrop-blur-xl shadow-2xl py-1">
            <Link
              href="/settings"
              className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-secondary/30 transition-colors"
              onClick={() => setOpen(false)}
            >
              <Settings className="h-4 w-4 text-muted-foreground" />
              Settings
            </Link>
            <div className="border-t border-border/50 my-1" />
            <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-secondary/30 transition-colors">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/40 bg-background/80 backdrop-blur-2xl px-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </div>
          <span className="text-xs font-medium text-emerald-400">Live</span>
        </div>
        <div className="h-4 w-px bg-border/50" />
        <Breadcrumbs />
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <NotificationBell />
        <Button variant="ghost" size="icon" aria-label="Settings" asChild>
          <Link href="/settings">
            <Settings className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <UserDropdown />
      </div>
    </header>
  );
}
