import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { getActiveRole } from "@/lib/role";
import GovernanceManager from "./governance-manager";

export default async function GovernancePage() {
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
              ? "Select an organization to access AI Settings."
              : "Selecciona una organización para acceder a la configuración de IA."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {isEn
            ? "Use the organization switcher in the top bar."
            : "Usa el selector de organización en la barra superior."}
        </CardContent>
      </Card>
    );
  }

  const role = await getActiveRole(orgId);

  if (role !== null && role !== "owner_admin") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Access restricted" : "Acceso restringido"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Only administrators can access AI Settings."
              : "Solo los administradores pueden acceder a la configuración de IA."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {isEn
            ? "Contact your organization administrator if you need access."
            : "Contacta al administrador de tu organización si necesitas acceso."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="-mx-3 -mt-3 -mb-3 sm:-mx-4 sm:-mt-4 sm:-mb-4 lg:-mx-5 lg:-mt-5 lg:-mb-5 xl:-mx-7 xl:-mt-7 xl:-mb-7">
      <GovernanceManager locale={locale} orgId={orgId} />
    </div>
  );
}
