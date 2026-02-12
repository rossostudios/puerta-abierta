import {
  AuditIcon,
  Building01Icon,
  UserCircle02Icon,
  WebhookIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export default async function SettingsPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const workspaceItems = [
    {
      href: "/module/organizations",
      icon: Building01Icon,
      title: isEn ? "Organizations" : "Organizaciones",
      description: isEn
        ? "Manage memberships, defaults, and workspace structure."
        : "Gestiona membresías, ajustes predeterminados y estructura del espacio.",
    },
    {
      href: "/module/integration-events",
      icon: WebhookIcon,
      title: isEn ? "Integrations" : "Integraciones",
      description: isEn
        ? "Review webhook activity and third-party sync events."
        : "Revisa actividad de webhooks y eventos de sincronización.",
    },
    {
      href: "/module/audit-logs",
      icon: AuditIcon,
      title: isEn ? "Audit logs" : "Registros de auditoría",
      description: isEn
        ? "Track critical changes and security-sensitive actions."
        : "Rastrea cambios críticos y acciones sensibles de seguridad.",
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {isEn ? "Settings" : "Configuración"}
            </Badge>
            <Badge variant="secondary">
              {isEn ? "Workspace control" : "Control del workspace"}
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Workspace settings" : "Configuración del workspace"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Centralized control for organizations, integrations, and auditing."
              : "Control centralizado de organizaciones, integraciones y auditoría."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {workspaceItems.map((item) => (
            <article
              className="rounded-2xl border border-border/80 bg-background/80 p-4"
              key={item.href}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-muted/50">
                <Icon
                  className="text-muted-foreground"
                  icon={item.icon}
                  size={17}
                />
              </div>
              <h3 className="mt-3 font-semibold text-sm">{item.title}</h3>
              <p className="mt-1 min-h-[42px] text-muted-foreground text-xs leading-5">
                {item.description}
              </p>
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" }),
                  "mt-3 w-full justify-center rounded-xl"
                )}
                href={item.href}
              >
                {isEn ? "Open" : "Abrir"}
              </Link>
            </article>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>
            {isEn ? "Personal preferences" : "Preferencias personales"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Manage your profile and language preferences."
              : "Administra tu perfil y preferencias de idioma."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "outline" }),
              "inline-flex items-center gap-2 rounded-xl"
            )}
            href="/account"
          >
            <Icon icon={UserCircle02Icon} size={15} />
            {isEn ? "Go to profile" : "Ir a perfil"}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
