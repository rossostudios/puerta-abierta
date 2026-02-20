"use client";

import {
  Baby02Icon,
  Calendar03Icon,
  HeartCheckIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type { ReservationDetail } from "@/lib/features/reservations/types";

type StayDetailsProps = {
  reservation: ReservationDetail;
  isEn: boolean;
  locale: string;
};

function formatDate(date: string, locale: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.valueOf())) return date;
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

export function ReservationStayDetails({
  reservation: r,
  isEn,
  locale,
}: StayDetailsProps) {
  const _guestComposition = [
    r.adults > 0 &&
      `${r.adults} ${r.adults === 1 ? (isEn ? "Adult" : "Adulto") : isEn ? "Adults" : "Adultos"}`,
    r.children > 0 &&
      `${r.children} ${r.children === 1 ? (isEn ? "Child" : "Niño") : isEn ? "Children" : "Niños"}`,
    r.infants > 0 &&
      `${r.infants} ${r.infants === 1 ? (isEn ? "Infant" : "Infante") : isEn ? "Infants" : "Infantes"}`,
    `${r.pets} ${r.pets === 1 ? (isEn ? "Pet" : "Mascota") : isEn ? "Pets" : "Mascotas"}`,
  ].filter(Boolean);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon
            className="text-muted-foreground"
            icon={Calendar03Icon}
            size={16}
          />
          {isEn ? "Stay Details" : "Detalles de la estadía"}
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border/50">
        <InfoRow label="Check-in">
          {formatDate(r.check_in_date, locale)}
        </InfoRow>
        <InfoRow label="Check-out">
          {formatDate(r.check_out_date, locale)}
        </InfoRow>
        <InfoRow label={isEn ? "Nights" : "Noches"}>
          <span className="font-semibold tabular-nums">{r.nights}</span>
        </InfoRow>

        <div className="py-2">
          <span className="text-muted-foreground text-sm">
            {isEn ? "Guest composition" : "Composición de huéspedes"}
          </span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {r.adults > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-xs">
                <Icon icon={UserMultiple02Icon} size={12} />
                {r.adults}A
              </span>
            ) : null}
            {r.children > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-xs">
                <Icon icon={Baby02Icon} size={12} />
                {r.children}C
              </span>
            ) : null}
            {r.infants > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-xs">
                <Icon icon={Baby02Icon} size={12} />
                {r.infants}I
              </span>
            ) : null}
            {r.pets > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-xs">
                <Icon icon={HeartCheckIcon} size={12} />
                {r.pets}
              </span>
            ) : null}
            {r.adults || r.children || r.infants || r.pets ? null : (
              <span className="text-muted-foreground text-xs">-</span>
            )}
          </div>
        </div>

        {r.unit_name ? (
          <InfoRow label={isEn ? "Unit" : "Unidad"}>
            <Link
              className="text-primary hover:underline"
              href={`/module/units/${r.unit_id}`}
            >
              {r.unit_name}
            </Link>
          </InfoRow>
        ) : null}

        {r.property_name && r.property_id ? (
          <InfoRow label={isEn ? "Property" : "Propiedad"}>
            <Link
              className="text-primary hover:underline"
              href={`/module/properties/${r.property_id}`}
            >
              {r.property_name}
            </Link>
          </InfoRow>
        ) : null}

        {r.integration_name ? (
          <InfoRow label={isEn ? "Integration" : "Integración"}>
            {r.integration_name}
          </InfoRow>
        ) : null}

        {r.channel_name ? (
          <InfoRow label={isEn ? "Channel" : "Canal"}>{r.channel_name}</InfoRow>
        ) : null}

        {r.source ? (
          <InfoRow label={isEn ? "Source" : "Origen"}>{r.source}</InfoRow>
        ) : null}

        {r.external_reservation_id ? (
          <InfoRow label={isEn ? "External ID" : "ID externo"}>
            <span className="font-mono text-xs">
              {r.external_reservation_id}
            </span>
          </InfoRow>
        ) : null}
      </CardContent>
    </Card>
  );
}
