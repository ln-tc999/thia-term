"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Shield,
  LayoutDashboard,
  FileText,
  Search,
  Bot,
  Key,
  ChevronLeft,
  ChevronRight,
  Zap,
  Sparkles,
  Settings,
  BarChart3,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { Header } from "./header";

// ─── Context ─────────────────────────────────────────────────────────────────

interface SidebarContextValue {
  collapsed: boolean;
  mobileOpen: boolean;
}

const SidebarContext = createContext<SidebarContextValue>({ collapsed: false, mobileOpen: false });

// ─── Nav items ───────────────────────────────────────────────────────────────

interface NavSection {
  title: string;
  items: { href: string; label: string; icon: typeof LayoutDashboard }[];
}

const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Compliance",
    items: [
      { href: "/compliance", label: "Compliance", icon: Shield },
      { href: "/screen", label: "Screen", icon: Search },
      { href: "/invoices", label: "Invoices", icon: FileText },
    ],
  },
  {
    title: "Management",
    items: [
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/api-keys", label: "API Keys", icon: Key },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

// Flat list for mobile sidebar
const navItems = navSections.flatMap((s) => s.items);

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({
  onCollapsedChange,
  onMobileClose,
}: {
  onCollapsedChange: (v: boolean) => void;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const { collapsed, mobileOpen } = useContext(SidebarContext);

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        aria-label="Main navigation"
        className={cn(
          "fixed left-0 top-0 z-40 flex h-full flex-col border-r border-border/40 bg-card/90 backdrop-blur-2xl transition-all duration-300",
          // Desktop
          "hidden lg:flex",
          collapsed ? "w-[68px]" : "w-[240px]"
        )}
      >
        <SidebarContent collapsed={collapsed} pathname={pathname} onCollapsedChange={onCollapsedChange} />
      </aside>

      {/* Mobile sidebar */}
      <aside
        aria-label="Mobile navigation"
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-[280px] flex-col border-r border-border/40 bg-card backdrop-blur-2xl transition-transform duration-300 lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between h-16 border-b border-border/40 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-teal-600 shadow-lg shadow-blue-500/25">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight gradient-text">ProofLink</span>
          </div>
          <button onClick={onMobileClose} className="p-2 text-muted-foreground hover:text-foreground" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 p-3 pt-4" role="navigation">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Navigation</p>
          {navItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onMobileClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 relative",
                  isActive
                    ? "bg-primary/15 text-primary shadow-sm"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                )}
              >
                {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />}
                <item.icon className={cn("h-5 w-5 shrink-0", isActive && "text-primary")} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border/40 p-3">
          <button
            onClick={() => {
              localStorage.removeItem("prooflink_api_key");
              window.location.reload();
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Disconnect</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function SidebarContent({
  collapsed,
  pathname,
  onCollapsedChange,
}: {
  collapsed: boolean;
  pathname: string;
  onCollapsedChange: (v: boolean) => void;
}) {
  return (
    <>
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-border/40 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-teal-600 shadow-lg shadow-blue-500/25">
          <Zap className="h-5 w-5 text-white" aria-hidden="true" />
        </div>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight gradient-text">
              ProofLink
            </span>
            <span className="rounded-full bg-blue-500/15 border border-blue-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400 uppercase tracking-wider">
              Beta
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3 pt-4 overflow-y-auto" role="navigation">
        {navSections.map((section) => (
          <div key={section.title} className="mb-3">
            {!collapsed && (
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {section.title}
              </p>
            )}
            {section.items.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 relative",
                    isActive
                      ? "bg-primary/15 text-primary shadow-sm"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  )}
                >
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
                  )}
                  <item.icon
                    className={cn("h-5 w-5 shrink-0", isActive && "text-primary")}
                    aria-hidden="true"
                  />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Environment / Status */}
      {!collapsed && (
        <div className="mx-3 mb-3 rounded-lg bg-gradient-to-r from-blue-500/10 to-teal-500/10 border border-blue-500/20 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
            <span className="text-xs font-semibold text-blue-400">x402 Protocol</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-tight">
            Compliance middleware active on Base, Ethereum, Polygon
          </p>
        </div>
      )}

      {/* Disconnect + Collapse toggle */}
      <div className="border-t border-border/40 p-3 space-y-1">
        <button
          onClick={() => {
            localStorage.removeItem("prooflink_api_key");
            window.location.reload();
          }}
          aria-label="Disconnect"
          title={collapsed ? "Disconnect" : undefined}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          {!collapsed && <span>Disconnect</span>}
        </button>
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </>
  );
}

// ─── SidebarLayout ───────────────────────────────────────────────────────────

export function SidebarLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on route change
  const pathname = usePathname();
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <SidebarContext.Provider value={{ collapsed, mobileOpen }}>
      <div className="flex min-h-screen">
        <Sidebar onCollapsedChange={setCollapsed} onMobileClose={() => setMobileOpen(false)} />
        <div
          className={cn(
            "flex-1 transition-all duration-300",
            "lg:pl-[240px]",
            collapsed && "lg:pl-[68px]"
          )}
        >
          {/* Mobile menu button */}
          <div className="lg:hidden sticky top-0 z-30 flex h-12 items-center border-b border-border/40 bg-background/80 backdrop-blur-2xl px-4">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 text-muted-foreground hover:text-foreground"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="ml-3 flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-blue-500 to-teal-600">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-bold gradient-text">ProofLink</span>
            </div>
          </div>
          <Header />
          <main className="p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}
