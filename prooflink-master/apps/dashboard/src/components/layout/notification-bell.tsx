"use client";

import { useState, useRef, useEffect } from "react";
import {
  Bell,
  AlertTriangle,
  XCircle,
  Webhook,
  CheckCircle2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  type: "sanctions_match" | "escalation" | "webhook_failure";
  title: string;
  message: string;
  time: string;
  read: boolean;
}

const mockNotifications: Notification[] = [
  {
    id: "n1",
    type: "sanctions_match",
    title: "Sanctions Match Detected",
    message: "Address 0x1a2b...3c4d matched OFAC SDN list entry",
    time: "2 min ago",
    read: false,
  },
  {
    id: "n2",
    type: "escalation",
    title: "Manual Review Required",
    message: "Transaction chk_0023 flagged for velocity limit breach",
    time: "15 min ago",
    read: false,
  },
  {
    id: "n3",
    type: "webhook_failure",
    title: "Webhook Delivery Failed",
    message: "Endpoint https://api.example.com returned 503",
    time: "1h ago",
    read: false,
  },
  {
    id: "n4",
    type: "sanctions_match",
    title: "Sanctions Match Detected",
    message: "Address 0x9f8e...7d6c associated with sanctioned entity",
    time: "3h ago",
    read: true,
  },
  {
    id: "n5",
    type: "escalation",
    title: "High Risk Transaction",
    message: "Risk score 87 on $45,000 USDC transfer",
    time: "5h ago",
    read: true,
  },
];

function getNotificationIcon(type: Notification["type"]) {
  switch (type) {
    case "sanctions_match":
      return <XCircle className="h-4 w-4 text-red-400" />;
    case "escalation":
      return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    case "webhook_failure":
      return <Webhook className="h-4 w-4 text-orange-400" />;
  }
}

function getNotificationColor(type: Notification["type"]): string {
  switch (type) {
    case "sanctions_match":
      return "border-l-red-500";
    case "escalation":
      return "border-l-amber-500";
    case "webhook_failure":
      return "border-l-orange-500";
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(mockNotifications);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const dismissNotification = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Notifications"
        onClick={() => setOpen(!open)}
        className="relative"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 rounded-xl border border-border/50 bg-card/95 backdrop-blur-xl shadow-2xl z-50 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
            <h3 className="text-sm font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-muted-foreground/30 mb-2" />
                <p className="text-sm text-muted-foreground">All caught up!</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={cn(
                    "flex items-start gap-3 border-l-2 px-4 py-3 hover:bg-secondary/30 transition-colors group",
                    getNotificationColor(notification.type),
                    !notification.read && "bg-secondary/10"
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={cn(
                        "text-sm leading-tight",
                        !notification.read ? "font-semibold" : "font-medium"
                      )}>
                        {notification.title}
                      </p>
                      {!notification.read && (
                        <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {notification.message}
                    </p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1">
                      {notification.time}
                    </p>
                  </div>
                  <button
                    onClick={() => dismissNotification(notification.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border/50 px-4 py-2.5">
            <button className="w-full text-center text-xs text-primary hover:text-primary/80 transition-colors">
              View all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
