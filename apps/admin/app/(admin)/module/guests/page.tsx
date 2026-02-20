import Link from "next/link";
import type { GuestCrmRow } from "@/components/guests/guests-crm-types";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

import { GuestsCrm } from "./guests-crm";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asOptionalString(value: unknown): string | null {
  const text = asString(value).trim();
  return text ? text : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function localizedSuccessLabel(isEn: boolean, raw: string): string {
  const decoded = safeDecode(raw);
  const key = decoded.trim().toLowerCase();

  const mapping: Record<string, { en: string; es: string }> = {
    "guest-created": { en: "Guest created", es: "Huésped creado" },
    "guest-updated": { en: "Guest updated", es: "Huésped actualizado" },
    "guest-deleted": { en: "Guest deleted", es: "Huésped eliminado" },
    "huesped-creado": { en: "Guest created", es: "Huésped creado" },
    "huesped-actualizado": { en: "Guest updated", es: "Huésped actualizado" },
    "huesped-eliminado": { en: "Guest deleted", es: "Huésped eliminado" },
  };

  const match = mapping[key];
  if (match) return isEn ? match.en : match.es;

  return decoded.replaceAll("-", " ");
}

type ReservationRow = {
  guest_id?: string | null;
  status?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  total_amount?: number | string | null;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

export default async function GuestsModulePage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;
  const successLabel = success ? localizedSuccessLabel(isEn, success) : "";
  const errorLabel = error ? safeDecode(error) : "";

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn
              ? "Missing organization context"
              : "Falta contexto de organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to load guests."
              : "Selecciona una organización para cargar huéspedes."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {isEn ? (
            <>
              Select an organization from the top bar, or create one in{" "}
              <code className="rounded bg-muted px-1 py-0.5">Onboarding</code>.
            </>
          ) : (
            <>
              Selecciona una organización desde la barra superior o crea una en{" "}
              <code className="rounded bg-muted px-1 py-0.5">Onboarding</code>.
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  let guests: Record<string, unknown>[] = [];
  let reservations: ReservationRow[] = [];

  try {
    const [guestRows, reservationRows] = await Promise.all([
      fetchList("/guests", orgId, 500),
      fetchList("/reservations", orgId, 1000),
    ]);
    guests = guestRows as Record<string, unknown>[];
    reservations = reservationRows as ReservationRow[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Could not load guests from the backend."
              : "No se pudieron cargar huéspedes desde el backend."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground text-sm">
          <p>
            {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {getApiBaseUrl()}
            </code>
          </p>
          <p className="break-words">{message}</p>
          <p>
            {isEn
              ? "Make sure the backend is running (`cd apps/backend-rs && cargo run`)"
              : "Asegúrate de que el backend esté ejecutándose (`cd apps/backend-rs && cargo run`)"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const reportable = new Set(["confirmed", "checked_in", "checked_out"]);
  const active = new Set(["pending", "confirmed", "checked_in"]);

  const byGuest = new Map<string, ReservationRow[]>();
  for (const reservation of reservations) {
    const guestId = reservation.guest_id ?? null;
    if (!guestId || typeof guestId !== "string") continue;
    const collected = byGuest.get(guestId) ?? [];
    collected.push(reservation);
    byGuest.set(guestId, collected);
  }

  const rows: GuestCrmRow[] = guests
    .map((guest) => {
      const id = asString(guest.id).trim();
      if (!id) return null;

      const fullName =
        asString(guest.full_name).trim() || (isEn ? "Guest" : "Huésped");
      const email = asOptionalString(guest.email);
      const phone = asOptionalString(guest.phone_e164);
      const documentType = asOptionalString(guest.document_type);
      const documentNumber = asOptionalString(guest.document_number);
      const countryCode = asOptionalString(guest.country_code);
      const preferredLanguage = asOptionalString(guest.preferred_language);
      const notes = asOptionalString(guest.notes);

      const guestReservations = byGuest.get(id) ?? [];
      const reservationCount = guestReservations.length;

      let lifetimeValue = 0;
      let lastStayEnd: string | null = null;
      let nextStayStart: string | null = null;

      for (const reservation of guestReservations) {
        const status = asString(reservation.status).trim().toLowerCase();
        const checkIn = reservation.check_in_date ?? null;
        const checkOut = reservation.check_out_date ?? null;

        if (reportable.has(status)) {
          lifetimeValue += asNumber(reservation.total_amount);
        }

        if (!(isIsoDate(checkIn) && isIsoDate(checkOut))) continue;

        if (checkOut < todayIso && (!lastStayEnd || checkOut > lastStayEnd))
          lastStayEnd = checkOut;

        if (
          active.has(status) &&
          checkOut > todayIso &&
          (!nextStayStart || checkIn < nextStayStart)
        )
          nextStayStart = checkIn;
      }

      return {
        id,
        full_name: fullName,
        email,
        phone_e164: phone,
        document_type: documentType,
        document_number: documentNumber,
        country_code: countryCode,
        preferred_language: preferredLanguage,
        notes,
        reservation_count: reservationCount,
        last_stay_end: lastStayEnd,
        next_stay_start: nextStayStart,
        lifetime_value: Math.round(lifetimeValue * 100) / 100,
        verification_status: asOptionalString(guest.verification_status),
        id_document_url: asOptionalString(guest.id_document_url),
        date_of_birth: asOptionalString(guest.date_of_birth),
        emergency_contact_name: asOptionalString(guest.emergency_contact_name),
        emergency_contact_phone: asOptionalString(
          guest.emergency_contact_phone
        ),
        address: asOptionalString(guest.address),
        city: asOptionalString(guest.city),
        occupation: asOptionalString(guest.occupation),
        document_expiry: asOptionalString(guest.document_expiry),
        nationality: asOptionalString(guest.nationality),
      } satisfies GuestCrmRow;
    })
    .filter((row): row is GuestCrmRow => Boolean(row));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">CRM</Badge>
                <Badge className="text-[11px]" variant="secondary">
                  {isEn ? "Guests" : "Huéspedes"}
                </Badge>
              </div>
              <CardTitle className="text-2xl">
                {isEn ? "Guest CRM" : "CRM de huéspedes"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Contacts, stay history, and lifetime value."
                  : "Contactos, historial de estancias y valor de por vida."}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                href="/module/reservations"
              >
                {isEn ? "Reservations" : "Reservas"}
              </Link>
              <Link
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" })
                )}
                href="/setup?tab=listings"
              >
                {isEn ? "Add listings" : "Agregar anuncios"}
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <GuestsCrm
            errorMessage={errorLabel || undefined}
            orgId={orgId}
            rows={rows}
            successMessage={successLabel || undefined}
          />
        </CardContent>
      </Card>
    </div>
  );
}
