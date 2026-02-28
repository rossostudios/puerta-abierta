import {
  Calendar02Icon,
  Door01Icon,
  Invoice01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Fragment } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PropertyOverview as PropertyOverviewData } from "../types";
import { isUuid } from "./property-overview-utils";

type PropertyOverviewOperationsProps = {
  overview: PropertyOverviewData;
  recordId: string;
  locale: "en-US" | "es-PY";
  isEn: boolean;
};

export function PropertyOverviewOperations({
  overview,
  recordId,
  locale,
  isEn,
}: PropertyOverviewOperationsProps) {
  const workflowSteps = [
    {
      id: "listings",
      icon: Door01Icon,
      label: isEn ? "Listings" : "Anuncios",
      value: overview.publishedListingCount,
      href: `/module/listings?property_id=${encodeURIComponent(recordId)}`,
    },
    {
      id: "applications",
      icon: UserGroupIcon,
      label: isEn ? "Applications" : "Aplicaciones",
      value: overview.pipelineApplicationCount,
      href: `/module/applications?property_id=${encodeURIComponent(recordId)}`,
    },
    {
      id: "leases",
      icon: Calendar02Icon,
      label: isEn ? "Leases" : "Contratos",
      value: overview.activeLeaseCount,
      href: `/module/leases?property_id=${encodeURIComponent(recordId)}`,
    },
    {
      id: "collections",
      icon: Invoice01Icon,
      label: isEn ? "Collections" : "Cobros",
      value: overview.openCollectionCount,
      href: `/module/collections?property_id=${encodeURIComponent(recordId)}`,
    },
  ] as const;

  return (
    <section className="space-y-6">
      {/* ---- Workflow Lane ---- */}
      <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
        <h3 className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
          {isEn ? "Workflow lane" : "Flujo operativo"}
        </h3>

        <div className="flex items-center gap-0">
          {workflowSteps.map((step, i) => {
            const isActive = step.value > 0;
            return (
              <Fragment key={step.id}>
                <Link
                  className={cn(
                    "group flex flex-1 flex-col items-center gap-1.5 rounded-xl px-2 py-3 transition-colors",
                    isActive
                      ? "border border-amber-300/60 bg-amber-50 dark:border-amber-600/30 dark:bg-amber-950/30"
                      : "border border-border/40 bg-muted/20"
                  )}
                  href={step.href}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                      isActive
                        ? "bg-amber-500 text-white dark:bg-amber-600"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Icon icon={step.icon} size={16} />
                  </div>
                  <span
                    className={cn(
                      "font-medium text-[11px]",
                      isActive
                        ? "text-amber-900 dark:text-amber-200"
                        : "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                  <span
                    className={cn(
                      "font-extrabold text-xl tabular-nums leading-tight tracking-tight",
                      isActive
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-foreground"
                    )}
                  >
                    {step.value}
                  </span>
                </Link>
                {i < workflowSteps.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="hidden shrink-0 px-1 text-border sm:inline"
                  >
                    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                      <path
                        d="M10 6l6 6-6 6"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                  </span>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* ---- Unit Matrix ---- */}
      <div className="space-y-4 rounded-2xl border border-border/60 bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
            {isEn ? "Unit matrix" : "Matriz de unidades"}
          </h3>
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "h-7 rounded-lg px-3 text-xs"
            )}
            href={`/module/units?property_id=${encodeURIComponent(recordId)}`}
          >
            {overview.unitCount > overview.unitCards.length
              ? isEn
                ? `View all ${overview.unitCount} units`
                : `Ver las ${overview.unitCount} unidades`
              : isEn
                ? "View all units"
                : "Ver unidades"}
          </Link>
        </div>

        {overview.unitCards.length ? (
          <>
            {/* Table layout */}
            <div className="overflow-hidden rounded-xl border border-border/40">
              {/* Header */}
              <div className="flex items-center gap-0 border-border/40 border-b bg-muted/30 px-3.5 py-2">
                <span className="w-16 font-semibold text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
                  {isEn ? "Code" : "Código"}
                </span>
                <span className="flex-1 font-semibold text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
                  {isEn ? "Name" : "Nombre"}
                </span>
                <span className="w-20 font-semibold text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
                  {isEn ? "Status" : "Estado"}
                </span>
                <span className="w-20 font-semibold text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
                  {isEn ? "Tenant" : "Inquilino"}
                </span>
                <span className="w-20 text-right font-semibold text-[10px] text-muted-foreground/60 uppercase tracking-[0.08em]">
                  {isEn ? "Rent" : "Renta"}
                </span>
              </div>
              {/* Rows */}
              {overview.unitCards.map((unit, i) => {
                const unitHref =
                  unit.unitId && isUuid(unit.unitId)
                    ? `/module/units/${unit.unitId}`
                    : `/module/units?property_id=${encodeURIComponent(recordId)}`;
                return (
                  <Link
                    className={cn(
                      "flex items-center gap-0 px-3.5 py-3 transition-colors hover:bg-muted/20",
                      i < overview.unitCards.length - 1 &&
                        "border-border/20 border-b"
                    )}
                    href={unitHref}
                    key={unit.id}
                  >
                    <span className="w-16 font-semibold text-[13px] tabular-nums">
                      {unit.label}
                    </span>
                    <span className="flex-1 truncate font-medium text-[13px]">
                      {unit.subtitle}
                    </span>
                    <span className="w-20">
                      <span
                        className={cn(
                          "inline-flex rounded-md px-2 py-0.5 font-semibold text-[11px]",
                          unit.statusTone === "occupied"
                            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                            : unit.statusTone === "maintenance"
                              ? "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
                              : "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
                        )}
                      >
                        {unit.statusLabel}
                      </span>
                    </span>
                    <span className="w-20 truncate text-[13px] text-muted-foreground">
                      {unit.tenantName || "--"}
                    </span>
                    <span className="w-20 text-right font-medium text-[13px] text-muted-foreground tabular-nums">
                      {formatCurrency(unit.monthlyRentPyg, "PYG", locale)}
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4">
              {overview.vacantUnitCount > 0 && (
                <div className="flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-sm bg-red-500" />
                  <span className="font-medium text-[11px] text-muted-foreground">
                    {overview.vacantUnitCount} {isEn ? "Vacant" : "Vacantes"}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-sm bg-emerald-500" />
                <span className="font-medium text-[11px] text-muted-foreground">
                  {overview.unitCount - overview.vacantUnitCount}{" "}
                  {isEn ? "Occupied" : "Ocupadas"}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground/60">
                {overview.openTaskCount}{" "}
                {isEn ? "tasks open" : "tareas abiertas"}
              </span>
            </div>

            {overview.unitCount > overview.unitCards.length ? (
              <p className="text-center text-muted-foreground text-xs">
                {isEn
                  ? `Showing ${overview.unitCards.length} of ${overview.unitCount} units`
                  : `Mostrando ${overview.unitCards.length} de ${overview.unitCount} unidades`}
              </p>
            ) : null}
          </>
        ) : (
          <div className="rounded-xl border border-border/40 border-dashed bg-muted/10 p-6 text-center">
            <p className="font-medium text-sm">
              {isEn
                ? "No units yet for this property."
                : "Esta propiedad aún no tiene unidades."}
            </p>
            <p className="mt-1 text-muted-foreground text-sm">
              {isEn
                ? "Start by creating your first unit to unlock leasing, maintenance, and collections."
                : "Empieza creando la primera unidad para activar contratos, mantenimiento y cobros."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
