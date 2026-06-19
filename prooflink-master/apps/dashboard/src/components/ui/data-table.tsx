"use client";

import { useState, useMemo, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Inbox,
} from "lucide-react";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";

// ─── Types ─────────────────────────────────────────────────────────────────────

type SortDirection = "asc" | "desc" | null;

interface ColumnDef<T> {
  id: string;
  header: string;
  accessor: (row: T) => ReactNode;
  sortKey?: (row: T) => string | number;
  className?: string;
}

interface RowAction<T> {
  label: string;
  onClick: (row: T) => void;
  destructive?: boolean;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  rowKey: (row: T) => string;
  rowActions?: RowAction<T>[];
  pageSize?: number;
  emptyIcon?: ReactNode;
  emptyMessage?: string;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function DataTable<T>({
  data,
  columns,
  rowKey,
  rowActions,
  pageSize = 10,
  emptyIcon,
  emptyMessage = "No results found",
  className,
}: DataTableProps<T>) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>(null);
  const [page, setPage] = useState(0);
  const [openActionRow, setOpenActionRow] = useState<string | null>(null);

  const handleSort = useCallback(
    (colId: string) => {
      if (sortCol === colId) {
        if (sortDir === "asc") setSortDir("desc");
        else if (sortDir === "desc") {
          setSortCol(null);
          setSortDir(null);
        }
      } else {
        setSortCol(colId);
        setSortDir("asc");
      }
      setPage(0);
    },
    [sortCol, sortDir]
  );

  const sorted = useMemo(() => {
    if (!sortCol || !sortDir) return data;
    const col = columns.find((c) => c.id === sortCol);
    if (!col?.sortKey) return data;
    const key = col.sortKey;
    return [...data].sort((a, b) => {
      const aVal = key(a);
      const bVal = key(b);
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortCol, sortDir, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const SortIcon = ({ colId }: { colId: string }) => {
    if (sortCol !== colId) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/40" />;
    if (sortDir === "asc") return <ChevronUp className="h-3.5 w-3.5 text-primary" />;
    return <ChevronDown className="h-3.5 w-3.5 text-primary" />;
  };

  if (data.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
        {emptyIcon ?? <Inbox className="h-10 w-10 text-muted-foreground/30 mb-3" />}
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.id} className={col.className}>
                {col.sortKey ? (
                  <button
                    type="button"
                    onClick={() => handleSort(col.id)}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    {col.header}
                    <SortIcon colId={col.id} />
                  </button>
                ) : (
                  col.header
                )}
              </TableHead>
            ))}
            {rowActions && rowActions.length > 0 && (
              <TableHead className="w-12" />
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.map((row) => {
            const key = rowKey(row);
            return (
              <TableRow key={key}>
                {columns.map((col) => (
                  <TableCell key={col.id} className={col.className}>
                    {col.accessor(row)}
                  </TableCell>
                ))}
                {rowActions && rowActions.length > 0 && (
                  <TableCell>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setOpenActionRow(openActionRow === key ? null : key)}
                        className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                        aria-label="Row actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {openActionRow === key && (
                        <div className="absolute right-0 top-8 z-50 min-w-[140px] rounded-lg border border-border bg-card p-1 shadow-2xl">
                          {rowActions.map((action) => (
                            <button
                              key={action.label}
                              type="button"
                              onClick={() => {
                                action.onClick(row);
                                setOpenActionRow(null);
                              }}
                              className={cn(
                                "flex w-full items-center rounded-md px-3 py-1.5 text-sm transition-colors",
                                action.destructive
                                  ? "text-red-400 hover:bg-red-500/10"
                                  : "text-foreground hover:bg-secondary/60"
                              )}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 text-sm text-muted-foreground">
          <span>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of{" "}
            {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded p-1.5 hover:bg-secondary/60 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded p-1.5 hover:bg-secondary/60 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export type { ColumnDef, RowAction, DataTableProps };
