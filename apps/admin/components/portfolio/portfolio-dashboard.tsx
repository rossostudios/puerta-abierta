"use client";

import Link from "next/link";

import { ChartIcon, SparklesIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  PortfolioKpis,
  PortfolioPropertyComparison,
  PortfolioSnapshot,
} from "@/lib/api";
import { formatCurrency } from "@/lib/format";

type Props = {
  kpis: PortfolioKpis | null;
  properties: PortfolioPropertyComparison[];
  snapshots: PortfolioSnapshot[];
  locale: string;
};

export function PortfolioDashboard({
  kpis,
  properties,
  snapshots,
  locale,
}: Props) {
  const isEn = locale === "en-US";

  return (
    <div className="space-y-6">
      {/* KPI Hero Cards */}
      {kpis && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            subtitle={`${kpis.occupied_units} ${isEn ? "occupied" : "ocupadas"}`}
            title={isEn ? "Total Units" : "Unidades Totales"}
            value={String(kpis.total_units)}
          />
          <KpiCard
            subtitle={`${kpis.occupied_units} / ${kpis.total_units}`}
            title={isEn ? "Occupancy" : "Ocupación"}
            value={`${(kpis.occupancy * 100).toFixed(1)}%`}
          />
          <KpiCard
            subtitle={`${isEn ? "Revenue" : "Ingresos"}: ${formatCurrency(kpis.monthly_revenue, "USD", "en-US")}`}
            title={isEn ? "Monthly NOI" : "NOI Mensual"}
            value={formatCurrency(kpis.noi, "USD", "en-US")}
          />
          <KpiCard
            subtitle={
              isEn
                ? "Revenue per available room"
                : "Ingreso por unidad disponible"
            }
            title="RevPAR"
            value={formatCurrency(kpis.revpar, "USD", "en-US")}
          />
        </div>
      )}

      {/* Property Comparison */}
      {properties.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "Property Comparison" : "Comparación de Propiedades"}
            </CardTitle>
            <CardDescription>
              {isEn ? "Performance by property" : "Rendimiento por propiedad"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pr-4 pb-2 font-medium">
                      {isEn ? "Property" : "Propiedad"}
                    </th>
                    <th className="pr-4 pb-2 text-right font-medium">
                      {isEn ? "Units" : "Unidades"}
                    </th>
                    <th className="pr-4 pb-2 text-right font-medium">
                      {isEn ? "Occupancy" : "Ocupación"}
                    </th>
                    <th className="pb-2 text-right font-medium">
                      {isEn ? "Revenue" : "Ingresos"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {properties.map((p) => (
                    <tr className="border-b last:border-0" key={p.property_id}>
                      <td className="py-2 pr-4">{p.property_name}</td>
                      <td className="py-2 pr-4 text-right">
                        {p.occupied_units}/{p.total_units}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {(p.occupancy * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 text-right">
                        {formatCurrency(p.monthly_revenue, "USD", "en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Historical Snapshots */}
      {snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "Historical Snapshots" : "Historial de Rendimiento"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Nightly portfolio performance history"
                : "Historial nocturno del rendimiento del portafolio"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pr-4 pb-2 font-medium">
                      {isEn ? "Date" : "Fecha"}
                    </th>
                    <th className="pr-4 pb-2 text-right font-medium">
                      {isEn ? "Occupancy" : "Ocupación"}
                    </th>
                    <th className="pr-4 pb-2 text-right font-medium">
                      {isEn ? "Revenue" : "Ingresos"}
                    </th>
                    <th className="pr-4 pb-2 text-right font-medium">NOI</th>
                    <th className="pb-2 text-right font-medium">RevPAR</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.slice(0, 14).map((s) => (
                    <tr className="border-b last:border-0" key={s.date}>
                      <td className="py-2 pr-4 tabular-nums">{s.date}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {(s.occupancy * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatCurrency(s.revenue, "USD", "en-US")}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatCurrency(s.noi, "USD", "en-US")}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatCurrency(s.revpar, "USD", "en-US")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rich empty state */}
      {!kpis && properties.length === 0 && snapshots.length === 0 && (
        <div className="relative">
          {/* Skeleton preview layer */}
          <div className="pointer-events-none select-none" aria-hidden="true">
            <div className="space-y-4 opacity-[0.35] blur-[1px]">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {(isEn
                  ? ["Total Units", "Occupancy", "Monthly NOI", "RevPAR"]
                  : ["Unidades", "Ocupación", "NOI Mensual", "RevPAR"]
                ).map((label) => (
                  <div className="glass-inner rounded-lg p-4" key={label}>
                    <Skeleton className="mb-2 h-3 w-20" />
                    <Skeleton className="h-7 w-24" />
                    <Skeleton className="mt-2 h-3 w-16" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          </div>

          {/* Overlay CTA */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="glass-liquid mx-4 max-w-md rounded-2xl border p-8 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Icon className="h-6 w-6 text-primary" icon={ChartIcon} />
              </div>
              <h3 className="mb-2 text-lg font-semibold">
                {isEn
                  ? "Welcome to your Portfolio Command Center"
                  : "Bienvenido a tu Centro de Control de Portafolio"}
              </h3>
              <p className="mb-6 text-sm text-muted-foreground">
                {isEn
                  ? "Get real-time insights, occupancy rates, and revenue analytics across all your units. Add your first property to bring this dashboard to life."
                  : "Obtén datos en tiempo real, tasas de ocupación y análisis de ingresos en todas tus unidades. Agrega tu primera propiedad para activar este panel."}
              </p>
              <div className="flex items-center justify-center gap-3">
                <Button asChild className="!bg-primary !text-primary-foreground shadow-sm">
                  <Link href="/module/properties">
                    {isEn ? "+ Add First Property" : "+ Agregar Propiedad"}
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/app/chats?new=1">
                    <Icon className="mr-1.5 h-4 w-4" icon={SparklesIcon} />
                    {isEn ? "Ask Casaora AI" : "Preguntar a Casaora IA"}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wide">
          {title}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="font-semibold text-2xl tabular-nums">{value}</div>
        <p className="mt-1 text-muted-foreground text-xs">{subtitle}</p>
      </CardContent>
    </Card>
  );
}
