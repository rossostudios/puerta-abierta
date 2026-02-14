"use client";

import {
    Building03Icon,
    Invoice03Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import { formatCurrency } from "@/lib/format";
import type { PropertyHealthState } from "@/lib/features/properties/types";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

interface PropertyCardProps {
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
}

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
    const statusColor = isInactive ? "status-tone-neutral" : "status-tone-success";

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
        <Card className="group overflow-hidden rounded-2xl border-border/60 transition-all hover:border-border hover:shadow-md">
            {/* Compact cover area */}
            <div className="relative h-24 w-full overflow-hidden bg-[#fdfcfb] dark:bg-neutral-900/40">
                <div className="absolute inset-0 flex items-center justify-center opacity-[0.06] dark:opacity-[0.12]">
                    <Icon icon={Building03Icon} size={72} />
                </div>

                <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
                    <Badge
                        variant="secondary"
                        className={cn(
                            "border-0 px-2 py-0.5 font-bold text-[9px] tracking-wider backdrop-blur-md",
                            statusColor
                        )}
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
                    <div className="rounded-lg border border-border/20 bg-background/40 px-2 py-1 text-[10px] font-bold tracking-tight text-foreground/80 backdrop-blur-xl shadow-sm">
                        {code}
                    </div>
                </div>

                {unitCount > 0 ? (
                    <div className="absolute bottom-3 right-3 z-10">
                        <div className="rounded-md border border-border/20 bg-background/40 px-1.5 py-0.5 text-[9px] font-semibold text-foreground/70 backdrop-blur-xl shadow-sm">
                            {unitCount} {isEn ? "units" : "unid."}
                        </div>
                    </div>
                ) : null}
            </div>

            <CardContent className="p-4">
                {/* Header */}
                <div className="mb-3 space-y-0.5">
                    <h3 className="truncate font-semibold text-sm tracking-tight text-foreground group-hover:text-primary transition-colors">
                        {name}
                    </h3>
                    <div className="flex items-center gap-1 text-muted-foreground text-xs">
                        <Icon icon={Building03Icon} size={12} />
                        <span className="truncate">{address}</span>
                    </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3 border-t border-border/50 pt-3">
                    <div className="space-y-1">
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                            {isEn ? "Occ." : "Ocup."}
                        </span>
                        <div className={cn(
                            "text-base font-semibold tabular-nums",
                            occupancyRate < 80
                                ? "text-[var(--status-warning-fg)]"
                                : "text-[var(--status-success-fg)]"
                        )}>
                            {occupancyRate}%
                        </div>
                        <Progress value={occupancyRate} className="h-0.5" indicatorClassName={occupancyColor} />
                    </div>

                    <div className="space-y-1">
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                            {isEn ? "Revenue" : "Ingr."}
                        </span>
                        <div className="font-semibold text-foreground text-sm tabular-nums">
                            {formatCurrency(revenueMtdPyg, "PYG", formatLocale).split(/\s/)[0]}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                            {isEn ? "Tasks" : "Tareas"}
                        </span>
                        <div className={cn(
                            "text-base font-semibold tabular-nums",
                            openTaskCount > 0
                                ? "text-[var(--status-warning-fg)]"
                                : "text-muted-foreground"
                        )}>
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
                        <span className="text-[10px] font-medium text-[var(--status-danger-fg)]">
                            {overdueCollectionCount}{" "}
                            {isEn ? "overdue" : "vencido"}
                            {overdueCollectionCount > 1 ? "s" : ""}
                        </span>
                    </div>
                ) : null}

                {/* Action */}
                <div className="mt-3">
                    <Link
                        href={`/module/properties/${id}`}
                        className={cn(
                            buttonVariants({ variant: "secondary", size: "sm" }),
                            "w-full bg-secondary/50 hover:bg-secondary font-medium text-foreground text-xs"
                        )}
                    >
                        {isEn ? "View Details" : "Ver Detalles"}
                    </Link>
                </div>
            </CardContent>
        </Card>
    );
}
