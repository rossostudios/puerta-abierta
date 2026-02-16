"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

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
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency, humanizeKey } from "@/lib/format";
import type { Locale } from "@/lib/i18n";

type MonthData = {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
  collections_scheduled: number;
  collections_paid: number;
  collection_rate: number;
};

type ExpenseCategory = {
  category: string;
  total: number;
};

type FinanceDashboardProps = {
  months: MonthData[];
  expenseBreakdown: ExpenseCategory[];
  outstandingCollections: Record<string, unknown>[];
  locale: Locale;
  filterFrom: string;
  filterTo: string;
  filterPropertyId: string;
  properties: Record<string, unknown>[];
};

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "hsl(210 70% 55%)",
  "hsl(40 90% 55%)",
  "hsl(330 70% 55%)",
];

function asNumber(val: unknown): number {
  if (typeof val === "number") return val;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function asString(val: unknown): string {
  if (typeof val === "string") return val;
  return String(val ?? "");
}

export function FinanceDashboard({
  months,
  expenseBreakdown,
  outstandingCollections,
  locale,
  filterFrom,
  filterTo,
  filterPropertyId,
  properties,
}: FinanceDashboardProps) {
  const isEn = locale === "en-US";
  const router = useRouter();

  const [from, setFrom] = useState(filterFrom);
  const [to, setTo] = useState(filterTo);
  const [propId, setPropId] = useState(filterPropertyId);

  const propertyOptions = useMemo(() => {
    return properties
      .map((p) => {
        const id = asString(p.id).trim();
        if (!id) return null;
        return { id, label: asString(p.name).trim() || id };
      })
      .filter((p): p is { id: string; label: string } => Boolean(p));
  }, [properties]);

  const applyFilters = useCallback(() => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (propId) qs.set("property_id", propId);
    const suffix = qs.toString();
    router.push(suffix ? `?${suffix}` : "?");
  }, [from, to, propId, router]);

  const applyPreset = useCallback(
    (months: number) => {
      const now = new Date();
      const newTo = now.toISOString().slice(0, 10);
      const newFrom = new Date(now.getFullYear(), now.getMonth() - months + 1, 1)
        .toISOString()
        .slice(0, 10);
      setFrom(newFrom);
      setTo(newTo);
      const qs = new URLSearchParams();
      qs.set("from", newFrom);
      qs.set("to", newTo);
      if (propId) qs.set("property_id", propId);
      router.push(`?${qs.toString()}`);
    },
    [propId, router]
  );

  // Summary KPIs
  const totals = useMemo(() => {
    let revenue = 0;
    let expenses = 0;
    let scheduled = 0;
    let paid = 0;
    for (const m of months) {
      revenue += m.revenue;
      expenses += m.expenses;
      scheduled += m.collections_scheduled;
      paid += m.collections_paid;
    }
    const collectionRate = scheduled > 0 ? paid / scheduled : 0;
    return {
      revenue,
      expenses,
      net: revenue - expenses,
      collectionRate,
      outstanding: outstandingCollections.length,
    };
  }, [months, outstandingCollections]);

  // Revenue vs expenses chart config
  const revenueConfig: ChartConfig = {
    revenue: {
      label: isEn ? "Revenue" : "Ingresos",
      color: "var(--chart-1)",
    },
    expenses: {
      label: isEn ? "Expenses" : "Gastos",
      color: "var(--chart-3)",
    },
    net: {
      label: isEn ? "Net" : "Neto",
      color: "var(--chart-2)",
    },
  };

  // Collection rate chart config
  const collectionConfig: ChartConfig = {
    collection_rate: {
      label: isEn ? "Collection rate" : "Tasa de cobro",
      color: "var(--chart-2)",
    },
  };

  // Expense breakdown config
  const breakdownConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    for (const [i, item] of expenseBreakdown.entries()) {
      cfg[item.category] = {
        label: humanizeKey(item.category),
        color: PIE_COLORS[i % PIE_COLORS.length],
      };
    }
    return cfg;
  }, [expenseBreakdown]);

  const breakdownData = useMemo(
    () =>
      expenseBreakdown.map((item, i) => ({
        ...item,
        fill: PIE_COLORS[i % PIE_COLORS.length],
      })),
    [expenseBreakdown]
  );

  const collectionData = useMemo(
    () =>
      months.map((m) => ({
        month: m.month,
        collection_rate: Math.round(m.collection_rate * 100),
      })),
    [months]
  );

  const hasRevenue = months.some(
    (m) => m.revenue > 0 || m.expenses > 0
  );
  const hasBreakdown = expenseBreakdown.some((item) => item.total > 0);
  const hasCollections = months.some((m) => m.collections_scheduled > 0);

  return (
    <div className="space-y-6">
      {/* Filter toolbar */}
      <section className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          <Button
            onClick={() => applyPreset(1)}
            size="sm"
            type="button"
            variant="outline"
          >
            {isEn ? "This month" : "Este mes"}
          </Button>
          <Button
            onClick={() => applyPreset(3)}
            size="sm"
            type="button"
            variant="outline"
          >
            {isEn ? "3 months" : "3 meses"}
          </Button>
          <Button
            onClick={() => applyPreset(6)}
            size="sm"
            type="button"
            variant="outline"
          >
            {isEn ? "6 months" : "6 meses"}
          </Button>
          <Button
            onClick={() => applyPreset(12)}
            size="sm"
            type="button"
            variant="outline"
          >
            {isEn ? "1 year" : "1 año"}
          </Button>
        </div>

        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground text-xs">
            {isEn ? "From" : "Desde"}
          </span>
          <DatePicker
            locale={locale}
            onValueChange={setFrom}
            value={from}
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground text-xs">
            {isEn ? "To" : "Hasta"}
          </span>
          <DatePicker
            locale={locale}
            onValueChange={setTo}
            value={to}
          />
        </label>

        {propertyOptions.length > 0 ? (
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground text-xs">
              {isEn ? "Property" : "Propiedad"}
            </span>
            <Select
              onChange={(e) => setPropId(e.target.value)}
              value={propId}
            >
              <option value="">{isEn ? "All" : "Todas"}</option>
              {propertyOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        <Button onClick={applyFilters} size="sm" type="button">
          {isEn ? "Apply" : "Aplicar"}
        </Button>
      </section>

      {/* KPI cards */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label={isEn ? "Total revenue" : "Ingresos totales"}
          value={formatCurrency(totals.revenue, "PYG", locale)}
        />
        <StatCard
          label={isEn ? "Total expenses" : "Gastos totales"}
          value={formatCurrency(totals.expenses, "PYG", locale)}
        />
        <StatCard
          label={isEn ? "Net payout" : "Pago neto"}
          value={formatCurrency(totals.net, "PYG", locale)}
        />
        <StatCard
          label={isEn ? "Collection rate" : "Tasa de cobro"}
          value={`${(totals.collectionRate * 100).toFixed(1)}%`}
        />
        <StatCard
          label={isEn ? "Outstanding" : "Pendientes"}
          value={String(totals.outstanding)}
        />
      </section>

      {/* P&L Summary */}
      <Card className="overflow-hidden border-border/80">
        <CardHeader className="space-y-1 border-border/70 border-b pb-4">
          <CardTitle className="text-base">
            {isEn ? "P&L Summary" : "Resumen P&G"}
          </CardTitle>
          <CardDescription>
            {from} — {to}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-2 font-mono text-sm">
            <div className="flex justify-between">
              <span>
                {isEn ? "Revenue (collections paid)" : "Ingresos (cobros pagados)"}
              </span>
              <span className="font-medium">
                {formatCurrency(totals.revenue, "PYG", locale)}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>- {isEn ? "Expenses" : "Gastos"}</span>
              <span>({formatCurrency(totals.expenses, "PYG", locale)})</span>
            </div>
            <hr className="border-border" />
            <div className="flex justify-between font-bold">
              <span>
                {isEn ? "Net Operating Income" : "Ingreso Operativo Neto"}
              </span>
              <span
                className={
                  totals.net >= 0 ? "text-emerald-600" : "text-destructive"
                }
              >
                {formatCurrency(totals.net, "PYG", locale)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Charts row */}
      <section className="grid gap-4 lg:grid-cols-2">
        {/* Revenue vs Expenses */}
        <Card className="overflow-hidden border-border/80">
          <CardHeader className="space-y-1 border-border/70 border-b pb-4">
            <CardTitle className="text-base">
              {isEn ? "Revenue vs Expenses" : "Ingresos vs Gastos"}
            </CardTitle>
            <CardDescription>
              {from} — {to}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 pt-4">
            {hasRevenue ? (
              <ChartContainer className="h-64 w-full" config={revenueConfig}>
                <BarChart data={months} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="month"
                    tickLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    axisLine={false}
                    tickFormatter={(v) =>
                      formatCurrency(v, "PYG", locale)
                    }
                    tickLine={false}
                    tickMargin={8}
                    width={72}
                  />
                  <ChartTooltip
                    content={(props) => (
                      <ChartTooltipContent
                        {...props}
                        valueFormatter={(v) =>
                          formatCurrency(v, "PYG", locale)
                        }
                      />
                    )}
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  />
                  <Bar
                    dataKey="revenue"
                    fill="var(--color-revenue)"
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
              <p className="py-12 text-center text-muted-foreground text-sm">
                {isEn
                  ? "No revenue data for this period."
                  : "Sin datos de ingresos para este período."}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Collection Rate Trend */}
        <Card className="overflow-hidden border-border/80">
          <CardHeader className="space-y-1 border-border/70 border-b pb-4">
            <CardTitle className="text-base">
              {isEn ? "Collection Rate Trend" : "Tendencia de Cobro"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Percentage of paid vs scheduled"
                : "Porcentaje de pagados vs programados"}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 pt-4">
            {hasCollections ? (
              <ChartContainer
                className="h-64 w-full"
                config={collectionConfig}
              >
                <AreaChart data={collectionData} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="month"
                    tickLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    axisLine={false}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tickLine={false}
                    tickMargin={8}
                    width={40}
                  />
                  <ChartTooltip
                    content={(props) => (
                      <ChartTooltipContent
                        {...props}
                        valueFormatter={(v) => `${v}%`}
                      />
                    )}
                  />
                  <defs>
                    <linearGradient
                      id="fillRate"
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="var(--color-collection_rate)"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="var(--color-collection_rate)"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  </defs>
                  <Area
                    dataKey="collection_rate"
                    fill="url(#fillRate)"
                    stroke="var(--color-collection_rate)"
                    strokeWidth={2}
                    type="monotone"
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <p className="py-12 text-center text-muted-foreground text-sm">
                {isEn
                  ? "No collection data for this period."
                  : "Sin datos de cobro para este período."}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {/* Expense Breakdown Pie */}
        <Card className="overflow-hidden border-border/80">
          <CardHeader className="space-y-1 border-border/70 border-b pb-4">
            <CardTitle className="text-base">
              {isEn ? "Expense Breakdown" : "Desglose de Gastos"}
            </CardTitle>
            <CardDescription>
              {isEn ? "By category" : "Por categoría"}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 pt-4">
            {hasBreakdown ? (
              <ChartContainer
                className="mx-auto h-64 w-full max-w-sm"
                config={breakdownConfig}
              >
                <PieChart>
                  <ChartTooltip
                    content={(props) => (
                      <ChartTooltipContent
                        {...props}
                        headerFormatter={() =>
                          isEn ? "Expenses" : "Gastos"
                        }
                        valueFormatter={(v) =>
                          formatCurrency(v, "PYG", locale)
                        }
                      />
                    )}
                  />
                  <Pie
                    data={breakdownData}
                    dataKey="total"
                    innerRadius={50}
                    nameKey="category"
                    outerRadius={90}
                    paddingAngle={3}
                    stroke="var(--background)"
                    strokeWidth={2}
                  >
                    {breakdownData.map((entry) => (
                      <Cell fill={entry.fill} key={entry.category} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            ) : (
              <p className="py-12 text-center text-muted-foreground text-sm">
                {isEn
                  ? "No expense data for this period."
                  : "Sin datos de gastos para este período."}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Outstanding Collections Table */}
        <Card className="overflow-hidden border-border/80">
          <CardHeader className="space-y-1 border-border/70 border-b pb-4">
            <CardTitle className="text-base">
              {isEn ? "Outstanding Collections" : "Cobros Pendientes"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Unpaid or overdue"
                : "Sin pagar o vencidos"}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 pt-4">
            {outstandingCollections.length > 0 ? (
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground text-xs">
                      <th className="pb-2 font-medium">
                        {isEn ? "Due date" : "Vencimiento"}
                      </th>
                      <th className="pb-2 font-medium">
                        {isEn ? "Amount" : "Monto"}
                      </th>
                      <th className="pb-2 font-medium">
                        {isEn ? "Status" : "Estado"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstandingCollections.map((c, i) => (
                      <tr className="border-b border-border/50" key={i}>
                        <td className="py-2 tabular-nums">
                          {asString(c.due_date)}
                        </td>
                        <td className="py-2 tabular-nums">
                          {formatCurrency(
                            asNumber(c.amount),
                            asString(c.currency) || "PYG",
                            locale
                          )}
                        </td>
                        <td className="py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              asString(c.status) === "overdue"
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                            }`}
                          >
                            {humanizeKey(asString(c.status))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-12 text-center text-muted-foreground text-sm">
                {isEn
                  ? "No outstanding collections."
                  : "Sin cobros pendientes."}
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
