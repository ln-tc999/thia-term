"use client";

import { useState, useCallback, type ChangeEvent } from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface FilterOption {
  label: string;
  value: string;
}

interface FilterConfig {
  id: string;
  label: string;
  options: FilterOption[];
}

interface SearchBarProps {
  placeholder?: string;
  filters?: FilterConfig[];
  onSearch?: (query: string) => void;
  onFilterChange?: (filters: Record<string, string>) => void;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function SearchBar({
  placeholder = "Search...",
  filters = [],
  onSearch,
  onFilterChange,
  className,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);

  const handleQueryChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      onSearch?.(value);
    },
    [onSearch]
  );

  const handleFilterChange = useCallback(
    (filterId: string, value: string) => {
      const next = { ...activeFilters, [filterId]: value };
      if (value === "" || value === "all") {
        delete next[filterId];
      }
      setActiveFilters(next);
      onFilterChange?.(next);
    },
    [activeFilters, onFilterChange]
  );

  const handleClear = useCallback(() => {
    setQuery("");
    setActiveFilters({});
    onSearch?.("");
    onFilterChange?.({});
  }, [onSearch, onFilterChange]);

  const hasActiveFilters = Object.keys(activeFilters).length > 0 || query.length > 0;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2">
        {/* Search input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder={placeholder}
            className={cn(
              "flex h-10 w-full rounded-md border border-input bg-background/50 pl-9 pr-3 py-2 text-sm",
              "ring-offset-background placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "transition-colors"
            )}
          />
        </div>

        {/* Filter toggle */}
        {filters.length > 0 && (
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-input px-3 h-10 text-sm transition-colors",
              showFilters
                ? "bg-primary/15 text-primary border-primary/30"
                : "bg-background/50 text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {Object.keys(activeFilters).length > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {Object.keys(activeFilters).length}
              </span>
            )}
          </button>
        )}

        {/* Clear button */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1 rounded-md px-3 h-10 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Filter dropdowns */}
      {showFilters && filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/40 bg-secondary/10 p-3">
          {filters.map((filter) => (
            <div key={filter.id} className="flex items-center gap-2">
              <label
                htmlFor={`filter-${filter.id}`}
                className="text-xs font-medium text-muted-foreground whitespace-nowrap"
              >
                {filter.label}
              </label>
              <select
                id={`filter-${filter.id}`}
                value={activeFilters[filter.id] ?? "all"}
                onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                className={cn(
                  "rounded-md border border-input bg-background/50 px-2 py-1.5 text-sm",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "transition-colors"
                )}
              >
                <option value="all">All</option>
                {filter.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export type { FilterConfig, FilterOption, SearchBarProps };
