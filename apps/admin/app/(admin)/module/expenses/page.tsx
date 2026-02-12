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

import { ExpensesManager } from "./expenses-manager";

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

export default async function ExpensesModulePage({ searchParams }: PageProps) {
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
              ? "Select an organization to load expenses."
              : "Selecciona una organización para cargar gastos."}
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

  let expenses: Record<string, unknown>[] = [];
  let properties: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];

  try {
    const [expenseRows, propertyRows, unitRows] = await Promise.all([
      fetchList("/expenses", orgId, 2000),
      fetchList("/properties", orgId, 500),
      fetchList("/units", orgId, 500),
    ]);
    expenses = expenseRows as Record<string, unknown>[];
    properties = propertyRows as Record<string, unknown>[];
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
              ? "Could not load expenses from the backend."
              : "No se pudieron cargar gastos desde el backend."}
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
            <code className="rounded bg-muted px-1 py-0.5">apps/backend</code>){" "}
            {isEn ? "on port 8000." : "en el puerto 8000."}
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
                <Badge variant="outline">{isEn ? "Finance" : "Finanzas"}</Badge>
                <Badge className="text-[11px]" variant="secondary">
                  {isEn ? "Expenses" : "Gastos"}
                </Badge>
              </div>
              <CardTitle className="text-2xl">
                {isEn ? "Expenses" : "Gastos"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Track operational spending by property, unit, or reservation."
                  : "Seguimiento de gastos por propiedad, unidad o reserva."}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                href="/module/owner-statements"
              >
                {isEn ? "Owner statements" : "Estados"}
              </Link>
              <Link
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" })
                )}
                href="/module/reports"
              >
                {isEn ? "Reports" : "Reportes"}
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

          <ExpensesManager
            expenses={expenses}
            orgId={orgId}
            properties={properties}
            units={units}
          />
        </CardContent>
      </Card>
    </div>
  );
}
