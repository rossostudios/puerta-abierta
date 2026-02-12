import Link from "next/link";
import { ClearOrgButton } from "@/components/shell/clear-org-button";
import { UseOrgButton } from "@/components/shell/use-org-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { fetchList, fetchOrganizations, getApiBaseUrl } from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";
import { createOrganizationAction, seedDemoDataAction } from "./actions";
import { SetupManager } from "./setup-manager";

type SetupPageProps = {
  searchParams: Promise<{ error?: string; success?: string; tab?: string }>;
};

type Row = Record<string, unknown>;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { error, success, tab } = await searchParams;
  const errorMessage = error ? safeDecode(error) : null;
  const successLabel = success
    ? safeDecode(success).replaceAll("-", " ")
    : null;
  const orgId = await getActiveOrgId();
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  if (!orgId) {
    let organizations: Row[] = [];
    try {
      organizations = (await fetchOrganizations(25)) as Row[];
    } catch {
      organizations = [];
    }

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-3">
            <Badge className="w-fit" variant="outline">
              {isEn ? "Setup flow" : "Flujo de configuración"}
            </Badge>
            <CardTitle className="text-2xl">
              {isEn
                ? "Create your first organization"
                : "Crea tu primera organización"}
            </CardTitle>
            <CardDescription>
              {isEn ? (
                <>
                  Before you configure properties and units, you need an
                  organization. Create one here or select an existing one from
                  the top bar.
                </>
              ) : (
                <>
                  Antes de configurar propiedades y unidades, necesitas una
                  organización. Puedes crear una aquí o seleccionar una
                  existente desde la barra superior.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-muted-foreground text-sm md:grid-cols-2">
              <div className="rounded-md border bg-card px-3 py-2">
                <span className="block text-xs uppercase tracking-wide">
                  {isEn ? "API base URL" : "URL base de la API"}
                </span>
                <strong className="font-mono text-foreground">
                  {getApiBaseUrl()}
                </strong>
              </div>
              <div className="rounded-md border bg-card px-3 py-2">
                <span className="block text-xs uppercase tracking-wide">
                  {isEn ? "Organization" : "Organización"}
                </span>
                <strong className="font-mono text-foreground">
                  {isEn ? "Not selected" : "No seleccionada"}
                </strong>
              </div>
            </div>

            <form
              action={createOrganizationAction}
              className="grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-2"
            >
              <input name="tab" type="hidden" value="organizations" />
              <div className="md:col-span-2">
                <p className="font-medium text-foreground text-sm">
                  {isEn ? "New organization" : "Nueva organización"}
                </p>
                <p className="text-muted-foreground text-sm">
                  {isEn
                    ? "This will be the container for your workspace."
                    : "Este será el contenedor de tu espacio de trabajo."}
                </p>
              </div>

              <label className="block md:col-span-2">
                <span className="mb-1 block font-medium text-muted-foreground text-xs">
                  {isEn ? "Name" : "Nombre"}
                </span>
                <Input name="name" placeholder="Puerta Abierta Group" />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-muted-foreground text-xs">
                  {isEn ? "Legal name" : "Razón social"}
                </span>
                <Input name="legal_name" placeholder="Puerta Abierta S.A." />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-muted-foreground text-xs">
                  {isEn ? "Tax ID (RUC)" : "RUC"}
                </span>
                <Input name="ruc" placeholder="80000000-1" />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2 md:col-span-2">
                <Link
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" })
                  )}
                  href="/app"
                >
                  {isEn ? "Back to dashboard" : "Volver al panel"}
                </Link>
                <Button size="sm" type="submit">
                  {isEn ? "Create organization" : "Crear organización"}
                </Button>
              </div>
            </form>

            {organizations.length ? (
              <div className="rounded-lg border bg-card p-4">
                <p className="font-medium text-foreground text-sm">
                  {isEn
                    ? "Existing organizations"
                    : "Organizaciones existentes"}
                </p>
                <p className="text-muted-foreground text-sm">
                  {isEn
                    ? "Switch to one to unlock the rest of Setup."
                    : "Cámbiate a una para desbloquear el resto de Configuración."}
                </p>
                <div className="mt-3 space-y-2">
                  {organizations.map((org) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2"
                      key={String(org.id)}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground text-sm">
                          {String(
                            org.name ?? (isEn ? "Organization" : "Organización")
                          )}
                        </p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {String(org.id)}
                        </p>
                      </div>
                      <UseOrgButton locale={locale} orgId={String(org.id)} />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  let organizations: Row[] = [];
  let properties: Row[] = [];
  let units: Row[] = [];
  let channels: Row[] = [];
  let listings: Row[] = [];

  try {
    const [orgs, props, unitRows, chanRows, listingRows] = await Promise.all([
      fetchOrganizations(25),
      fetchList("/properties", orgId, 25),
      fetchList("/units", orgId, 25),
      fetchList("/channels", orgId, 25),
      fetchList("/listings", orgId, 25),
    ]);

    organizations = orgs as Row[];
    properties = props as Row[];
    units = unitRows as Row[];
    channels = chanRows as Row[];
    listings = listingRows as Row[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("Forbidden: not a member of this organization")) {
      let organizations: Row[] = [];
      try {
        organizations = (await fetchOrganizations(25)) as Row[];
      } catch {
        organizations = [];
      }

      return (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {isEn
                  ? "Organization access changed"
                  : "Acceso a organización cambiado"}
              </CardTitle>
              <CardDescription>
                {isEn ? (
                  <>
                    Your selected organization is no longer available
                    (membership removed or wrong workspace). Clear the selection
                    and choose another organization.
                  </>
                ) : (
                  <>
                    Tu organización seleccionada ya no está disponible
                    (membresía removida o espacio de trabajo incorrecto). Borra
                    la selección y elige otra organización.
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-muted-foreground text-sm">
                  {isEn ? "Selected org ID" : "ID de org seleccionada"}:{" "}
                  <span className="font-mono text-foreground">{orgId}</span>
                </div>
                <ClearOrgButton locale={locale} />
              </div>

              {organizations.length ? (
                <div className="rounded-lg border bg-card p-4">
                  <p className="font-medium text-foreground text-sm">
                    {isEn
                      ? "Available organizations"
                      : "Organizaciones disponibles"}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {isEn
                      ? "Switch to one to continue setup."
                      : "Cámbiate a una para continuar con la configuración."}
                  </p>
                  <div className="mt-3 space-y-2">
                    {organizations.map((org) => (
                      <div
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2"
                        key={String(org.id)}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground text-sm">
                            {String(
                              org.name ??
                                (isEn ? "Organization" : "Organización")
                            )}
                          </p>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">
                            {String(org.id)}
                          </p>
                        </div>
                        <UseOrgButton locale={locale} orgId={String(org.id)} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </AlertTitle>
          <AlertDescription className="space-y-2 text-sm">
            <p>
              {isEn
                ? "Could not load setup data from the backend. Expected at"
                : "No se pudieron cargar los datos de configuración desde el backend. Esperado en"}{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {getApiBaseUrl()}
              </code>
            </p>
            <p className="break-words opacity-80">{message}</p>
            <p className="text-xs opacity-80">
              {isEn ? "Run" : "Ejecuta"}{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                cd apps/backend && npm start
              </code>{" "}
              {isEn ? "then refresh." : "y luego actualiza."}
            </p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <Badge className="w-fit" variant="outline">
            {isEn ? "Setup flow" : "Flujo de configuración"}
          </Badge>
          <CardTitle className="text-2xl">
            {isEn
              ? "Organizations, properties, units, channels, listings"
              : "Organizaciones, propiedades, unidades, canales, anuncios"}
          </CardTitle>
          <CardDescription>
            {isEn ? (
              <>
                Manage base records stored in Supabase. Use the setup manager to
                add, edit, delete, and inspect records in a details sheet.
              </>
            ) : (
              <>
                Administra registros base guardados en Supabase. Usa el
                administrador de configuración para agregar, editar, eliminar e
                inspeccionar registros en una hoja de detalles.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>
                {isEn
                  ? "Could not complete request"
                  : "No se pudo completar la solicitud"}
              </AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
          {successLabel ? (
            <Alert variant="success">
              <AlertTitle>
                {isEn ? "Success" : "Éxito"}: {successLabel}
              </AlertTitle>
            </Alert>
          ) : null}

          <div className="grid gap-2 text-muted-foreground text-sm md:grid-cols-2">
            <div className="rounded-md border bg-card px-3 py-2">
              <span className="block text-xs uppercase tracking-wide">
                {isEn ? "Active organization" : "Organización predeterminada"}
              </span>
              <strong className="font-mono text-foreground">{orgId}</strong>
            </div>
            <div className="rounded-md border bg-card px-3 py-2">
              <span className="block text-xs uppercase tracking-wide">
                {isEn ? "API base URL" : "URL base de la API"}
              </span>
              <strong className="font-mono text-foreground">
                {getApiBaseUrl()}
              </strong>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" })
              )}
              href="/app"
            >
              {isEn ? "Back to dashboard" : "Volver al panel"}
            </Link>
            <Link
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href="/module/properties"
            >
              {isEn ? "Open properties module" : "Abrir módulo de propiedades"}
            </Link>
            <Link
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href="/module/units"
            >
              {isEn ? "Open units module" : "Abrir módulo de unidades"}
            </Link>
            <Link
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href="/module/channels"
            >
              {isEn ? "Open channels module" : "Abrir módulo de canales"}
            </Link>
          </div>

          {properties.length === 0 &&
          units.length === 0 &&
          channels.length === 0 &&
          listings.length === 0 ? (
            <form
              action={seedDemoDataAction}
              className="flex flex-col gap-3 rounded-lg border border-dashed bg-muted/10 p-4 text-sm md:flex-row md:items-center md:justify-between"
            >
              <input name="organization_id" type="hidden" value={orgId} />
              <input name="tab" type="hidden" value={tab ?? ""} />
              <div>
                <p className="font-medium text-foreground">
                  {isEn
                    ? "Want a quick demo workspace?"
                    : "¿Quieres un espacio demo rápido?"}
                </p>
                <p className="text-muted-foreground">
                  {isEn ? (
                    <>
                      Seed properties, units, reservations, tasks, and an
                      example owner statement to explore modules. (Only runs if
                      the organization is empty.)
                    </>
                  ) : (
                    <>
                      Carga propiedades, unidades, reservas, tareas y un estado
                      de ejemplo para explorar los módulos. (Solo se ejecuta si
                      la organización está vacía).
                    </>
                  )}
                </p>
              </div>
              <Button size="sm" type="submit" variant="secondary">
                {isEn ? "Seed demo data" : "Cargar datos de demo"}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Separator />

      <SetupManager
        channels={channels}
        initialTab={tab}
        listings={listings}
        organizations={organizations}
        orgId={orgId}
        properties={properties}
        units={units}
      />
    </div>
  );
}
