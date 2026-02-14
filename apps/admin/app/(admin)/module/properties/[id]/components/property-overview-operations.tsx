import {
  Calendar02Icon,
  Door01Icon,
  Invoice01Icon,
  Task01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      description: isEn ? "Live in marketplace" : "Publicados",
      href: `/module/marketplace-listings?property_id=${encodeURIComponent(recordId)}`,
    },
    {
      id: "applications",
      icon: UserGroupIcon,
      label: isEn ? "Applications" : "Aplicaciones",
      value: overview.pipelineApplicationCount,
      description: isEn ? "In qualification" : "En calificación",
      href: `/module/applications?property_id=${encodeURIComponent(recordId)}`,
    },
    {
      id: "leases",
      icon: Calendar02Icon,
      label: isEn ? "Leases" : "Contratos",
      value: overview.activeLeaseCount,
      description: isEn ? "Currently active" : "Activos",
      href: `/module/leases?property_id=${encodeURIComponent(recordId)}`,
    },
    {
      id: "collections",
      icon: Invoice01Icon,
      label: isEn ? "Collections" : "Cobros",
      value: overview.openCollectionCount,
      description: isEn ? "Require follow-up" : "Requieren seguimiento",
      href: `/module/collections?property_id=${encodeURIComponent(recordId)}`,
    },
  ] as const;

  return (
    <section className="space-y-4">
      <Card className="border-border/80 bg-card/98">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            {isEn ? "Workflow lane" : "Flujo operativo"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "From listing to collection, track each step in one place."
              : "Desde anuncio hasta cobro, controla cada etapa en un solo lugar."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {workflowSteps.map((step) => (
            <Link
              className="rounded-2xl border border-border/70 bg-background/70 p-3 transition-colors hover:bg-muted/25"
              href={step.href}
              key={step.id}
            >
              <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-muted/35">
                <Icon icon={step.icon} size={14} />
              </div>
              <p className="font-medium text-sm">{step.label}</p>
              <p className="font-semibold text-xl tabular-nums">{step.value}</p>
              <p className="text-muted-foreground text-xs">
                {step.description}
              </p>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/98">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg">
              {isEn ? "Unit matrix" : "Matriz de unidades"}
            </CardTitle>
            <Link
              className={cn(
                buttonVariants({ size: "sm", variant: "outline" }),
                "h-8 px-2.5"
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
        </CardHeader>
        <CardContent className="space-y-3">
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
                    className="flex h-full flex-col rounded-2xl border border-border/75 bg-background/75 p-3"
                    key={unit.id}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          className="font-semibold text-base hover:underline"
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
                    <div className="grid gap-2 rounded-xl border border-border/70 bg-muted/20 p-2.5 text-xs">
                      <div>
                        <p className="text-muted-foreground">
                          {isEn ? "Tenant" : "Inquilino"}
                        </p>
                        <p className="truncate font-medium text-sm">
                          {unit.tenantName}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-muted-foreground">
                          {isEn ? "Monthly rent" : "Renta mensual"}
                        </p>
                        <p className="font-medium tabular-nums">
                          {formatCurrency(unit.monthlyRentPyg, "PYG", locale)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <p className="text-muted-foreground text-xs">
                        {unit.nextCollectionDue
                          ? isEn
                            ? `Next due ${unit.nextCollectionDue}`
                            : `Próximo cobro ${unit.nextCollectionDue}`
                          : isEn
                            ? "No upcoming collection"
                            : "Sin cobro próximo"}
                      </p>
                      <Link
                        className={cn(
                          buttonVariants({ size: "sm", variant: "outline" }),
                          "h-7 px-2 text-xs"
                        )}
                        href={unitHref}
                      >
                        {isEn ? "Open" : "Abrir"}
                      </Link>
                    </div>
                    <p className="mt-2 inline-flex items-center gap-1 text-muted-foreground text-xs">
                      <Icon icon={Task01Icon} size={13} />
                      {unit.openTaskCount}{" "}
                      {isEn ? "open tasks" : "tareas abiertas"}
                    </p>
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
            <div className="rounded-2xl border border-border/75 border-dashed bg-muted/20 p-5">
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
        </CardContent>
      </Card>
    </section>
  );
}
