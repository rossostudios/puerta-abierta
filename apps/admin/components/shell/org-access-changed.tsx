import Link from "next/link";

import { ClearOrgButton } from "@/components/shell/clear-org-button";
import { UseOrgButton } from "@/components/shell/use-org-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchOrganizations } from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

type OrgRow = {
  id: string;
  name?: string | null;
};

export async function OrgAccessChanged({
  orgId,
  title,
  description,
}: {
  orgId: string | null;
  title?: string;
  description?: string;
}) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const resolvedTitle =
    title ??
    (isEn ? "Organization access changed" : "Acceso a organización cambiado");
  const resolvedDescription =
    description ??
    (isEn
      ? "Your selected organization is no longer available (membership removed or wrong workspace). Clear the selection and choose another organization."
      : "Tu organización seleccionada ya no está disponible (membresía removida o espacio de trabajo incorrecto). Borra la selección y elige otra organización.");

  let organizations: OrgRow[] = [];

  try {
    organizations = (await fetchOrganizations(25)) as OrgRow[];
  } catch {
    organizations = [];
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {isEn ? "Workspace" : "Espacio de trabajo"}
            </Badge>
            <Badge className="text-[11px]" variant="secondary">
              {isEn ? "Action required" : "Acción requerida"}
            </Badge>
          </div>
          <CardTitle>{resolvedTitle}</CardTitle>
          <CardDescription>{resolvedDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-muted-foreground text-sm">
              {isEn ? "Selected org ID" : "ID de org seleccionada"}:{" "}
              <span className="font-mono text-foreground">
                {orgId ?? (isEn ? "Not set" : "Sin definir")}
              </span>
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
                  ? "Switch to one to continue."
                  : "Cámbiate a una para continuar."}
              </p>
              <div className="mt-3 space-y-2">
                {organizations.map((org) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2"
                    key={org.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground text-sm">
                        {org.name ?? (isEn ? "Organization" : "Organización")}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {org.id}
                      </p>
                    </div>
                    <UseOrgButton locale={locale} orgId={org.id} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/10 p-4 text-muted-foreground text-sm">
              {isEn
                ? "No organizations yet. Create your first one in Setup."
                : "Todavía no hay organizaciones. Crea tu primera en Configuración."}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Link
              className={cn(
                buttonVariants({ variant: "secondary", size: "sm" })
              )}
              href="/setup"
            >
              {isEn ? "Open setup" : "Abrir configuración"}
            </Link>
            <Link
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              href="/app"
            >
              {isEn ? "Back to dashboard" : "Volver al panel"}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
