import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { fetchList, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { UnitsManager } from "./units-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

const DUPLICATE_UNIT_ERROR_RE =
  /duplicate key value violates unique constraint|units_property_id_code_key|23505/i;

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

function errorLabel(isEn: boolean, raw: string): string {
  const decoded = safeDecode(raw).trim();
  if (!decoded) return "";

  const [key, meta] = decoded.split(":", 2);
  if (key === "unit-code-duplicate") {
    if (meta) {
      return isEn
        ? `This unit code already exists for this property. Try "${meta}".`
        : `Este código de unidad ya existe para esta propiedad. Prueba "${meta}".`;
    }
    return isEn
      ? "This unit code already exists for this property."
      : "Este código de unidad ya existe para esta propiedad.";
  }

  if (key === "unit-create-failed") {
    return isEn
      ? "Could not create the unit. Review the form and try again."
      : "No se pudo crear la unidad. Revisa el formulario e inténtalo de nuevo.";
  }

  if (DUPLICATE_UNIT_ERROR_RE.test(decoded)) {
    return isEn
      ? "This unit code already exists for this property."
      : "Este código de unidad ya existe para esta propiedad.";
  }

  return decoded;
}

export default async function UnitsModulePage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  const successMessage = success ? successLabel(isEn, safeDecode(success)) : "";
  const errorAlertMessage = error ? errorLabel(isEn, safeDecode(error)) : "";

  if (!orgId) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
        <h3 className="font-semibold text-lg tracking-tight">
          {isEn
            ? "Missing organization context"
            : "Falta contexto de organización"}
        </h3>
        <p className="mt-1 text-muted-foreground text-sm">
          {isEn
            ? "Select an organization to load units."
            : "Selecciona una organización para cargar unidades."}
        </p>
        <div className="mt-4 text-muted-foreground text-sm">
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
        </div>
      </div>
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
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
        <h3 className="font-semibold text-lg tracking-tight">
          {isEn ? "API connection failed" : "Fallo de conexión a la API"}
        </h3>
        <p className="mt-1 text-muted-foreground text-sm">
          {isEn
            ? "Could not load units from the backend."
            : "No se pudieron cargar unidades desde el backend."}
        </p>
        <div className="mt-4 space-y-2 text-muted-foreground text-sm">
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
        </div>
      </div>
    );
  }

  return (
    <UnitsManager
      error={errorAlertMessage}
      orgId={orgId}
      properties={properties}
      success={successMessage}
      units={units}
    />
  );
}
