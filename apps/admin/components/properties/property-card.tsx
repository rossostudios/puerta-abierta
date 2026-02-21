"use client";

import { Building03Icon, Invoice03Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import type { PropertyHealthState } from "@/lib/features/properties/types";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type PropertyCardProps = {
  id: string;
  name: string;
  code: string;
  address: string;
  status: string;
  occupancyRate: number;
  revenueMtdPyg: number;
  openTaskCount: number;
  unitCount: number;
  health: PropertyHealthState;
  overdueCollectionCount: number;
  urgentTaskCount: number;
};

const WHITESPACE_REGEX = /\s/;

export function PropertyCard({
  id,
  name,
  code,
  address,
  status,
  occupancyRate,
  revenueMtdPyg,
  openTaskCount,
  unitCount,
  health,
  overdueCollectionCount,
}: PropertyCardProps) {
  const locale = useActiveLocale();
  const formatLocale = locale === "en-US" ? "en-US" : "es-PY";
  const isEn = locale === "en-US";

  const isInactive = status === "inactive";
  const statusColor = isInactive
    ? "status-tone-neutral"
    : "status-tone-success";

  let occupancyColor = "bg-[var(--status-success-fg)]";
  if (occupancyRate < 50) occupancyColor = "bg-[var(--status-danger-fg)]";
  else if (occupancyRate < 80) occupancyColor = "bg-[var(--status-warning-fg)]";

  const healthDotColor =
    health === "critical"
      ? "bg-[var(--status-danger-fg)]"
      : health === "watch"
        ? "bg-[var(--status-warning-fg)]"
        : "bg-[var(--status-success-fg)]";

  return (
    <Card className="group flex h-full flex-col overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-floating)]">
      {/* Compact cover area */}
      <div className="relative h-32 w-full shrink-0 overflow-hidden bg-muted/30">
        <div className="absolute inset-0 flex items-center justify-center opacity-[0.06] dark:opacity-[0.12]">
          <Icon icon={Building03Icon} size={72} />
        </div>

        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
          <Badge
            className={cn(
              "glass-float px-2 py-0.5 font-semibold text-[10px] uppercase tracking-widest",
              statusColor
            )}
            variant="secondary"
          >
            {status.toUpperCase()}
          </Badge>
          <span
            className={cn(
              "h-2 w-2 rounded-full shadow-sm",
              healthDotColor,
              health === "critical" && "animate-pulse"
            )}
          />
        </div>

        <div className="absolute bottom-3 left-3 z-10">
          <div className="glass-float rounded-lg px-2.5 py-1 font-semibold text-[10px] text-foreground tracking-wide">
            {code}
          </div>
        </div>

        {unitCount > 0 ? (
          <div className="absolute right-3 bottom-3 z-10">
            <div className="glass-float rounded-lg px-2 py-1 font-medium text-[10px] text-foreground">
              {unitCount} {isEn ? "units" : "unid."}
            </div>
          </div>
        ) : null}
      </div>

      <CardContent className="flex flex-1 flex-col p-5">
        {/* Header */}
        <div className="mb-4">
          <h3 className="truncate font-medium text-base text-foreground tracking-tight transition-colors group-hover:text-primary">
            {name}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
            <Icon icon={Building03Icon} size={14} />
            <span className="truncate">{address}</span>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 border-border/40 border-t pt-4">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground/80 uppercase tracking-widest">
              {isEn ? "Occ." : "Ocup."}
            </span>
            <div
              className={cn(
                "font-medium text-base tabular-nums",
                occupancyRate < 80
                  ? "text-[var(--status-warning-fg)]"
                  : "text-[var(--status-success-fg)]"
              )}
            >
              {occupancyRate}%
            </div>
            <Progress
              className="h-1 bg-muted/50"
              indicatorClassName={occupancyColor}
              value={occupancyRate}
            />
          </div>

          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground/80 uppercase tracking-widest">
              {isEn ? "Revenue" : "Ingresos"}
            </span>
            <div className="font-medium text-base text-foreground tabular-nums">
              {
                formatCurrency(revenueMtdPyg, "PYG", formatLocale).split(
                  WHITESPACE_REGEX
                )[0]
              }
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground/80 uppercase tracking-widest">
              {isEn ? "Tasks" : "Tareas"}
            </span>
            <div
              className={cn(
                "font-medium text-base tabular-nums",
                openTaskCount > 0
                  ? "text-[var(--status-warning-fg)]"
                  : "text-muted-foreground"
              )}
            >
              {openTaskCount}
            </div>
          </div>
        </div>

        {/* Overdue warning */}
        {overdueCollectionCount > 0 ? (
          <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-2.5 py-1.5">
            <Icon
              className="shrink-0 text-[var(--status-danger-fg)]"
              icon={Invoice03Icon}
              size={12}
            />
            <span className="font-medium text-[10px] text-[var(--status-danger-fg)]">
              {overdueCollectionCount} {isEn ? "overdue" : "vencido"}
              {overdueCollectionCount > 1 ? "s" : ""}
            </span>
          </div>
        ) : null}

        {/* Spacer to push action to bottom if cards are different heights */}
        <div className="flex-1" />

        {/* Action */}
        <div className="mt-5 border-border/30 border-t pt-4">
          <Link
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "w-full bg-transparent font-medium text-foreground text-xs transition-colors hover:bg-muted/50"
            )}
            href={`/module/properties/${id}`}
          >
            {isEn ? "View Details" : "Ver Detalles"}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
