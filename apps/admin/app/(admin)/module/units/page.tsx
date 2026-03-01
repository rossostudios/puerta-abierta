import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { fetchList } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { UnitsManager } from "./units-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

const DUPLICATE_UNIT_ERROR_RE =
  /duplicate key value violates unique constraint|units_property_id_code_key|23505/i;

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
    return <NoOrgCard isEn={isEn} resource={["units", "unidades"]} />;
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

    return <ApiErrorCard isEn={isEn} message={message} />;
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
