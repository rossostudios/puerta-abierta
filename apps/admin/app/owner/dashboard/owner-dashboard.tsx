"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* -------------------------------------------------------------------------- */
/*  SVG bar chart — last 6 months revenue                                     */
/* -------------------------------------------------------------------------- */
function RevenueBarChart({
  data,
  currency,
  locale,
}: {
  data: Record<string, unknown>[];
  currency: string;
  locale: string;
}) {
  if (data.length === 0) return null;

  const last6 = data.slice(-6);
  const maxVal = Math.max(...last6.map((r) => asNumber(r.amount)), 1);
  const barWidth = 40;
  const gap = 16;
  const chartHeight = 160;
  const labelHeight = 40;
  const topPad = 24;
  const totalHeight = chartHeight + labelHeight + topPad;
  const totalWidth = last6.length * (barWidth + gap) - gap + 32;

  return (
    <svg
      className="w-full"
      preserveAspectRatio="xMidYMid meet"
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
    >
      {last6.map((r, i) => {
        const amount = asNumber(r.amount);
        const barH = Math.max((amount / maxVal) * chartHeight, 4);
        const x = 16 + i * (barWidth + gap);
        const y = topPad + chartHeight - barH;
        const monthLabel = asString(r.month).slice(5) || `M${i + 1}`;

        return (
          <g key={asString(r.month) || i}>
            {/* Value label */}
            <text
              className="fill-muted-foreground"
              fontSize="9"
              textAnchor="middle"
              x={x + barWidth / 2}
              y={y - 6}
            >
              {formatCurrency(amount, currency, locale)}
            </text>
            {/* Bar */}
            <rect
              className="fill-primary/80"
              height={barH}
              rx={4}
              width={barWidth}
              x={x}
              y={y}
            />
            {/* Month label */}
            <text
              className="fill-muted-foreground"
              fontSize="10"
              textAnchor="middle"
              x={x + barWidth / 2}
              y={topPad + chartHeight + 16}
            >
              {monthLabel}
            </text>
          </g>
        );
      })}
      {/* Baseline */}
      <line
        className="stroke-border"
        strokeWidth={1}
        x1={12}
        x2={totalWidth - 12}
        y1={topPad + chartHeight}
        y2={topPad + chartHeight}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Property performance card                                                 */
/* -------------------------------------------------------------------------- */
function PropertyCard({
  property,
  currency,
  locale,
  isEn,
}: {
  property: Record<string, unknown>;
  currency: string;
  locale: string;
  isEn: boolean;
}) {
  const name =
    asString(property.property_name) ||
    asString(property.name) ||
    asString(property.property_id).slice(0, 8);
  const occupancy = asNumber(
    property.occupancy_rate ?? property.occupancy ?? 0
  );
  const revenue = asNumber(property.revenue_this_month ?? property.amount ?? 0);
  const maintenance = asNumber(
    property.active_maintenance ?? property.pending_maintenance ?? 0
  );

  // Occupancy ring indicator
  const pct = Math.min(Math.max(occupancy, 0), 100);
  const r = 20;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-start gap-4 p-4">
        {/* Occupancy ring */}
        <div className="flex shrink-0 flex-col items-center">
          <svg className="-rotate-90" height={48} width={48}>
            <circle
              className="fill-none stroke-muted"
              cx={24}
              cy={24}
              r={r}
              strokeWidth={4}
            />
            <circle
              className="fill-none stroke-primary"
              cx={24}
              cy={24}
              r={r}
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              strokeWidth={4}
            />
          </svg>
          <span className="mt-0.5 font-semibold text-xs">
            {pct.toFixed(0)}%
          </span>
        </div>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-sm">{name}</p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">
                {isEn ? "Revenue" : "Ingresos"}
              </p>
              <p className="font-medium text-sm">
                {formatCurrency(revenue, currency, locale)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase">
                {isEn ? "Maintenance" : "Mantenimiento"}
              </p>
              <p className="font-medium text-sm">{maintenance}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Quick link card                                                           */
/* -------------------------------------------------------------------------- */
function QuickLink({
  href,
  icon,
  label,
  subtitle,
}: {
  href: string;
  icon: string;
  label: string;
  subtitle: string;
}) {
  return (
    <Link href={href}>
      <Card className="cursor-pointer transition-all hover:border-primary hover:shadow-md">
        <CardContent className="flex items-center gap-3 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-sm">{label}</p>
            <p className="truncate text-muted-foreground text-xs">{subtitle}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main dashboard                                                            */
/* -------------------------------------------------------------------------- */
export function OwnerDashboard({ locale }: { locale: string }) {
  "use no memo";
  const isEn = locale === "en-US";
  const router = useRouter();
  const [tokenState] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("owner_token") : null
  );

  // ---- Dashboard summary ----
  const { data = null, isPending: loading } = useQuery({
    queryKey: ["owner-dashboard", tokenState],
    queryFn: async () => {
      const token = localStorage.getItem("owner_token");
      if (!token) {
        router.push("/owner/login");
        return null;
      }
      const res = await fetch(`${API_BASE}/owner/dashboard`, {
        headers: { "x-owner-token": token },
      });
      if (res.status === 401) {
        localStorage.removeItem("owner_token");
        localStorage.removeItem("owner_org_id");
        router.push("/owner/login");
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    },
    enabled: Boolean(tokenState),
  });

  // ---- Property performance ----
  const { data: perfData = null } = useQuery({
    queryKey: ["owner-property-performance", tokenState],
    queryFn: async () => {
      const token = localStorage.getItem("owner_token");
      if (!token) return null;
      const res = await fetch(`${API_BASE}/owner/property-performance`, {
        headers: { "x-owner-token": token },
      });
      if (!res.ok) return null;
      const json = await res.json();
      return (
        (json as { data?: Record<string, unknown>[] }).data ??
        (json as Record<string, unknown>[])
      );
    },
    enabled: Boolean(tokenState),
  });

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-muted-foreground text-sm">
            {isEn ? "Loading your dashboard..." : "Cargando tu panel..."}
          </p>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const org = (data.organization ?? {}) as Record<string, unknown>;
  const summary = (data.summary ?? {}) as Record<string, unknown>;
  const revenueByMonth = (data.revenue_by_month ?? []) as Record<
    string,
    unknown
  >[];
  const revenueByProperty = (data.revenue_by_property ?? []) as Record<
    string,
    unknown
  >[];
  const upcomingReservations = (data.upcoming_reservations ?? []) as Record<
    string,
    unknown
  >[];
  const currency = asString(org.default_currency) || "PYG";

  const totalRevenue = asNumber(
    summary.total_collected ?? summary.total_revenue ?? 0
  );
  const occupancyRate = asNumber(summary.occupancy_rate ?? 0);
  const pendingMaintenance = asNumber(
    summary.pending_maintenance ?? summary.open_maintenance ?? 0
  );
  const nextPayoutDate = asString(
    summary.next_payout_date ?? summary.next_payout ?? ""
  );
  const nextPayoutAmount = asNumber(summary.next_payout_amount ?? 0);

  // Properties for performance cards — merge API sources
  const propertyPerf: Record<string, unknown>[] = Array.isArray(perfData)
    ? perfData
    : revenueByProperty;

  const maxPropertyRevenue = Math.max(
    ...revenueByProperty.map((r) => asNumber(r.amount)),
    1
  );

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">
            {isEn ? "Owner Dashboard" : "Panel del Propietario"}
          </h1>
          {asString(org.name) && (
            <p className="mt-0.5 text-muted-foreground text-sm">
              {asString(org.name)}
            </p>
          )}
        </div>
        <Button
          className="self-start sm:self-auto"
          onClick={() => {
            localStorage.removeItem("owner_token");
            localStorage.removeItem("owner_org_id");
            router.push("/owner/login");
          }}
          size="sm"
          variant="outline"
        >
          {isEn ? "Sign Out" : "Cerrar Sesion"}
        </Button>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Revenue */}
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Total Revenue" : "Ingresos Totales"}
            </p>
            <p className="mt-1 font-bold text-2xl">
              {formatCurrency(totalRevenue, currency, locale)}
            </p>
          </CardContent>
        </Card>

        {/* Occupancy Rate */}
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Occupancy Rate" : "Tasa de Ocupacion"}
            </p>
            <p className="mt-1 font-bold text-2xl">
              {occupancyRate.toFixed(1)}%
            </p>
            <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(occupancyRate, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Pending Maintenance */}
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Pending Maintenance" : "Mant. Pendiente"}
            </p>
            <p className="mt-1 font-bold text-2xl">{pendingMaintenance}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {isEn ? "open requests" : "solicitudes abiertas"}
            </p>
          </CardContent>
        </Card>

        {/* Next Payout */}
        <Card className="border-l-4 border-l-violet-500">
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Next Payout" : "Proximo Pago"}
            </p>
            {nextPayoutAmount > 0 ? (
              <>
                <p className="mt-1 font-bold text-2xl">
                  {formatCurrency(nextPayoutAmount, currency, locale)}
                </p>
                {nextPayoutDate && (
                  <p className="mt-1 text-muted-foreground text-xs">
                    {nextPayoutDate}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-muted-foreground text-sm">
                {isEn ? "No upcoming payout" : "Sin pagos pendientes"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Revenue Chart ── */}
      {revenueByMonth.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              {isEn
                ? "Revenue Trend (Last 6 Months)"
                : "Tendencia de Ingresos (Ultimos 6 Meses)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RevenueBarChart
              currency={currency}
              data={revenueByMonth}
              locale={locale}
            />
          </CardContent>
        </Card>
      )}

      {/* ── Property Performance Cards ── */}
      {propertyPerf.length > 0 && (
        <div>
          <h2 className="mb-3 font-semibold text-lg">
            {isEn ? "Property Performance" : "Rendimiento por Propiedad"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {propertyPerf.map((prop) => (
              <PropertyCard
                currency={currency}
                isEn={isEn}
                key={
                  asString(prop.property_id) ||
                  asString(prop.id) ||
                  asString(prop.property_name)
                }
                locale={locale}
                property={prop}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Revenue by Property (horizontal bars) ── */}
      {revenueByProperty.length > 0 && !Array.isArray(perfData) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              {isEn ? "Revenue by Property" : "Ingresos por Propiedad"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {revenueByProperty.map((r) => {
              const amount = asNumber(r.amount);
              const widthPct = Math.max((amount / maxPropertyRevenue) * 100, 4);
              return (
                <div key={asString(r.property_id)}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">
                      {asString(r.property_name) ||
                        asString(r.property_id).slice(0, 8)}
                    </span>
                    <span className="ml-2 text-muted-foreground text-xs">
                      {formatCurrency(amount, currency, locale)}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary/70 transition-all"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Upcoming Reservations ── */}
      {upcomingReservations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                {isEn ? "Upcoming Reservations" : "Proximas Reservas"}
              </CardTitle>
              <Link
                className="text-primary text-xs hover:underline"
                href="/owner/reservations"
              >
                {isEn ? "View all" : "Ver todas"}
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcomingReservations.slice(0, 5).map((r) => (
              <div
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                key={asString(r.id)}
              >
                <div>
                  <p className="font-medium">
                    {asString(r.check_in_date)} &rarr;{" "}
                    {asString(r.check_out_date)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {asString(r.unit_name) || asString(r.unit_id).slice(0, 8)}
                  </p>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
                  {asString(r.status)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Activity Counts ── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Active Leases" : "Contratos Activos"}
            </p>
            <p className="mt-1 font-bold text-2xl">
              {asNumber(summary.active_leases)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Active Reservations" : "Reservas Activas"}
            </p>
            <p className="mt-1 font-bold text-2xl">
              {asNumber(summary.active_reservations)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {isEn ? "Pending Statements" : "Estados Pendientes"}
            </p>
            <p className="mt-1 font-bold text-2xl">
              {asNumber(summary.pending_statements)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Quick Links ── */}
      <div>
        <h2 className="mb-3 font-semibold text-lg">
          {isEn ? "Quick Links" : "Acceso Rapido"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <QuickLink
            href="/owner/properties"
            icon="🏠"
            label={isEn ? "Properties" : "Propiedades"}
            subtitle={
              isEn
                ? `${asNumber(summary.total_properties)} properties`
                : `${asNumber(summary.total_properties)} propiedades`
            }
          />
          <QuickLink
            href="/owner/statements"
            icon="📄"
            label={isEn ? "Statements" : "Estados de Cuenta"}
            subtitle={isEn ? "View payouts & reports" : "Ver pagos e informes"}
          />
          <QuickLink
            href="/owner/reservations"
            icon="📅"
            label={isEn ? "Reservations" : "Reservas"}
            subtitle={
              isEn
                ? `${asNumber(summary.active_reservations)} active`
                : `${asNumber(summary.active_reservations)} activas`
            }
          />
        </div>
      </div>
    </div>
  );
}
