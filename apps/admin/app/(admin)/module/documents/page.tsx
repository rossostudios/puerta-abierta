import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { getActiveOrgId } from "@/lib/org";

import { DocumentsManager } from "./documents-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function DocumentsModulePage({
  searchParams,
}: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Missing organization" : "Falta organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to manage documents."
              : "Selecciona una organización para gestionar documentos."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let data: Record<string, unknown>[] = [];
  try {
    data = (await fetchList("/documents", orgId, 500)) as Record<string, unknown>[];
  } catch (err) {
    if (isOrgMembershipError(errorMessage(err))) return <OrgAccessChanged orgId={orgId} />;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{isEn ? "Documents" : "Documentos"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              {isEn ? "Failed to load documents." : "Error al cargar documentos."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEn ? "Documents" : "Documentos"}</CardTitle>
        <CardDescription>
          {isEn
            ? "Manage contracts, receipts, photos, and inspection reports."
            : "Gestiona contratos, recibos, fotos e informes de inspección."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success && (
          <Alert className="mb-4">
            <AlertDescription>{success.replaceAll("-", " ")}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert className="mb-4" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DocumentsManager data={data} locale={locale} orgId={orgId} />
      </CardContent>
    </Card>
  );
}
