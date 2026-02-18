import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJson, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { ContractTemplatesSection } from "./contract-templates";
import { OrgSettingsForm } from "./org-settings-form";

type OrgRecord = {
  id: string;
  name: string;
  legal_name: string | null;
  ruc: string | null;
  default_currency: string;
  timezone: string;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_holder: string | null;
  qr_image_url: string | null;
  logo_url: string | null;
};

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function asOpt(v: unknown): string | null {
  const t = asStr(v);
  return t || null;
}

export default async function OrganizationSettingsPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();

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
              ? "Select an organization to configure settings."
              : "Selecciona una organización para configurar."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let org: OrgRecord | null = null;

  try {
    const raw = await fetchJson<Record<string, unknown>>(
      `/organizations/${encodeURIComponent(orgId)}`
    );
    org = {
      id: asStr(raw.id),
      name: asStr(raw.name),
      legal_name: asOpt(raw.legal_name),
      ruc: asOpt(raw.ruc),
      default_currency: asStr(raw.default_currency) || "PYG",
      timezone: asStr(raw.timezone) || "America/Asuncion",
      bank_name: asOpt(raw.bank_name),
      bank_account_number: asOpt(raw.bank_account_number),
      bank_account_holder: asOpt(raw.bank_account_holder),
      qr_image_url: asOpt(raw.qr_image_url),
      logo_url: asOpt(raw.logo_url),
    };
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
              ? "Could not load organization details."
              : "No se pudieron cargar los datos de la organización."}
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
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {isEn ? "Settings" : "Configuración"}
            </Badge>
            <Badge variant="secondary">
              {isEn ? "Organization" : "Organización"}
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Organization settings" : "Configuración de organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Manage branding, currency, timezone, and banking details."
              : "Gestiona marca, moneda, zona horaria y datos bancarios."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OrgSettingsForm org={org} />
        </CardContent>
      </Card>

      <ContractTemplatesSection orgId={orgId} />
    </div>
  );
}
