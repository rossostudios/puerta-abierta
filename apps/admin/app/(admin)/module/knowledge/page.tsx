import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fetchList } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { KnowledgeManager } from "./knowledge-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function KnowledgeModulePage({
  searchParams,
}: PageProps) {
  const locale = await getActiveLocale();
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;
  const isEn = locale === "en-US";

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Organization required" : "Organización requerida"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {isEn
              ? "Select an organization from the sidebar."
              : "Seleccione una organización del menú lateral."}
          </p>
        </CardContent>
      </Card>
    );
  }

  let documents: unknown[] = [];
  try {
    documents = await fetchList("/knowledge-documents", orgId, 200);
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "Access denied" : "Acceso denegado"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{message}</p>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Knowledge Base" : "Base de Conocimiento"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Upload property guides, house rules, and FAQs. The AI concierge uses this knowledge to answer guest questions."
              : "Suba guías de propiedades, reglas de la casa y preguntas frecuentes. El conserje IA usa este conocimiento para responder a los huéspedes."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KnowledgeManager
            orgId={orgId}
            initialDocuments={documents}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
}
