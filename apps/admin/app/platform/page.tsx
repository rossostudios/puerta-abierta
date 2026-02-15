import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { fetchJson } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";

import { PlatformManager } from "./platform-manager";

type PlatformStats = {
  total_organizations?: number;
  total_users?: number;
  total_subscriptions?: number;
  active_subscriptions?: number;
  trialing_subscriptions?: number;
  cancelled_subscriptions?: number;
  conversion_rate?: number;
};

function asNumber(val: unknown): number {
  if (typeof val === "number") return val;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export default async function PlatformAdminPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  let stats: PlatformStats = {};
  let orgs: Record<string, unknown>[] = [];
  let loadError: string | null = null;

  try {
    const [statsRes, orgsRes] = await Promise.all([
      fetchJson<PlatformStats>("/platform/stats"),
      fetchJson<{ data?: Record<string, unknown>[] }>(
        "/platform/organizations"
      ),
    ]);
    stats = statsRes;
    orgs = orgsRes.data ?? [];
  } catch (err) {
    loadError = errorMessage(err);
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Platform Admin" : "Administración de Plataforma"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              {isEn
                ? "Failed to load platform data. You may not have platform admin access."
                : "Error al cargar datos de plataforma. Es posible que no tengas acceso de administrador."}
            </AlertDescription>
          </Alert>
          <p className="mt-2 text-muted-foreground text-xs">{loadError}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {isEn ? "Platform Admin" : "Administración de Plataforma"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Manage all organizations, subscriptions, and platform health."
              : "Gestiona todas las organizaciones, suscripciones y salud de la plataforma."}
          </CardDescription>
        </CardHeader>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={isEn ? "Total organizations" : "Organizaciones totales"}
          value={String(asNumber(stats.total_organizations))}
        />
        <StatCard
          label={isEn ? "Total users" : "Usuarios totales"}
          value={String(asNumber(stats.total_users))}
        />
        <StatCard
          label={isEn ? "Active subscriptions" : "Suscripciones activas"}
          value={String(asNumber(stats.active_subscriptions))}
          helper={`${asNumber(stats.trialing_subscriptions)} ${isEn ? "trialing" : "en prueba"}`}
        />
        <StatCard
          label={isEn ? "Conversion rate" : "Tasa de conversión"}
          value={`${(asNumber(stats.conversion_rate) * 100).toFixed(1)}%`}
          helper={`${asNumber(stats.cancelled_subscriptions)} ${isEn ? "cancelled" : "canceladas"}`}
        />
      </section>

      <PlatformManager locale={locale} orgs={orgs} />
    </div>
  );
}
