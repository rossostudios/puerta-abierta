import { notFound } from "next/navigation";

import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { RecordRecent } from "@/components/shell/record-recent";
import {
  FinancialBreakdownCard,
  FinancialKpiRow,
} from "@/components/reservations/reservation-financials";
import { ReservationGuestCard } from "@/components/reservations/reservation-guest-card";
import { ReservationHero } from "@/components/reservations/reservation-hero";
import { ReservationStatusTimeline } from "@/components/reservations/reservation-status-timeline";
import { ReservationStayDetails } from "@/components/reservations/reservation-stay-details";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { fetchJson } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import {
  toGuestSummary,
  toReservationDetail,
  type GuestSummary,
  type ReservationDetail,
} from "@/lib/features/reservations/types";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PageProps = {
  params: Promise<{ id: string }>;
};

type FetchResult =
  | { kind: "ok"; reservation: ReservationDetail; guest: GuestSummary | null }
  | { kind: "not_found" }
  | { kind: "error"; message: string; membershipError?: boolean };

async function loadReservation(id: string): Promise<FetchResult> {
  try {
    const raw = await fetchJson<Record<string, unknown>>(
      `/reservations/${encodeURIComponent(id)}`
    );
    const reservation = toReservationDetail(raw);

    let guest: GuestSummary | null = null;
    if (reservation.guest_id) {
      try {
        const guestRaw = await fetchJson<Record<string, unknown>>(
          `/guests/${encodeURIComponent(reservation.guest_id)}`
        );
        guest = toGuestSummary(guestRaw);
      } catch {
        // Guest fetch may fail if guest was deleted or no permission
      }
    }

    return { kind: "ok", reservation, guest };
  } catch (err) {
    const message = errorMessage(err);
    if (message.includes("404")) {
      return { kind: "not_found" };
    }
    if (isOrgMembershipError(message)) {
      return { kind: "error", message, membershipError: true };
    }
    return { kind: "error", message };
  }
}

export default async function ReservationDetailPage({ params }: PageProps) {
  const { id } = await params;
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const result = await loadReservation(id);

  if (result.kind === "not_found") {
    notFound();
  }

  if (result.kind === "error") {
    if (result.membershipError) {
      const activeOrgId = await getActiveOrgId();
      return (
        <OrgAccessChanged
          description={
            isEn
              ? "This record belongs to an organization you no longer have access to."
              : "Este registro pertenece a una organización a la que no tienes acceso."
          }
          orgId={activeOrgId}
          title={
            isEn ? "No access to this record" : "Sin acceso a este registro"
          }
        />
      );
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API request failed" : "Falló la solicitud a la API"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Could not load reservation details."
              : "No se pudieron cargar los detalles de la reserva."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          <p className="break-words">{result.message}</p>
        </CardContent>
      </Card>
    );
  }

  const { reservation: r, guest } = result;
  const href = `/module/reservations/${r.id}`;

  return (
    <div className="space-y-6">
      <RecordRecent
        href={href}
        label={r.guest_name || "Reservation"}
        meta={isEn ? "Reservations" : "Reservas"}
      />

      <ReservationHero isEn={isEn} locale={locale} reservation={r} />

      <FinancialKpiRow isEn={isEn} locale={locale} reservation={r} />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        {/* Left column */}
        <div className="space-y-6">
          <ReservationStayDetails isEn={isEn} locale={locale} reservation={r} />

          <FinancialBreakdownCard isEn={isEn} locale={locale} reservation={r} />

          <ReservationStatusTimeline isEn={isEn} reservation={r} />
        </div>

        {/* Right column (sidebar) */}
        <div className="space-y-6">
          <ReservationGuestCard
            guest={guest}
            guestId={r.guest_id}
            guestName={r.guest_name}
            isEn={isEn}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {isEn ? "Related" : "Relacionados"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "w-full justify-start"
                )}
                href={`/module/tasks?reservation_id=${r.id}`}
              >
                {isEn ? "Tasks" : "Tareas"}
              </Link>
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "w-full justify-start"
                )}
                href={`/module/expenses?reservation_id=${r.id}`}
              >
                {isEn ? "Expenses" : "Gastos"}
              </Link>
              {r.unit_id ? (
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "w-full justify-start"
                  )}
                  href={`/module/reservations?view=calendar`}
                >
                  {isEn ? "Calendar" : "Calendario"}
                </Link>
              ) : null}
            </CardContent>
          </Card>

          {r.notes ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {isEn ? "Notes" : "Notas"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-muted-foreground text-sm">
                  {r.notes}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Collapsible defaultOpen={false}>
            <Card>
              <CardHeader className="pb-2">
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <CardTitle className="text-base">
                    {isEn ? "Metadata" : "Metadatos"}
                  </CardTitle>
                  <span className="text-muted-foreground text-xs">
                    {isEn ? "Toggle" : "Mostrar"}
                  </span>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">ID</span>
                    <CopyButton
                      className="h-7 text-xs"
                      label={r.id.slice(0, 8)}
                      value={r.id}
                    />
                  </div>
                  {r.created_at ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {isEn ? "Created" : "Creado"}
                      </span>
                      <span className="text-xs">
                        {new Date(r.created_at).toLocaleString(
                          isEn ? "en-US" : "es-PY"
                        )}
                      </span>
                    </div>
                  ) : null}
                  {r.updated_at ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        {isEn ? "Updated" : "Actualizado"}
                      </span>
                      <span className="text-xs">
                        {new Date(r.updated_at).toLocaleString(
                          isEn ? "en-US" : "es-PY"
                        )}
                      </span>
                    </div>
                  ) : null}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}
