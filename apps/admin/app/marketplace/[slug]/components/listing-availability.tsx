"use client";

import { Calendar02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";

type ListingAvailabilityProps = {
  availableFrom: string;
  minimumLeaseMonths: number | null;
  isEn: boolean;
};

export function ListingAvailability({
  availableFrom,
  minimumLeaseMonths,
  isEn,
}: ListingAvailabilityProps) {
  if (!availableFrom) return null;

  const availDate = new Date(availableFrom);
  const today = new Date();
  const isAvailableNow = availDate <= today;

  return (
    <section>
      <h2 className="mb-3 font-semibold text-lg tracking-tight">
        {isEn ? "Availability" : "Disponibilidad"}
      </h2>
      <div className="rounded-xl border border-border/70 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Icon className="text-primary" icon={Calendar02Icon} size={18} />
          </div>
          <div>
            <p className="font-medium text-sm">
              {isAvailableNow
                ? isEn
                  ? "Available now"
                  : "Disponible ahora"
                : isEn
                  ? `Available from ${availableFrom}`
                  : `Disponible desde ${availableFrom}`}
            </p>
            {minimumLeaseMonths ? (
              <p className="text-muted-foreground text-xs">
                {isEn
                  ? `Minimum lease: ${minimumLeaseMonths} months`
                  : `Contrato mínimo: ${minimumLeaseMonths} meses`}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
