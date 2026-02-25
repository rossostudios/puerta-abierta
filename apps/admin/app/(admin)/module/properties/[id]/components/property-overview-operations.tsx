import { Fragment } from "react";
import {
  Calendar02Icon,
  Door01Icon,
  Invoice01Icon,
  Task01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
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
    <section className="space-y-6 pt-2">
      {/* ---- Workflow Stepper ---- */}
      <div className="space-y-3">
        <h3 className="text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
          {isEn ? "Workflow lane" : "Flujo operativo"}
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          {workflowSteps.map((step, i) => (
            <Fragment key={step.id}>
              <Link
                className="group flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-muted/50"
                href={step.href}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-muted/30 transition-colors group-hover:border-primary/20 group-hover:bg-primary/5 group-hover:text-primary">
                  <Icon icon={step.icon} size={16} />
                </div>
                <div>
                  <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
                    {step.label}
                  </p>
                  <p className="font-bold text-lg tabular-nums leading-tight">
                    {step.value}
                  </p>
                </div>
              </Link>
              {i < workflowSteps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="hidden text-muted-foreground/40 sm:inline"
                >
                  →
                </span>
              )}
            </Fragment>
          ))}
        </div>
      </div>

      {/* ---- Unit Matrix ---- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
            {isEn ? "Unit matrix" : "Matriz de unidades"}
          </h3>
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "h-7 px-2 text-xs"
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
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {overview.unitCards.map((unit) => {
                const unitHref =
                  unit.unitId && isUuid(unit.unitId)
                    ? `/module/units/${unit.unitId}`
                    : `/module/units?property_id=${encodeURIComponent(recordId)}`;
                const statusToneClass =
                  unit.statusTone === "occupied"
                    ? "status-tone-success"
                    : unit.statusTone === "maintenance"
                      ? "status-tone-warning"
                      : "status-tone-info";

                return (
                  <article
                    className="flex h-full flex-col rounded-xl border border-border/40 bg-background/50 p-3 transition-colors hover:bg-card"
                    key={unit.id}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          className="font-semibold text-sm hover:underline"
                          href={unitHref}
                        >
                          {unit.label}
                        </Link>
                        <p className="truncate text-muted-foreground text-xs">
                          {unit.subtitle}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex shrink-0 rounded-full border px-2 py-0.5 font-medium text-[11px]",
                          statusToneClass
                        )}
                      >
                        {unit.statusLabel}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-xs">
                      <p className="truncate font-medium">
                        {unit.tenantName}
                      </p>
                      <p className="shrink-0 font-medium tabular-nums">
                        {formatCurrency(unit.monthlyRentPyg, "PYG", locale)}
                      </p>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                        <Icon icon={Task01Icon} size={12} />
                        {unit.openTaskCount}{" "}
                        {isEn ? "tasks" : "tareas"}
                      </p>
                      <Link
                        className="text-primary text-xs hover:underline"
                        href={unitHref}
                      >
                        {isEn ? "Open" : "Abrir"}
                      </Link>
                    </div>
                  </article>
                );
              })}
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
