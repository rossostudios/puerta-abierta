import Link from "next/link";

import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

import { CalendarManager } from "./calendar-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function CalendarModulePage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;
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
              ? "Select an organization to load the calendar."
              : "Selecciona una organización para cargar el calendario."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {isEn ? (
            <>
              Select an organization from the top bar, or create one in{" "}
              <code className="rounded bg-muted px-1 py-0.5">Setup</code>.
            </>
          ) : (
            <>
              Selecciona una organización desde la barra superior o crea una en{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                Configuración
              </code>
              .
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  let reservations: Record<string, unknown>[] = [];
  let blocks: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];

  try {
    const [reservationRows, blockRows, unitRows] = await Promise.all([
      fetchList("/reservations", orgId, 1000),
      fetchList("/calendar/blocks", orgId, 1000),
      fetchList("/units", orgId, 500),
    ]);

    reservations = reservationRows as Record<string, unknown>[];
    blocks = blockRows as Record<string, unknown>[];
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
              ? "Could not load calendar data from the backend."
              : "No se pudieron cargar los datos del calendario desde el backend."}
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
            {isEn ? "Make sure" : "Asegúrate de que"}{" "}
            <span className="font-medium">FastAPI</span>{" "}
            {isEn ? "is running" : "esté ejecutándose"} (
            {isEn ? "from" : "desde"}{" "}
            <code className="rounded bg-muted px-1 py-0.5">apps/backend</code>)
            {isEn ? " on port 8000." : " en el puerto 8000."}
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
                  {isEn ? "Calendar" : "Calendario"}
                </Badge>
              </div>
              <CardTitle className="text-2xl">
                {isEn ? "Calendar" : "Calendario"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Review active stays and manage manual availability blocks."
                  : "Revisa estancias activas y gestiona bloqueos manuales."}
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
                href="/module/tasks"
              >
                {isEn ? "Tasks" : "Tareas"}
              </Link>
            </div>
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

          <CalendarManager
            blocks={blocks}
            orgId={orgId}
            reservations={reservations}
            units={units}
          />
        </CardContent>
      </Card>
    </div>
  );
}
