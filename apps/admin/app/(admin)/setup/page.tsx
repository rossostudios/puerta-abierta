import { ClearOrgButton } from "@/components/shell/clear-org-button";
import { UseOrgButton } from "@/components/shell/use-org-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList, fetchOrganizations, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { asString, type Row } from "./setup-components";
import { SetupWizard } from "./setup-wizard";

/** Extract rows from a settled promise, or fall back to [] and record a warning. */
function settledOrEmpty(
  result: PromiseSettledResult<unknown[]>,
  label: string,
  warnings: string[]
): Row[] {
  if (result.status === "fulfilled") return result.value as Row[];
  console.error(`Setup: failed to load ${label}:`, result.reason);
  warnings.push(label);
  return [];
}

type SetupPageProps = {
  searchParams: Promise<{
    tab?: string;
    plan?: string;
  }>;
};

/* ================================================================== */
/*  Main page component (server — data-fetching shell)                 */
/* ================================================================== */

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { tab, plan } = await searchParams;
  const orgId = await getActiveOrgId();
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  /* ---------------------------------------------------------------- */
  /*  No org selected — render wizard at step 1                        */
  /* ---------------------------------------------------------------- */

  if (!orgId) {
    let organizations: Row[] = [];
    let loadError: string | null = null;
    try {
      organizations = (await fetchOrganizations(25)) as Row[];
    } catch (err) {
      console.error("Failed to load organizations:", errorMessage(err));
      loadError = isEn
        ? "Could not load your organizations. Please check that the backend is running and try again."
        : "No se pudieron cargar tus organizaciones. Verifica que el backend esté corriendo e intenta de nuevo.";
    }

    return (
      <>
        {loadError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>
              {isEn ? "Connection error" : "Error de conexión"}
            </AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}
        <SetupWizard
          key="no-org"
          initialOrgId={null}
          initialOrganization={null}
          initialOrganizations={organizations}
          initialProperties={[]}
          initialUnits={[]}
          integrations={[]}
          locale={locale}
          apiBaseUrl={getApiBaseUrl()}
          initialTab={tab}
          initialPlanId={plan}
        />
      </>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Org selected — load data                                         */
  /* ---------------------------------------------------------------- */

  /* Phase A — Critical: organizations (must succeed) */
  let organizations: Row[] = [];
  try {
    organizations = (await fetchOrganizations(25)) as Row[];
  } catch (err) {
    const message = errorMessage(err);

    /* Forbidden: membership removed */
    if (isOrgMembershipError(message)) {
      let availableOrgs: Row[] = [];
      try {
        availableOrgs = (await fetchOrganizations(25)) as Row[];
      } catch {
        availableOrgs = [];
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

              {availableOrgs.length ? (
                <div className="rounded-lg border bg-card p-4">
                  <p className="font-medium text-foreground text-sm">
                    {isEn
                      ? "Available organizations"
                      : "Organizaciones disponibles"}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {isEn
                      ? "Switch to one to continue onboarding."
                      : "Cámbiate a una para continuar con el onboarding."}
                  </p>
                  <div className="mt-3 space-y-2">
                    {availableOrgs.map((org) => (
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

    /* API connection failed */
    return (
      <div className="space-y-6">
        <Alert variant="destructive">
          <AlertTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </AlertTitle>
          <AlertDescription className="space-y-2 text-sm">
            <p>
              {isEn
                ? "Could not load onboarding data from the backend. Expected at"
                : "No se pudieron cargar los datos de onboarding desde el backend. Esperado en"}{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {getApiBaseUrl()}
              </code>
            </p>
            <p className="break-words opacity-80">{message}</p>
            <p className="text-xs opacity-80">
              {isEn ? "Run" : "Ejecuta"}{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                cd apps/backend-rs && cargo run
              </code>{" "}
              {isEn ? "then refresh." : "y luego actualiza."}
            </p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  /* Phase B — Non-critical: properties, units, integrations */
  const warnings: string[] = [];
  const [propsResult, unitsResult, integrationsResult] =
    await Promise.allSettled([
      fetchList("/properties", orgId, 25),
      fetchList("/units", orgId, 25),
      fetchList("/integrations", orgId, 50),
    ]);

  const properties = settledOrEmpty(
    propsResult,
    isEn ? "properties" : "propiedades",
    warnings
  );
  const units = settledOrEmpty(
    unitsResult,
    isEn ? "units" : "unidades",
    warnings
  );
  const integrations = settledOrEmpty(
    integrationsResult,
    isEn ? "integrations" : "integraciones",
    warnings
  );

  /* ---------------------------------------------------------------- */
  /*  Derive initial state for the wizard                              */
  /* ---------------------------------------------------------------- */

  const activeOrganization =
    organizations.find((row) => asString(row.id) === orgId) ??
    ({ id: orgId } as Row);

  const dataFingerprint = `${orgId}-${properties.length}-${units.length}`;

  return (
    <>
      {warnings.length > 0 && (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>
            {isEn
              ? "Some data could not be loaded"
              : "Algunos datos no se pudieron cargar"}
          </AlertTitle>
          <AlertDescription>
            {isEn
              ? `Could not load: ${warnings.join(", ")}. You can still continue setup — the affected steps will show empty data.`
              : `No se pudieron cargar: ${warnings.join(", ")}. Puedes continuar con la configuración — los pasos afectados mostrarán datos vacíos.`}
          </AlertDescription>
        </Alert>
      )}
      <SetupWizard
        key={dataFingerprint}
        initialOrgId={orgId}
        initialOrganization={activeOrganization}
        initialOrganizations={organizations}
        initialProperties={properties}
        initialUnits={units}
        integrations={integrations}
        locale={locale}
        apiBaseUrl={getApiBaseUrl()}
        initialTab={tab}
        initialPlanId={plan}
      />
    </>
  );
}
