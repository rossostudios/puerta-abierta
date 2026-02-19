import {
    CheckmarkCircle02Icon,
    DollarCircleIcon,
    Door01Icon,
    Layers01Icon,
} from "@hugeicons/core-free-icons";

import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

export function UnitCapacityBento({
    record,
    isEn,
}: {
    record: Record<string, unknown>;
    isEn: boolean;
    locale: "en-US" | "es-PY";
}) {
    const maxGuests = Number(record.max_guests ?? 0);
    const bedrooms = Number(record.bedrooms ?? 0);
    const bathrooms = Number(record.bathrooms ?? 0);
    const currency = String(record.currency ?? "-");
    const isActive = Boolean(record.is_active);

    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {/* Guests */}
            <div className="group relative overflow-hidden rounded-3xl border border-border/40 bg-card p-5 shadow-[var(--shadow-floating)] transition-all hover:-translate-y-0.5 hover:border-border/60 hover:shadow-[var(--shadow-soft)]">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Icon icon={Layers01Icon} size={16} />
                        </div>
                        <p className="font-medium text-muted-foreground text-sm tracking-tight transition-colors group-hover:text-foreground">
                            {isEn ? "Capacity" : "Capacidad"}
                        </p>
                    </div>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                    <p className="font-bold text-3xl tracking-tight text-foreground tabular-nums">
                        {maxGuests}
                    </p>
                    <p className="font-medium text-muted-foreground text-sm">
                        {isEn ? "guests max" : "huéspedes máx"}
                    </p>
                </div>
            </div>

            {/* Bedrooms */}
            <div className="group relative overflow-hidden rounded-3xl border border-border/40 bg-card p-5 shadow-[var(--shadow-floating)] transition-all hover:-translate-y-0.5 hover:border-border/60 hover:shadow-[var(--shadow-soft)]">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <Icon icon={Door01Icon} size={16} />
                        </div>
                        <p className="font-medium text-muted-foreground text-sm tracking-tight transition-colors group-hover:text-foreground">
                            {isEn ? "Bedrooms" : "Dormitorios"}
                        </p>
                    </div>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                    <p className="font-bold text-3xl tracking-tight text-foreground tabular-nums">
                        {bedrooms}
                    </p>
                </div>
            </div>

            {/* Bathrooms */}
            <div className="group relative overflow-hidden rounded-3xl border border-border/40 bg-card p-5 shadow-[var(--shadow-floating)] transition-all hover:-translate-y-0.5 hover:border-border/60 hover:shadow-[var(--shadow-soft)]">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
                            <Icon icon={Door01Icon} size={16} />
                        </div>
                        <p className="font-medium text-muted-foreground text-sm tracking-tight transition-colors group-hover:text-foreground">
                            {isEn ? "Bathrooms" : "Baños"}
                        </p>
                    </div>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                    <p className="font-bold text-3xl tracking-tight text-foreground tabular-nums">
                        {bathrooms}
                    </p>
                </div>
            </div>

            {/* Currency */}
            <div className="group relative overflow-hidden rounded-3xl border border-border/40 bg-card p-5 shadow-[var(--shadow-floating)] transition-all hover:-translate-y-0.5 hover:border-border/60 hover:shadow-[var(--shadow-soft)]">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            <Icon icon={DollarCircleIcon} size={16} />
                        </div>
                        <p className="font-medium text-muted-foreground text-sm tracking-tight transition-colors group-hover:text-foreground">
                            {isEn ? "Currency" : "Moneda"}
                        </p>
                    </div>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                    <p className="font-bold text-3xl tracking-tight text-foreground uppercase">
                        {currency}
                    </p>
                </div>
            </div>

            {/* Status */}
            <div className={cn(
                "group relative overflow-hidden rounded-3xl border border-border/40 p-5 shadow-[var(--shadow-floating)] transition-all hover:-translate-y-0.5 hover:border-border/60 hover:shadow-[var(--shadow-soft)]",
                isActive ? "bg-card" : "bg-muted/30"
            )}>
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                            <Icon icon={CheckmarkCircle02Icon} size={16} />
                        </div>
                        <p className="font-medium text-muted-foreground text-sm tracking-tight transition-colors group-hover:text-foreground">
                            {isEn ? "Status" : "Estado"}
                        </p>
                    </div>
                </div>
                <div className="mt-4 flex items-center h-[36px]">
                    <StatusBadge value={isActive ? "active" : "inactive"} />
                </div>
            </div>

        </div>
    );
}
