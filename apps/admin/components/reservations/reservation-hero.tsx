"use client";

import { ArrowLeft01Icon, Calendar03Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { PinButton } from "@/components/shell/pin-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ReservationDetail } from "@/lib/features/reservations/types";
import { cn } from "@/lib/utils";

type ReservationHeroProps = {
  reservation: ReservationDetail;
  isEn: boolean;
  locale: string;
};

function formatDateRange(
  checkIn: string,
  checkOut: string,
  locale: string
): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const d1 = new Date(`${checkIn}T00:00:00`);
  const d2 = new Date(`${checkOut}T00:00:00`);
  if (Number.isNaN(d1.valueOf()) || Number.isNaN(d2.valueOf())) {
    return `${checkIn} - ${checkOut}`;
  }
  return `${fmt.format(d1)} \u2192 ${fmt.format(d2)}`;
}

export function ReservationHero({
  reservation: r,
  isEn,
  locale,
}: ReservationHeroProps) {
  const href = `/module/reservations/${r.id}`;
  const nightsLabel = `${r.nights} ${r.nights === 1 ? (isEn ? "night" : "noche") : isEn ? "nights" : "noches"}`;
  const subtitle = [r.unit_name, r.property_name, nightsLabel]
    .filter(Boolean)
    .join(" \u00B7 ");

  return (
    <Card className="glass-surface overflow-hidden">
      <CardContent className="p-0">
        <section className="relative overflow-hidden bg-[#fdfcfb] dark:bg-neutral-900/40">
          <div className="absolute -top-16 -right-16 opacity-[0.03] dark:opacity-[0.08]">
            <Icon icon={Calendar03Icon} size={320} />
          </div>

          <div className="relative space-y-4 p-6 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                      "h-7 rounded-lg border-border/10 bg-background/50 px-2.5 font-bold text-[10px] uppercase tracking-wider transition-all hover:bg-background/80"
                    )}
                    href="/module/reservations"
                  >
                    <Icon icon={ArrowLeft01Icon} size={12} />
                    {isEn ? "Back" : "Volver"}
                  </Link>
                  <Badge
                    className="h-7 border-border/10 bg-background/50 font-bold text-[10px] text-muted-foreground uppercase tracking-wider backdrop-blur-sm"
                    variant="outline"
                  >
                    {isEn ? "Reservations" : "Reservas"}
                  </Badge>
                  <StatusBadge value={r.status} />
                </div>

                <div className="space-y-1">
                  <h2 className="font-bold text-3xl text-foreground tracking-tight sm:text-4xl">
                    {r.guest_name || (isEn ? "Guest" : "Huésped")}
                  </h2>
                  <p className="max-w-2xl font-medium text-muted-foreground text-sm leading-relaxed">
                    {subtitle}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {formatDateRange(r.check_in_date, r.check_out_date, locale)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {r.channel_name ? (
                    <Badge className="border-primary/20 bg-primary/5 font-bold text-[10px] text-primary uppercase tracking-wider">
                      {r.channel_name}
                    </Badge>
                  ) : null}
                  {r.source ? (
                    <Badge
                      className="font-bold text-[10px] uppercase tracking-wider"
                      variant="secondary"
                    >
                      {r.source}
                    </Badge>
                  ) : null}
                  {r.external_reservation_id ? (
                    <Badge
                      className="font-mono text-[10px] uppercase tracking-wider"
                      variant="outline"
                    >
                      {r.external_reservation_id}
                    </Badge>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <CopyButton
                  className="h-9 rounded-xl border-border/40 bg-background/40 px-3 hover:bg-background/80"
                  value={r.id}
                />
                <PinButton
                  className="h-9 rounded-xl border-border/40 bg-background/40 px-3 hover:bg-background/80"
                  href={href}
                  label={r.guest_name || "Reservation"}
                  meta={isEn ? "Reservations" : "Reservas"}
                />
              </div>
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
