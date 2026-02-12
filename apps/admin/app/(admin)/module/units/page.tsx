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
import { UnitsManager } from "./units-manager";

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

function successLabel(isEn: boolean, raw: string): string {
  const key = safeDecode(raw).trim().toLowerCase();
  if (key === "unit-created") return isEn ? "Unit created" : "Unidad creada";
  return safeDecode(raw).replaceAll("-", " ");
}

export default async function UnitsModulePage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  const successMessage = success ? successLabel(isEn, success) : "";
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
              ? "Select an organization to load units."
              : "Selecciona una organización para cargar unidades."}
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

  let units: Record<string, unknown>[] = [];
  let properties: Record<string, unknown>[] = [];

  try {
    [units, properties] = (await Promise.all([
      fetchList("/units", orgId, 500),
      fetchList("/properties", orgId, 500),
    ])) as [Record<string, unknown>[], Record<string, unknown>[]];
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
              ? "Could not load units from the backend."
              : "No se pudieron cargar unidades desde el backend."}
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
                <Badge variant="outline">
                  {isEn ? "Portfolio" : "Portafolio"}
                </Badge>
                <Badge className="text-[11px]" variant="secondary">
                  {isEn ? "Units" : "Unidades"}
                </Badge>
              </div>
              <CardTitle className="text-2xl">
                {isEn ? "Units" : "Unidades"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Define rentable units with occupancy and capacity settings."
                  : "Define unidades rentables con configuración de capacidad y ocupación."}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                href="/module/properties"
              >
                {isEn ? "Properties" : "Propiedades"}
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
          {successMessage ? (
            <Alert variant="success">
              <AlertTitle>
                {isEn ? "Success" : "Éxito"}: {successMessage}
              </AlertTitle>
            </Alert>
          ) : null}

          <UnitsManager orgId={orgId} properties={properties} units={units} />
        </CardContent>
      </Card>
    </div>
  );
}
