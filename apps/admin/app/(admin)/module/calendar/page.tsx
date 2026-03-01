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
import { fetchList } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";

import { CalendarManager } from "./calendar-manager";

type PageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
    view?: string;
    unit_id?: string;
  }>;
};

export default async function CalendarModulePage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const orgId = await getActiveOrgId();
  const sp = await searchParams;
  const { success, error } = sp;
  const successLabel = success ? safeDecode(success).replaceAll("-", " ") : "";
  const errorLabel = error ? safeDecode(error) : "";

  if (!orgId) {
    return <NoOrgCard isEn={isEn} resource={["the calendar", "el calendario"]} />;
  }

  let reservations: Record<string, unknown>[] = [];
  let blocks: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];

  try {
    const [reservationRows, blockRows, unitRows] = await Promise.all([
      fetchList("/reservations", orgId, 2000),
      fetchList("/calendar/blocks", orgId, 2000),
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

    return <ApiErrorCard isEn={isEn} message={message} />;
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
                {isEn ? "Multi-Unit Calendar" : "Calendario Multi-Unidad"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Visual timeline of reservations and blocks across all units."
                  : "Línea de tiempo visual de reservas y bloqueos en todas las unidades."}
              </CardDescription>
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
            defaultUnitId={sp.unit_id}
            defaultView={
              sp.view === "week"
                ? "week"
                : sp.view === "list"
                  ? "list"
                  : undefined
            }
            orgId={orgId}
            reservations={reservations}
            units={units}
          />
        </CardContent>
      </Card>
    </div>
  );
}
