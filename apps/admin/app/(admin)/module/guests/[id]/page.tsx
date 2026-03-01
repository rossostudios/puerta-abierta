import {
  ArrowLeft01Icon,
  CalendarCheckIn01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackgroundCheckCard } from "@/components/guests/background-check-card";
import { VerificationCard } from "@/components/guests/verification-card";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { PinButton } from "@/components/shell/pin-button";
import { RecordRecent } from "@/components/shell/record-recent";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Icon } from "@/components/ui/icon";
import { StatCard } from "@/components/ui/stat-card";
import { TableCard } from "@/components/ui/table-card";
import { fetchList, getApiBaseUrl } from "@/lib/api";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { getServerAccessToken } from "@/lib/auth/server-access-token";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

import { GuestProfileActions } from "../guest-profile-actions";

type PageProps = {
  params: Promise<{ id: string }>;
};

type GuestRecord = {
  id: string;
  organization_id: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
  document_type: string | null;
  document_number: string | null;
  country_code: string | null;
  preferred_language: string | null;
  notes: string | null;
  verification_status: string | null;
  id_document_url: string | null;
  selfie_url: string | null;
  verified_at: string | null;
  date_of_birth: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  address: string | null;
  city: string | null;
  occupation: string | null;
  document_expiry: string | null;
  nationality: string | null;
  background_check_status: string | null;
  background_check_date: string | null;
  background_check_notes: string | null;
  background_check_report_url: string | null;
};

type ReservationRow = {
  status?: string | null;
  check_in_date?: string | null;
  check_out_date?: string | null;
  total_amount?: number | string | null;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPORTABLE_STATUSES = new Set(["confirmed", "checked_in", "checked_out"]);
const ACTIVE_STATUSES = new Set(["pending", "confirmed", "checked_in"]);

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

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && ISO_DATE_RE.test(value);
}

