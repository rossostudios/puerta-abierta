import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

import { ReservationsManager } from "./reservations-manager";
import { ReservationHeaderButtons } from "./reservations-page-client";

type PageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
    guest_id?: string;
    guestId?: string;
  }>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function ReservationsModulePage({
  searchParams,
}: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const orgId = await getActiveOrgId();
  const sp = await searchParams;
  const success = sp.success;
  const error = sp.error;
  const guestId =
    typeof sp.guest_id === "string"
      ? sp.guest_id
      : typeof sp.guestId === "string"
        ? sp.guestId
        : "";
  const guestFilter = guestId.trim();

  const successLabel = success ? safeDecode(success).replaceAll("-", " ") : "";
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
              ? "Select an organization to load reservations."
              : "Selecciona una organización para cargar reservas."}
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

  let reservations: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];

  try {
    const [reservationRows, unitRows] = await Promise.all([
      fetchList(
        "/reservations",
        orgId,
        1000,
        guestFilter ? { guest_id: guestFilter } : undefined
      ),
      fetchList("/units", orgId, 500),
    ]);

    reservations = reservationRows as Record<string, unknown>[];
    units = unitRows as Record<string, unknown>[];
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
              ? "Could not load reservations from the backend."
              : "No se pudieron cargar reservas desde el backend."}
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {isEn ? "Operations" : "Operaciones"}
                </Badge>
                <Badge className="text-[11px]" variant="secondary">
                  {isEn ? "Reservations" : "Reservas"}
                </Badge>
              </div>
              <CardTitle className="text-2xl">
                {isEn ? "Reservations" : "Reservas"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Create and manage stays, check-ins, check-outs, and status transitions."
                  : "Crea y gestiona estancias, check-ins, check-outs y transiciones de estado."}
              </CardDescription>
            </div>

            <ReservationHeaderButtons isEn={isEn} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorLabel ? (
            <Alert variant="destructive">
              <AlertTitle>
                {isEn
                  ? "Could not complete request"
                  : "No se pudo completar la solicitud"}
              </AlertTitle>
              <AlertDescription>{errorLabel}</AlertDescription>
            </Alert>
          ) : null}
          {successLabel ? (
            <Alert variant="success">
              <AlertTitle>
                {isEn ? "Success" : "Éxito"}: {successLabel}
              </AlertTitle>
            </Alert>
          ) : null}

          <ReservationsManager
            orgId={orgId}
            reservations={reservations}
            units={units}
          />
        </CardContent>
      </Card>
    </div>
  );
}
