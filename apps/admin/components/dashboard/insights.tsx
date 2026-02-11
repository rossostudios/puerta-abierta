"use client";

import { ChartIcon, Task01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, humanizeKey } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type RevenueSnapshot = {
  periodLabel: string;
  currency: string;
  gross: number;
  expenses: number;
  net: number;
};

export type StatusCount = {
  status: string;
  count: number;
};

type DashboardInsightsProps = {
  revenue: RevenueSnapshot | null;
  taskStatuses: StatusCount[];
  locale: Locale;
};

const SANITIZE_KEY_RE = /[^a-zA-Z0-9_-]/g;

function sanitizeKey(value: string): string {
  return value.replaceAll(SANITIZE_KEY_RE, "-");
}

const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function DashboardInsights({
  revenue,
  taskStatuses,
  locale: localeProp,
}: DashboardInsightsProps) {
  const activeLocale = useActiveLocale();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Use the server-provided locale for SSR + hydration to avoid mismatches.
  // After mount, prefer the active locale (storage/context) so toggles feel instant.
  const locale = mounted ? activeLocale : localeProp;
  const isEn = locale === "en-US";

  const revenueData = useMemo(() => {
    if (!revenue) return [];
    return [
      {
        period: revenue.periodLabel,
        gross: revenue.gross,
        expenses: revenue.expenses,
        net: revenue.net,
      },
    ];
  }, [revenue]);

  const revenueConfig: ChartConfig = {
    gross: {
      label: isEn ? "Gross revenue" : "Ingresos brutos",
      color: "var(--chart-1)",
    },
    expenses: {
      label: isEn ? "Expenses" : "Gastos",
      color: "var(--chart-3)",
    },
    net: { label: isEn ? "Net payout" : "Pago neto", color: "var(--chart-2)" },
  };

  const taskConfig = useMemo<ChartConfig>(() => {
    const next: ChartConfig = {};
    for (const [index, item] of taskStatuses.entries()) {
      next[item.status] = {
        label: humanizeKey(item.status),
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      };
    }
    return next;
  }, [taskStatuses]);

  const taskData = useMemo(() => {
    return taskStatuses.map((item) => {
      const safe = sanitizeKey(item.status);
      return {
        status: item.status,
        count: item.count,
        fill: `var(--color-${safe})`,
      };
    });
  }, [taskStatuses]);

  const hasRevenue = Boolean(
    revenue && (revenue.gross > 0 || revenue.expenses > 0 || revenue.net > 0)
  );
  const hasTaskData = taskStatuses.some((item) => item.count > 0);

  const taskCount = taskStatuses.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">
                {isEn ? "Revenue snapshot" : "Resumen de ingresos"}
              </CardTitle>
              <CardDescription>
                {isEn ? "Monthly summary" : "Resumen del mes"}
              </CardDescription>
            </div>
            {revenue ? (
              <Badge className="font-mono text-[11px]" variant="secondary">
                {revenue.currency}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          {hasRevenue ? (
            <ChartContainer className="h-56 w-full" config={revenueConfig}>
              <BarChart data={revenueData} margin={{ left: 12, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="period"
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  axisLine={false}
                  tickFormatter={(value) =>
                    formatCurrency(value, revenue?.currency ?? "PYG", locale)
                  }
                  tickLine={false}
                  tickMargin={10}
                  width={56}
                />
                <ChartTooltip
                  content={(props) => (
                    <ChartTooltipContent
                      {...props}
                      valueFormatter={(value) =>
                        formatCurrency(
                          value,
                          revenue?.currency ?? "PYG",
                          locale
                        )
                      }
                    />
                  )}
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                />
                <Bar
                  dataKey="gross"
                  fill="var(--color-gross)"
                  radius={[6, 6, 0, 0]}
                />
                <Bar
                  dataKey="expenses"
                  fill="var(--color-expenses)"
                  radius={[6, 6, 0, 0]}
                />
                <Bar
                  dataKey="net"
                  fill="var(--color-net)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <EmptyState
              action={
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                  href="/module/reservations"
                >
                  {isEn ? "Add a reservation →" : "Agregar una reserva →"}
                </Link>
              }
              description={
                isEn
                  ? "Revenue appears here once you record your first reservation."
                  : "Los ingresos aparecerán aquí cuando registres tu primera reserva."
              }
              icon={ChartIcon}
              title={isEn ? "No revenue to show yet" : "Aún no hay ingresos"}
            />
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">
                {isEn ? "Task status" : "Estado de tareas"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Operations queue health"
                  : "Salud de la cola operativa"}
              </CardDescription>
            </div>
            <Badge className="font-mono text-[11px]" variant="outline">
              {taskCount} {isEn ? "tasks" : "tareas"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          {hasTaskData ? (
            <ChartContainer className="h-56 w-full" config={taskConfig}>
              <PieChart>
                <ChartTooltip
                  content={(props) => (
                    <ChartTooltipContent
                      {...props}
                      headerFormatter={() => (isEn ? "Tasks" : "Tareas")}
                    />
                  )}
                />
                <Pie
                  data={taskData}
                  dataKey="count"
                  innerRadius={58}
                  nameKey="status"
                  outerRadius={86}
                  paddingAngle={3}
                  stroke="var(--background)"
                  strokeWidth={2}
                >
                  {taskData.map((entry) => (
                    <Cell fill={entry.fill} key={entry.status} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          ) : (
            <EmptyState
              action={
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                  href="/module/tasks"
                >
                  {isEn ? "Create a task →" : "Crear una tarea →"}
                </Link>
              }
              description={
                isEn
                  ? "Create a cleaning or maintenance task to see status breakdowns here."
                  : "Crea una tarea de limpieza o mantenimiento para ver el desglose aquí."
              }
              icon={Task01Icon}
              title={
                isEn
                  ? "Your task queue is empty"
                  : "Tu cola de tareas está vacía"
              }
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
