"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { DataTableRow } from "@/components/ui/data-table";
import { asString } from "@/lib/features/tasks/helpers";

type StatusCounts = {
  todo: number;
  in_progress: number;
  done: number;
  cancelled: number;
};

export function TaskCharts({
  isEn,
  locale,
  counts,
  rows,
}: {
  isEn: boolean;
  locale: "es-PY" | "en-US";
  counts: StatusCounts;
  rows: DataTableRow[];
}) {
  const statusChartData = useMemo(
    () => [
      {
        key: "todo",
        label: isEn ? "To do" : "Pendiente",
        count: counts.todo,
      },
      {
        key: "in_progress",
        label: isEn ? "In progress" : "En progreso",
        count: counts.in_progress,
      },
      {
        key: "done",
        label: isEn ? "Done" : "Hecha",
        count: counts.done,
      },
      {
        key: "cancelled",
        label: isEn ? "Cancelled" : "Cancelada",
        count: counts.cancelled,
      },
    ],
    [counts, isEn]
  );

  const statusChartConfig: ChartConfig = useMemo(
    () => ({
      todo: { label: isEn ? "To do" : "Pendiente", color: "var(--chart-1)" },
      in_progress: {
        label: isEn ? "In progress" : "En progreso",
        color: "var(--chart-2)",
      },
      done: { label: isEn ? "Done" : "Hecha", color: "var(--chart-3)" },
      cancelled: {
        label: isEn ? "Cancelled" : "Cancelada",
        color: "var(--chart-4)",
      },
    }),
    [isEn]
  );

  const slaTrendData = useMemo(() => {
    const dayLabels: string[] = [];
    const today = new Date();
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - index);
      dayLabels.push(date.toISOString().slice(0, 10));
    }

    const breachesByDay = new Map<string, number>(
      dayLabels.map((day) => [day, 0])
    );
    for (const row of rows) {
      const breachedAt = asString(row.sla_breached_at).trim();
      if (!breachedAt) continue;
      const day = breachedAt.slice(0, 10);
      if (!breachesByDay.has(day)) continue;
      breachesByDay.set(day, (breachesByDay.get(day) ?? 0) + 1);
    }

    return dayLabels.map((day) => {
      const parsed = new Date(`${day}T00:00:00`);
      return {
        day: Number.isNaN(parsed.valueOf())
          ? day
          : new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
            }).format(parsed),
        breaches: breachesByDay.get(day) ?? 0,
      };
    });
  }, [locale, rows]);

  const slaTrendConfig: ChartConfig = useMemo(
    () => ({
      breaches: {
        label: isEn ? "SLA breaches" : "SLA vencido",
        color: "var(--chart-5)",
      },
    }),
    [isEn]
  );

  return (
    <section className="grid gap-3 xl:grid-cols-2">
      <article className="glass-surface rounded-3xl p-3.5">
        <div className="mb-2">
          <p className="font-semibold text-sm">
            {isEn ? "Task distribution" : "Distribución de tareas"}
          </p>
          <p className="text-muted-foreground text-xs">
            {isEn ? "Status snapshot" : "Resumen por estado"}
          </p>
        </div>
        <ChartContainer className="h-48 w-full" config={statusChartConfig}>
          <BarChart data={statusChartData} margin={{ left: 2, right: 6 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              tickLine={false}
              tickMargin={8}
            />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
            <ChartTooltip
              content={(props) => (
                <ChartTooltipContent
                  {...props}
                  headerFormatter={() =>
                    isEn ? "Task status" : "Estado de tareas"
                  }
                />
              )}
            />
            <Bar dataKey="count" radius={[8, 8, 0, 0]}>
              {statusChartData.map((item) => (
                <Cell fill={`var(--color-${item.key})`} key={item.key} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </article>

      <article className="glass-surface rounded-3xl p-3.5">
        <div className="mb-2">
          <p className="font-semibold text-sm">
            {isEn ? "SLA breaches trend" : "Tendencia de SLA vencido"}
          </p>
          <p className="text-muted-foreground text-xs">
            {isEn ? "Last 7 days" : "Últimos 7 días"}
          </p>
        </div>
        <ChartContainer className="h-48 w-full" config={slaTrendConfig}>
          <LineChart data={slaTrendData} margin={{ left: 2, right: 6 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="day"
              tickLine={false}
              tickMargin={8}
            />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
            <ChartTooltip
              content={(props) => (
                <ChartTooltipContent
                  {...props}
                  headerFormatter={() =>
                    isEn ? "SLA breaches" : "SLA vencido"
                  }
                />
              )}
            />
            <Line
              dataKey="breaches"
              dot={{ r: 3 }}
              stroke="var(--color-breaches)"
              strokeWidth={2}
              type="monotone"
            />
          </LineChart>
        </ChartContainer>
      </article>
    </section>
  );
}
