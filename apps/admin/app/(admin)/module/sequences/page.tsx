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

import { SequencesManager } from "./sequences-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function SequencesModulePage({
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
              ? "Select an organization to manage sequences."
              : "Selecciona una organización para gestionar secuencias."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let sequences: Record<string, unknown>[] = [];
  let templates: Record<string, unknown>[] = [];
  try {
    [sequences, templates] = await Promise.all([
      fetchList("/communication-sequences", orgId, 200) as Promise<Record<string, unknown>[]>,
      fetchList("/message-templates", orgId, 200) as Promise<Record<string, unknown>[]>,
    ]);
  } catch (err) {
    if (isOrgMembershipError(errorMessage(err)))
      return <OrgAccessChanged orgId={orgId} />;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{isEn ? "Sequences" : "Secuencias"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              {isEn
                ? "Failed to load sequences."
                : "Error al cargar secuencias."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEn ? "Sequences" : "Secuencias"}</CardTitle>
        <CardDescription>
          {isEn
            ? "Automated multi-step messaging sequences triggered by events."
            : "Secuencias automatizadas de mensajería disparadas por eventos."}
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
        <SequencesManager
          locale={locale}
          orgId={orgId}
          sequences={sequences}
          templates={templates}
        />
      </CardContent>
    </Card>
  );
}
