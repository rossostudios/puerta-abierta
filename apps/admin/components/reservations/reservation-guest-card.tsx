"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GuestSummary } from "@/lib/features/reservations/types";
import { cn } from "@/lib/utils";

type ReservationGuestCardProps = {
  guest: GuestSummary | null;
  guestName: string | null;
  guestId: string | null;
  isEn: boolean;
};

const NAME_WHITESPACE_REGEX = /\s+/;

function countryFlag(code: string | null): string {
  if (!code || code.length !== 2) return "";
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    ...Array.from(upper).map((c) => 0x1_f1_e6 + c.charCodeAt(0) - 65)
  );
}

function initials(name: string): string {
  return name
    .split(NAME_WHITESPACE_REGEX)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function ReservationGuestCard({
  guest,
  guestName,
  guestId,
  isEn,
}: ReservationGuestCardProps) {
  const displayName =
    guest?.full_name ?? guestName ?? (isEn ? "Guest" : "Huésped");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {isEn ? "Guest" : "Huésped"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-lg text-primary">
            {initials(displayName)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-base">{displayName}</p>
            {guest?.country_code ? (
              <span className="text-sm">
                {countryFlag(guest.country_code)}{" "}
                <span className="text-muted-foreground text-xs uppercase">
                  {guest.country_code}
                </span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="space-y-2 text-sm">
          {guest?.email ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {isEn ? "Email" : "Email"}
              </span>
              <a
                className="truncate text-primary hover:underline"
                href={`mailto:${guest.email}`}
              >
                {guest.email}
              </a>
            </div>
          ) : null}

          {guest?.phone_e164 ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {isEn ? "Phone" : "Teléfono"}
              </span>
              <a
                className="text-primary tabular-nums hover:underline"
                href={`tel:${guest.phone_e164}`}
              >
                {guest.phone_e164}
              </a>
            </div>
          ) : null}

          {guest?.document_type || guest?.document_number ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {isEn ? "Document" : "Documento"}
              </span>
              <span className="tabular-nums">
                {[guest.document_type?.toUpperCase(), guest.document_number]
                  .filter(Boolean)
                  .join(" ")}
              </span>
            </div>
          ) : null}

          {guest?.preferred_language ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {isEn ? "Language" : "Idioma"}
              </span>
              <Badge variant="secondary">{guest.preferred_language}</Badge>
            </div>
          ) : null}
        </div>

        {guestId ? (
          <Link
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "w-full justify-center"
            )}
            href={`/module/guests/${guestId}`}
          >
            {isEn ? "View guest profile" : "Ver perfil del huésped"}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
