"use client";

import {
    Building03Icon,
    Invoice03Icon,
    Task01Icon,
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
    urgentTaskCount,
}: PropertyCardProps) {
    const locale = useActiveLocale();
    const formatLocale = locale === "en-US" ? "en-US" : "es-PY";
    const isEn = locale === "en-US";

    // Determine status color
    const isInactive = status === "inactive";
    const statusColor = isInactive ? "status-tone-neutral" : "status-tone-success";

    // Determine occupancy color
    let occupancyColor = "bg-[var(--status-success-fg)]";
    if (occupancyRate < 50) occupancyColor = "bg-[var(--status-danger-fg)]";
    else if (occupancyRate < 80) occupancyColor = "bg-[var(--status-warning-fg)]";

    // Health dot color
    const healthDotColor =
        health === "critical"
            ? "bg-[var(--status-danger-fg)]"
            : health === "watch"
                ? "bg-[var(--status-warning-fg)]"
                : "bg-[var(--status-success-fg)]";

    return (
        <Card className="group overflow-hidden rounded-3xl border-border/60 transition-all hover:border-border hover:shadow-md">
            {/* Cover Image Area */}
            <div className="relative h-44 w-full overflow-hidden bg-[#fdfcfb] dark:bg-neutral-900/40">
                {/* Subtle Geometric Pattern or Soft Glow */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.8)_0%,transparent_100%)] dark:bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.05)_0%,transparent_100%)]" />

                <div className="absolute inset-0 flex items-center justify-center opacity-[0.08] dark:opacity-[0.15]">
                    <Icon icon={Building03Icon} size={120} />
                </div>

                {/* Status Badge + Health Dot */}
                <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5">
                    <Badge
                        variant="secondary"
                        className={cn(
                            "border-0 px-2.5 py-0.5 font-bold text-[10px] tracking-wider backdrop-blur-md",
                            statusColor
                        )}
                    >
                        {status.toUpperCase()}
                    </Badge>
                    <span
                        className={cn(
                            "h-2.5 w-2.5 rounded-full shadow-sm",
                            healthDotColor,
                            health === "critical" && "animate-pulse"
                        )}
                    />
                </div>

                {/* Property Code Overlay */}
                <div className="absolute bottom-4 left-4 z-10">
                    <div className="rounded-xl border border-border/20 bg-background/40 px-3 py-1.5 text-[11px] font-bold tracking-tight text-foreground/80 backdrop-blur-xl shadow-sm">
                        {code}
                    </div>
                </div>

                {/* Unit Count Badge */}
                {unitCount > 0 ? (
                    <div className="absolute bottom-4 right-4 z-10">
                        <div className="rounded-lg border border-border/20 bg-background/40 px-2 py-1 text-[10px] font-semibold text-foreground/70 backdrop-blur-xl shadow-sm">
                            {unitCount} {isEn ? "units" : "unid."}
                        </div>
                    </div>
                ) : null}
            </div>

            <CardContent className="p-5">
                {/* Header */}
                <div className="mb-6 space-y-1">
                    <h3 className="font-semibold text-lg tracking-tight text-foreground group-hover:text-primary transition-colors">
                        {name}
                    </h3>
                    <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
                        <Icon icon={Building03Icon} size={14} />
                        <span className="truncate">{address}</span>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-3 gap-4 border-t border-border/50 py-4">

                    {/* Occupancy */}
                    <div className="space-y-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {isEn ? "Occupancy" : "Ocupación"}
                        </span>
                        <div className="flex items-end gap-1.5">
                            <span
                                className={cn(
                                    "text-xl font-semibold",
                                    occupancyRate < 80
                                        ? "text-[var(--status-warning-fg)]"
                                        : "text-[var(--status-success-fg)]"
                                )}
                            >
                                {occupancyRate}%
                            </span>
                        </div>
                        <Progress value={occupancyRate} className="h-1" indicatorClassName={occupancyColor} />
                    </div>

                    {/* Revenue */}
                    <div className="space-y-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {isEn ? "Revenue" : "Ingresos"}
                        </span>
                        <div className="font-semibold text-foreground text-lg">
                            {formatCurrency(revenueMtdPyg, "PYG", formatLocale).split(/\s/)[0]}
                            <span className="ml-0.5 text-xs text-muted-foreground font-normal">/mo</span>
                        </div>
                    </div>

                    {/* Tasks */}
                    <div className="space-y-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {isEn ? "Tasks" : "Tareas"}
                        </span>
                        <div className="flex items-center gap-1.5">
                            <div
                                className={cn(
                                    "text-lg font-semibold",
                                    openTaskCount > 0
                                        ? "text-[var(--status-warning-fg)]"
                                        : "text-muted-foreground"
                                )}
                            >
                                {openTaskCount}
                            </div>
                            <span className="text-xs text-muted-foreground">{isEn ? "Open" : "Pend."}</span>
                        </div>
                    </div>
                </div>

                {/* Overdue Collections Warning */}
                {overdueCollectionCount > 0 ? (
                    <div className="flex items-center gap-2 rounded-xl border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 mb-4">
                        <Icon
                            className="shrink-0 text-[var(--status-danger-fg)]"
                            icon={Invoice03Icon}
                            size={14}
                        />
                        <span className="text-xs font-medium text-[var(--status-danger-fg)]">
                            {overdueCollectionCount}{" "}
                            {isEn ? "overdue collection" : "cobro vencido"}
                            {overdueCollectionCount > 1 ? (isEn ? "s" : "s") : ""}
                        </span>
                    </div>
                ) : null}

                {/* Footer Action */}
                <div className={cn(overdueCollectionCount > 0 ? "" : "mt-4")}>
                    <Link
                        href={`/module/properties/${id}`}
                        className={cn(
                            buttonVariants({ variant: "secondary" }),
                            "w-full bg-secondary/50 hover:bg-secondary font-medium text-foreground"
                        )}
                    >
                        {isEn ? "View Details" : "Ver Detalles"}
                    </Link>
                </div>
            </CardContent>
        </Card>
    );
}
