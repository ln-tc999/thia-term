"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  type TooltipProps,
} from "recharts";
import { useId } from "react";
import type { VolumeDataPoint } from "@/lib/api";
import { formatCompactNumber, formatDateShort } from "@/lib/utils";

interface VolumeChartProps {
  data: VolumeDataPoint[];
}

function CustomTooltip({
  active,
  payload,
  label,
}: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-card/95 backdrop-blur-xl p-3 shadow-2xl">
      <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-sm">
          <div
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground capitalize">{entry.name}:</span>
          <span className="font-semibold tabular-nums">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function VolumeChart({ data }: VolumeChartProps) {
  const uid = useId();
  const passedId = `passedGradient-${uid}`;
  const failedId = `failedGradient-${uid}`;

  const formatted = data.map((d) => ({
    ...d,
    date: formatDateShort(d.date),
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart
        data={formatted}
        margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
      >
        <defs>
          <linearGradient id={passedId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="hsl(217, 91%, 60%)"
              stopOpacity={0.35}
            />
            <stop
              offset="95%"
              stopColor="hsl(217, 91%, 60%)"
              stopOpacity={0}
            />
          </linearGradient>
          <linearGradient id={failedId} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="hsl(0, 84%, 60%)"
              stopOpacity={0.25}
            />
            <stop
              offset="95%"
              stopColor="hsl(0, 84%, 60%)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(215, 25%, 13%)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fill: "hsl(215, 20%, 50%)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "hsl(215, 20%, 50%)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatCompactNumber(v)}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="passed"
          stroke="hsl(217, 91%, 60%)"
          strokeWidth={2}
          fill={`url(#${passedId})`}
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="failed"
          stroke="hsl(0, 84%, 60%)"
          strokeWidth={2}
          fill={`url(#${failedId})`}
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