function asDateLabel(
  locale: string,
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

function guestSubtitle(guest: GuestRecord, isEn: boolean): string {
  const email = (guest.email ?? "").trim();
  const phone = (guest.phone_e164 ?? "").trim();
  if (email && phone) return `${email} · ${phone}`;
  if (email) return email;
  if (phone) return phone;
  return isEn
    ? "No contact information yet."
    : "Aún no hay información de contacto.";
}

async function fetchGuest(options: {
  id: string;
  isEn: boolean;
}): Promise<GuestRecord> {
  const { id, isEn } = options;

  const token = await getServerAccessToken();

  const response = await fetch(
    `${getApiBaseUrl()}/guests/${encodeURIComponent(id)}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );

  if (response.status === 404) notFound();
  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const suffix = details ? `: ${details.slice(0, 240)}` : "";
    throw new Error(
      isEn
        ? `API request failed (${response.status}) for /guests/${id}${suffix}`
        : `Falló la solicitud a la API (${response.status}) para /guests/${id}${suffix}`
    );
  }

  const record = (await response.json()) as Record<string, unknown>;
  const guest: GuestRecord = {
    id: asString(record.id).trim() || id,
    organization_id: asString(record.organization_id).trim(),
    full_name:
      asString(record.full_name).trim() || (isEn ? "Guest" : "Huésped"),
    email: asOptionalString(record.email),
    phone_e164: asOptionalString(record.phone_e164),
    document_type: asOptionalString(record.document_type),
    document_number: asOptionalString(record.document_number),
    country_code: asOptionalString(record.country_code),
    preferred_language: asOptionalString(record.preferred_language),
    notes: asOptionalString(record.notes),
    verification_status: asOptionalString(record.verification_status),
    id_document_url: asOptionalString(record.id_document_url),
    selfie_url: asOptionalString(record.selfie_url),
    verified_at: asOptionalString(record.verified_at),
    date_of_birth: asOptionalString(record.date_of_birth),
    emergency_contact_name: asOptionalString(record.emergency_contact_name),
    emergency_contact_phone: asOptionalString(record.emergency_contact_phone),
    address: asOptionalString(record.address),
    city: asOptionalString(record.city),
    occupation: asOptionalString(record.occupation),
    document_expiry: asOptionalString(record.document_expiry),
    nationality: asOptionalString(record.nationality),
    background_check_status: asOptionalString(record.background_check_status),
    background_check_date: asOptionalString(record.background_check_date),
    background_check_notes: asOptionalString(record.background_check_notes),
    background_check_report_url: asOptionalString(
      record.background_check_report_url
    ),
  };

  if (!guest.organization_id) {
    throw new Error(
      isEn
        ? "Guest record is missing organization_id."
        : "El registro de huésped no tiene organization_id."
    );
  }

  return guest;
}

function DocumentExpiryRow({
  documentExpiry,
  isEn,
  locale,
  todayIso,
}: {
  documentExpiry: string | null;
  isEn: boolean;
  locale: string;
  todayIso: string;
}) {
  const expiry = (documentExpiry ?? "").trim();
  const label = asDateLabel(locale, expiry);

  let badge: React.ReactNode = null;
  if (expiry) {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const threshold = thirtyDaysFromNow.toISOString().slice(0, 10);

    if (expiry < todayIso) {
      badge = (
        <Badge className="ml-2 text-[11px]" variant="destructive">
          {isEn ? "Expired" : "Vencido"}
        </Badge>
      );
    } else if (expiry < threshold) {
      badge = (
        <Badge
          className="ml-2 border-amber-300 bg-amber-100 text-[11px] text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
          variant="outline"
        >
          {isEn ? "Expiring soon" : "Vence pronto"}
        </Badge>
      );
    }
  }

  return (
    <div className="rounded-md border bg-muted/10 px-3 py-2">
      <p className="text-muted-foreground text-xs">
        {isEn ? "Document expiry" : "Vencimiento del documento"}
      </p>
      <p className="mt-1 flex items-center font-medium text-foreground">
        {label ?? "-"}
        {badge}
      </p>
    </div>
  );
}

export default async function GuestProfilePage({ params }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const { id } = await params;
  const activeOrgId = await getActiveOrgId();

  if (!activeOrgId) {
    return (
      <NoOrgCard
        isEn={isEn}
        resource={["the guest profile", "el perfil del huésped"]}
      />
    );
  }

  let guest: GuestRecord;
  let reservations: ReservationRow[] = [];

  try {
    guest = await fetchGuest({ id, isEn });
    reservations = (await fetchList(
      "/reservations",
      guest.organization_id,
      1000,
      {
        guest_id: guest.id,
      }
    )) as ReservationRow[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return (
        <OrgAccessChanged
          description={
            isEn
              ? "This guest belongs to an organization you don't have access to. Clear the current selection and switch to an organization you are a member of."
              : "Este huésped pertenece a una organización a la que no tienes acceso. Borra la selección actual y cámbiate a una organización de la que seas miembro."
          }
          orgId={activeOrgId}
          title={isEn ? "No access to this guest" : "Sin acceso a este huésped"}
        />
      );
    }

    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const reservationCount = reservations.length;

  let lifetimeValue = 0;
  let lastStayEnd: string | null = null;
  let nextStayStart: string | null = null;

  for (const reservation of reservations) {
    const status = asString(reservation.status).trim().toLowerCase();
    if (REPORTABLE_STATUSES.has(status)) {
      lifetimeValue += asNumber(reservation.total_amount);
    }

    const checkIn = reservation.check_in_date ?? null;
    const checkOut = reservation.check_out_date ?? null;
    if (!(isIsoDate(checkIn) && isIsoDate(checkOut))) continue;

    if (checkOut < todayIso && (!lastStayEnd || checkOut > lastStayEnd))
      lastStayEnd = checkOut;

    if (
      ACTIVE_STATUSES.has(status) &&
      checkOut > todayIso &&
      (!nextStayStart || checkIn < nextStayStart)
    )
      nextStayStart = checkIn;
  }

  const recordHref = `/module/guests/${guest.id}`;
  const reservationsHref = `/module/reservations?guest_id=${encodeURIComponent(guest.id)}`;

  const upcoming = nextStayStart ? (
    <Badge className="gap-1" variant="secondary">
      <Icon icon={CalendarCheckIn01Icon} size={14} />
      {isEn ? "Next stay" : "Próxima estancia"}
    </Badge>
  ) : null;

  const returning =
    reservationCount > 1 ? (
      <Badge variant="outline">{isEn ? "Returning" : "Recurrente"}</Badge>
    ) : null;

  return (
    <div className="space-y-6">
      <RecordRecent
        href={recordHref}
        label={guest.full_name}
        meta={isEn ? "Guest CRM" : "CRM de huéspedes"}
      />

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">CRM</Badge>
                <Badge className="text-[11px]" variant="secondary">
                  {isEn ? "Guest" : "Huésped"}
                </Badge>
                {upcoming}
                {returning}
              </div>
              <CardTitle className="text-2xl">{guest.full_name}</CardTitle>
              <CardDescription>{guestSubtitle(guest, isEn)}</CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                href="/module/guests"
              >
                <Icon icon={ArrowLeft01Icon} size={16} />
                {isEn ? "Back to CRM" : "Volver al CRM"}
              </Link>
              <Link
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                href={reservationsHref}
              >
                {isEn ? "Reservations" : "Reservas"}
              </Link>
              <CopyButton
                label={isEn ? "Copy ID" : "Copiar ID"}
                value={guest.id}
              />
              <PinButton
                href={recordHref}
                label={guest.full_name}
                meta={isEn ? "Guest CRM" : "CRM de huéspedes"}
              />
              <GuestProfileActions guest={guest} nextPath={recordHref} />
            </div>
          </div>
        </CardHeader>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          helper={
            isEn ? "Total stays on record" : "Total de estancias registradas"
          }
          label={isEn ? "Reservations" : "Reservas"}
          value={String(reservationCount)}
        />
        <StatCard
          helper={
            isEn
              ? "Sum of confirmed / completed stays"
              : "Suma de estancias confirmadas / completadas"
          }
          label={isEn ? "Lifetime value" : "Valor de por vida"}
          value={formatCurrency(
            Math.round(lifetimeValue * 100) / 100,
            "PYG",
            locale
          )}
        />
        <StatCard
          helper={isEn ? "Next check-in" : "Próximo check-in"}
          label={isEn ? "Next stay" : "Próxima estancia"}
          value={asDateLabel(locale, nextStayStart) ?? "-"}
        />
        <StatCard
          helper={isEn ? "Most recent check-out" : "Último check-out"}
          label={isEn ? "Last stay" : "Última estancia"}
          value={asDateLabel(locale, lastStayEnd) ?? "-"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{isEn ? "Contact" : "Contacto"}</CardTitle>
            <CardDescription>
              {isEn
                ? "Guest details and preferences."
                : "Detalles y preferencias del huésped."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Email" : "Correo"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {(guest.email ?? "").trim() || "-"}
              </p>
            </div>
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Phone" : "Teléfono"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {(guest.phone_e164 ?? "").trim() || "-"}
              </p>
            </div>
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Document" : "Documento"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {[
                  (guest.document_type ?? "").trim(),
                  (guest.document_number ?? "").trim(),
                ]
                  .filter(Boolean)
                  .join(" ") || "-"}
              </p>
            </div>
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Country" : "País"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {(guest.country_code ?? "").trim() || "-"}
              </p>
            </div>
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Nationality" : "Nacionalidad"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {(guest.nationality ?? "").trim() || "-"}
              </p>
            </div>
            <DocumentExpiryRow
              documentExpiry={guest.document_expiry}
              isEn={isEn}
              locale={locale}
              todayIso={todayIso}
            />
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Language" : "Idioma"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {(guest.preferred_language ?? "").trim() || "-"}
              </p>
            </div>
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Date of birth" : "Fecha de nacimiento"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {asDateLabel(locale, guest.date_of_birth) ?? "-"}
              </p>
            </div>
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Occupation" : "Ocupación"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {(guest.occupation ?? "").trim() || "-"}
              </p>
            </div>
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Address" : "Dirección"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {[(guest.address ?? "").trim(), (guest.city ?? "").trim()]
                  .filter(Boolean)
                  .join(", ") || "-"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{isEn ? "Notes" : "Notas"}</CardTitle>
            <CardDescription>
              {isEn
                ? "Keep preferences, special requests, and document notes here."
                : "Guarda preferencias, pedidos especiales y notas de documentos aquí."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(guest.notes ?? "").trim() ? (
              <div className="rounded-md border bg-muted/10 p-3 text-foreground text-sm">
                <p className="whitespace-pre-wrap">{guest.notes}</p>
              </div>
            ) : (
              <div className="rounded-md border border-dashed bg-muted/10 p-6 text-muted-foreground text-sm">
                {isEn
                  ? "No notes yet. Add preferences and reminders so each stay feels personal."
                  : "Aún no hay notas. Agrega preferencias y recordatorios para que cada estancia se sienta personal."}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {((guest.emergency_contact_name ?? "").trim() ||
        (guest.emergency_contact_phone ?? "").trim()) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "Emergency contact" : "Contacto de emergencia"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Name" : "Nombre"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {(guest.emergency_contact_name ?? "").trim() || "-"}
              </p>
            </div>
            <div className="rounded-md border bg-muted/10 px-3 py-2">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Phone" : "Teléfono"}
              </p>
              <p className="mt-1 font-medium text-foreground">
                {(guest.emergency_contact_phone ?? "").trim() || "-"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <VerificationCard
        guestId={guest.id}
        idDocumentUrl={guest.id_document_url}
        selfieUrl={guest.selfie_url}
        verificationStatus={guest.verification_status}
        verifiedAt={guest.verified_at}
      />

      <BackgroundCheckCard
        backgroundCheckDate={guest.background_check_date}
        backgroundCheckNotes={guest.background_check_notes}
        backgroundCheckReportUrl={guest.background_check_report_url}
        backgroundCheckStatus={guest.background_check_status}
        guestId={guest.id}
        orgId={guest.organization_id}
      />

      <TableCard
        rowHrefBase="/module/reservations"
        rows={reservations as Record<string, unknown>[]}
        subtitle={
          isEn
            ? "Stay history (filtered by guest_id)"
            : "Historial de estancias (filtrado por guest_id)"
        }
        title={isEn ? "Reservations" : "Reservas"}
      />
    </div>
  );
}
