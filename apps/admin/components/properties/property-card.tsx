"use client";

import { Invoice03Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
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
  overdueCollectionCount: number;
  urgentTaskCount: number;
};

export function PropertyCard({
  id,
  name,
  code,
  address,
  status,
  occupancyRate,
  revenueMtdPyg,
  unitCount,
  overdueCollectionCount,
  urgentTaskCount,
}: PropertyCardProps) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  let occupancyColor = "bg-[var(--status-success-fg)]";
  if (occupancyRate < 50) occupancyColor = "bg-[var(--status-danger-fg)]";
  else if (occupancyRate < 80) occupancyColor = "bg-[var(--status-warning-fg)]";

  const occupancyTextColor =
    occupancyRate < 50
      ? "text-[var(--status-danger-fg)]"
      : occupancyRate < 80
        ? "text-[var(--status-warning-fg)]"
        : "text-[var(--status-success-fg)]";

  return (
    <Link className="group block" href={`/module/properties/${id}`}>
      <Card className="overflow-hidden rounded-2xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]">
        <div className="p-4 sm:p-5">
          {/* Row 1: Name + Status */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-medium text-base text-foreground tracking-tight transition-colors group-hover:text-primary">
              {name}
            </h3>
            <StatusBadge className="shrink-0" value={status} />
          </div>

          {/* Subtitle: address · code */}
          <p className="mt-1 truncate text-muted-foreground text-xs">
            {address} · {code}
          </p>

          {/* Metrics row */}
          <div className="mt-4 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground/80 uppercase tracking-widest">
                {isEn ? "Occ" : "Ocup"}
              </span>
              <span className={cn("font-medium text-sm tabular-nums", occupancyTextColor)}>
                {occupancyRate}%
              </span>
              <Progress
                className="h-1 w-10 bg-muted/50"
                indicatorClassName={occupancyColor}
                value={occupancyRate}
              />
            </div>

            <div className="h-3 w-px bg-border/40" />

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground/80 uppercase tracking-widest">
                {isEn ? "Units" : "Unid"}
              </span>
              <span className="font-medium text-sm text-foreground tabular-nums">
                {unitCount}
              </span>
            </div>
          </div>

          {/* Alerts row */}
          {(overdueCollectionCount > 0 || urgentTaskCount > 0) && (
            <div className="mt-3 flex items-center gap-2">
              {overdueCollectionCount > 0 && (
                <Badge className="status-tone-danger gap-1" variant="outline">
                  <Icon className="h-3 w-3" icon={Invoice03Icon} />
                  {overdueCollectionCount} {isEn ? "overdue" : "vencido"}
                  {overdueCollectionCount > 1 ? "s" : ""}
                </Badge>
              )}
              {urgentTaskCount > 0 && (
                <Badge className="status-tone-warning" variant="outline">
                  {urgentTaskCount} {isEn ? "urgent" : "urgente"}
                  {urgentTaskCount > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
