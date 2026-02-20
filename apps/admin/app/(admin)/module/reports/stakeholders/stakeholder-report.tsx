"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { StakeholderReportPdfButton } from "@/components/reports/stakeholder-report-pdf";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { formatCurrency } from "@/lib/format";

type FinanceMonth = {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
  collections_scheduled: number;
  collections_paid: number;
  collection_rate: number;
};

type PropertySummaryRow = {
  property_id: string;
  property_name: string;
  income: number;
  expenses: number;
  net_payout: number;
  occupancy_rate: number;
};

type StakeholderReportProps = {
  locale: "es-PY" | "en-US";
  isEn: boolean;
  from: string;
  to: string;
  propertyId: string;
  properties: { id: string; name: string }[];
  ownerSummary: Record<string, unknown> | null;
  financeMonths: FinanceMonth[];
  outstandingCollections: Record<string, unknown>[];
  operationsSummary: Record<string, unknown> | null;
  kpiDashboard: Record<string, unknown> | null;
  propertySummaries: PropertySummaryRow[];
  orgName: string;
};

type PropertySummaryWithOutstanding = PropertySummaryRow & {
  outstanding_count: number;
  outstanding_amount: number;
};

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

export function StakeholderReport({
  locale,
  isEn,
  from,
  to,
  propertyId,
  properties,
  ownerSummary,
  financeMonths,
  outstandingCollections,
  operationsSummary,
  kpiDashboard,
  propertySummaries,
  orgName,
}: StakeholderReportProps) {
  const router = useRouter();

  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);
  const [selectedPropertyId, setSelectedPropertyId] = useState(propertyId);

  const totalsFromMonths = useMemo(() => {
    return financeMonths.reduce(
      (acc, month) => {
        acc.income += asNumber(month.revenue);
        acc.expenses += asNumber(month.expenses);
        acc.net += asNumber(month.net);
        acc.collectionRateSamples.push(asNumber(month.collection_rate));
        return acc;
      },
      {
        income: 0,
        expenses: 0,
        net: 0,
        collectionRateSamples: [] as number[],
      }
    );
  }, [financeMonths]);

  const income =
    asNumber(ownerSummary?.gross_revenue) > 0
      ? asNumber(ownerSummary?.gross_revenue)
      : totalsFromMonths.income;
  const expenses =
    asNumber(ownerSummary?.expenses) > 0
      ? asNumber(ownerSummary?.expenses)
      : totalsFromMonths.expenses;
  const netPayout =
    asNumber(ownerSummary?.net_payout) !== 0
      ? asNumber(ownerSummary?.net_payout)
      : totalsFromMonths.net;

  const occupancyRate =
    asNumber(ownerSummary?.occupancy_rate) > 0
      ? asNumber(ownerSummary?.occupancy_rate)
      : asNumber(kpiDashboard?.occupancy_rate);

  const collectionRate =
    asNumber(kpiDashboard?.collection_rate) > 0
      ? asNumber(kpiDashboard?.collection_rate)
      : totalsFromMonths.collectionRateSamples.length > 0
        ? totalsFromMonths.collectionRateSamples.reduce(
            (sum, value) => sum + value,
            0
          ) / totalsFromMonths.collectionRateSamples.length
        : 0;
  const avgDaysLate = asNumber(kpiDashboard?.avg_days_late);

  const openTasks = asNumber(operationsSummary?.open_tasks);
  const overdueTasks = asNumber(operationsSummary?.overdue_tasks);
  const slaBreaches = asNumber(operationsSummary?.sla_breached_tasks);
  const upcomingCheckIns = asNumber(
    operationsSummary?.reservations_upcoming_check_in
  );
  const upcomingCheckOuts = asNumber(
    operationsSummary?.reservations_upcoming_check_out
  );

  const trendData = useMemo(
    () =>
      financeMonths.map((month) => ({
        ...month,
        collection_rate_pct: Math.round(asNumber(month.collection_rate) * 100),
      })),
    [financeMonths]
  );

  const hasFinanceTrend = trendData.some(
    (point) => point.revenue > 0 || point.expenses > 0 || point.net !== 0
  );
  const hasCollectionTrend = trendData.some(
    (point) => point.collection_rate_pct > 0
  );

  const revenueConfig: ChartConfig = {
    revenue: {
      label: isEn ? "Income" : "Ingresos",
      color: "var(--chart-1)",
    },
    expenses: {
      label: isEn ? "Expenses" : "Gastos",
      color: "var(--chart-3)",
    },
    net: {
      label: isEn ? "Net payout" : "Liquidación neta",
      color: "var(--chart-2)",
    },
  };

  const collectionConfig: ChartConfig = {
    collection_rate_pct: {
      label: isEn ? "Collection rate" : "Tasa de cobro",
      color: "var(--chart-2)",
    },
  };

  const exceptions = useMemo(() => {
    const rows: Array<{ title: string; detail: string }> = [];

    if (slaBreaches > 0) {
      rows.push({
        title: isEn ? "SLA breaches" : "Incumplimientos de SLA",
        detail: isEn
          ? `${slaBreaches} tasks are currently in SLA breach.`
          : `${slaBreaches} tareas están en incumplimiento de SLA.`,
      });
    }

    if (overdueTasks > 0) {
      rows.push({
        title: isEn ? "Overdue tasks" : "Tareas vencidas",
        detail: isEn
          ? `${overdueTasks} operational tasks are overdue.`
          : `${overdueTasks} tareas operativas están vencidas.`,
      });
    }

    if (outstandingCollections.length > 0) {
      rows.push({
        title: isEn ? "Outstanding collections" : "Cobros pendientes",
        detail: isEn
          ? `${outstandingCollections.length} collections remain unpaid or late.`
          : `${outstandingCollections.length} cobros continúan impagos o vencidos.`,
      });
    }

    if (avgDaysLate >= 7) {
      rows.push({
        title: isEn ? "Late payment risk" : "Riesgo de pago tardío",
        detail: isEn
          ? `Average payment delay is ${avgDaysLate.toFixed(1)} days.`
          : `El atraso promedio de pago es ${avgDaysLate.toFixed(1)} días.`,
      });
    }

    return rows;
  }, [
    avgDaysLate,
    isEn,
    overdueTasks,
    outstandingCollections.length,
    slaBreaches,
  ]);

  const outstandingByProperty = useMemo(() => {
    const grouped = new Map<string, { count: number; amount: number }>();

    for (const row of outstandingCollections) {
      const propertyKey =
        asString(row.property_id).trim() || asString(row.propertyId).trim();
      if (!propertyKey) continue;
      const previous = grouped.get(propertyKey) ?? { count: 0, amount: 0 };
      previous.count += 1;
      previous.amount += asNumber(row.amount);
      grouped.set(propertyKey, previous);
    }

    return grouped;
  }, [outstandingCollections]);

  const propertyRows = useMemo<PropertySummaryWithOutstanding[]>(() => {
    return propertySummaries.map((row) => {
      const outstanding = outstandingByProperty.get(row.property_id) ?? {
        count: 0,
        amount: 0,
      };
      return {
        ...row,
        outstanding_count: outstanding.count,
        outstanding_amount: outstanding.amount,
      };
    });
  }, [outstandingByProperty, propertySummaries]);

  const applyFilters = useCallback(() => {
    const query = new URLSearchParams();
    if (fromDate) query.set("from", fromDate);
    if (toDate) query.set("to", toDate);
    if (selectedPropertyId) query.set("property_id", selectedPropertyId);
    router.push(`?${query.toString()}`);
  }, [fromDate, router, selectedPropertyId, toDate]);

  const periodLabel = `${fromDate} — ${toDate}`;
  const selectedPropertyLabel =
    properties.find((property) => property.id === selectedPropertyId)?.name ||
    (isEn ? "All properties" : "Todas las propiedades");
  const trendRows = useMemo(
    () =>
      trendData.slice(-6).map((point) => ({
        month: point.month,
        income: asNumber(point.revenue),
        expenses: asNumber(point.expenses),
        netPayout: asNumber(point.net),
        collectionRatePct: asNumber(point.collection_rate_pct),
      })),
    [trendData]
  );

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground text-xs">
            {isEn ? "From" : "Desde"}
          </span>
          <DatePicker
            locale={locale}
            onValueChange={setFromDate}
            value={fromDate}
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground text-xs">
            {isEn ? "To" : "Hasta"}
          </span>
          <DatePicker
            locale={locale}
            onValueChange={setToDate}
            value={toDate}
          />
        </label>

        {properties.length > 0 ? (
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground text-xs">
              {isEn ? "Property" : "Propiedad"}
            </span>
            <Select
              onChange={(event) => setSelectedPropertyId(event.target.value)}
              value={selectedPropertyId}
            >
              <option value="">{isEn ? "All" : "Todas"}</option>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}

        <Button onClick={applyFilters} size="sm" type="button">
          {isEn ? "Apply" : "Aplicar"}
        </Button>

        <StakeholderReportPdfButton
          exceptions={exceptions}
          isEn={isEn}
          kpis={{
            income,
            expenses,
            netPayout,
            occupancyRatePct: occupancyRate * 100,
            collectionRatePct: collectionRate * 100,
            slaBreaches,
            overdueTasks,
          }}
          locale={locale}
          orgName={orgName}
          periodLabel={periodLabel}
          propertyLabel={selectedPropertyLabel}
          propertyRows={propertyRows}
          trendRows={trendRows}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard
          label={isEn ? "Income" : "Ingresos"}
          value={formatCurrency(income, "PYG", locale)}
        />
        <StatCard
          label={isEn ? "Expenses" : "Gastos"}
          value={formatCurrency(expenses, "PYG", locale)}
        />
        <StatCard
          label={isEn ? "Net payout" : "Liquidación neta"}
          value={formatCurrency(netPayout, "PYG", locale)}
        />
        <StatCard
          label={isEn ? "Occupancy" : "Ocupación"}
          value={`${(occupancyRate * 100).toFixed(1)}%`}
        />
        <StatCard
          label={isEn ? "Collection rate" : "Tasa de cobro"}
          value={`${(collectionRate * 100).toFixed(1)}%`}
        />
        <StatCard
          helper={
            isEn
              ? `${overdueTasks} overdue tasks`
              : `${overdueTasks} tareas vencidas`
          }
          label={isEn ? "SLA risk" : "Riesgo SLA"}
          value={`${slaBreaches}`}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden border-border/80">
          <CardHeader className="space-y-1 border-border/70 border-b pb-4">
            <CardTitle className="text-base">
              {isEn
                ? "Income vs expenses trend"
                : "Tendencia ingresos vs gastos"}
            </CardTitle>
            <CardDescription>{periodLabel}</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 pt-4">
            {hasFinanceTrend ? (
              <ChartContainer className="h-64 w-full" config={revenueConfig}>
                <BarChart data={trendData} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="month"
                    tickLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    axisLine={false}
                    tickFormatter={(value) =>
                      formatCurrency(value, "PYG", locale)
                    }
                    tickLine={false}
                    tickMargin={8}
                    width={72}
                  />
                  <ChartTooltip
                    content={(props) => (
                      <ChartTooltipContent
                        {...props}
                        valueFormatter={(value) =>
                          formatCurrency(value, "PYG", locale)
                        }
                      />
                    )}
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
                  ? "No trend data for the selected period."
                  : "No hay datos de tendencia para el período seleccionado."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/80">
          <CardHeader className="space-y-1 border-border/70 border-b pb-4">
            <CardTitle className="text-base">
              {isEn ? "Collection rate trend" : "Tendencia de tasa de cobro"}
            </CardTitle>
            <CardDescription>{periodLabel}</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0 pt-4">
            {hasCollectionTrend ? (
              <ChartContainer className="h-64 w-full" config={collectionConfig}>
                <AreaChart data={trendData} margin={{ left: 8, right: 8 }}>
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
                    tickFormatter={(value) => `${value}%`}
                    tickLine={false}
                    tickMargin={8}
                    width={40}
                  />
                  <ChartTooltip
                    content={(props) => (
                      <ChartTooltipContent
                        {...props}
                        valueFormatter={(value) => `${value}%`}
                      />
                    )}
                  />
                  <defs>
                    <linearGradient
                      id="stakeholderCollectionRate"
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="var(--color-collection_rate_pct)"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="var(--color-collection_rate_pct)"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  </defs>
                  <Area
                    dataKey="collection_rate_pct"
                    fill="url(#stakeholderCollectionRate)"
                    stroke="var(--color-collection_rate_pct)"
                    strokeWidth={2}
                    type="monotone"
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <p className="py-12 text-center text-muted-foreground text-sm">
                {isEn
                  ? "No collection data for the selected period."
                  : "No hay datos de cobro para el período seleccionado."}
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isEn ? "Operational highlights" : "Highlights operativos"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Current operational indicators for owner discussions."
                : "Indicadores operativos actuales para conversaciones con propietarios."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Open tasks" : "Tareas abiertas"}
              </p>
              <p className="font-semibold text-xl tabular-nums">{openTasks}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Overdue tasks" : "Tareas vencidas"}
              </p>
              <p className="font-semibold text-xl tabular-nums">
                {overdueTasks}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">
                {isEn ? "SLA breaches" : "Incumplimientos SLA"}
              </p>
              <p className="font-semibold text-xl tabular-nums">
                {slaBreaches}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">
                {isEn
                  ? "Upcoming check-ins / outs"
                  : "Próximos check-ins / check-outs"}
              </p>
              <p className="font-semibold text-xl tabular-nums">
                {upcomingCheckIns} / {upcomingCheckOuts}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isEn ? "Exception panel" : "Panel de excepciones"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Priority alerts that require action."
                : "Alertas prioritarias que requieren acción."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {exceptions.length > 0 ? (
              <div className="space-y-2">
                {exceptions.map((exception) => (
                  <Alert
                    key={`${exception.title}-${exception.detail}`}
                    variant="warning"
                  >
                    <AlertTitle>{exception.title}</AlertTitle>
                    <AlertDescription>{exception.detail}</AlertDescription>
                  </Alert>
                ))}
              </div>
            ) : (
              <Alert>
                <AlertTitle>
                  {isEn ? "No critical exceptions" : "Sin excepciones críticas"}
                </AlertTitle>
                <AlertDescription>
                  {isEn
                    ? "No high-priority operational or financial exceptions detected in this period."
                    : "No se detectaron excepciones financieras u operativas de alta prioridad en este período."}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isEn ? "Property summary" : "Resumen por propiedad"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Income, expenses, net payout, and outstanding collections by property."
              : "Ingresos, gastos, liquidación neta y cobros pendientes por propiedad."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {propertyRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground text-xs">
                    <th className="py-2 font-medium">
                      {isEn ? "Property" : "Propiedad"}
                    </th>
                    <th className="py-2 font-medium">
                      {isEn ? "Income" : "Ingresos"}
                    </th>
                    <th className="py-2 font-medium">
                      {isEn ? "Expenses" : "Gastos"}
                    </th>
                    <th className="py-2 font-medium">
                      {isEn ? "Net payout" : "Liquidación neta"}
                    </th>
                    <th className="py-2 font-medium">
                      {isEn ? "Occupancy" : "Ocupación"}
                    </th>
                    <th className="py-2 font-medium">
                      {isEn ? "Outstanding" : "Pendientes"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {propertyRows.map((row) => (
                    <tr
                      className="border-border/50 border-b"
                      key={row.property_id}
                    >
                      <td className="py-2">{row.property_name}</td>
                      <td className="py-2 tabular-nums">
                        {formatCurrency(row.income, "PYG", locale)}
                      </td>
                      <td className="py-2 tabular-nums">
                        {formatCurrency(row.expenses, "PYG", locale)}
                      </td>
                      <td className="py-2 font-medium tabular-nums">
                        {formatCurrency(row.net_payout, "PYG", locale)}
                      </td>
                      <td className="py-2 tabular-nums">
                        {(row.occupancy_rate * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 tabular-nums">
                        {row.outstanding_count} ·{" "}
                        {formatCurrency(row.outstanding_amount, "PYG", locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {isEn
                ? "No property summary is available for this filter."
                : "No hay resumen por propiedad disponible para este filtro."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
