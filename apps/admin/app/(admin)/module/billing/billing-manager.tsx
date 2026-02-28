"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency } from "@/lib/format";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}
function asNumber(v: unknown): number {
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("API error");
  return res.json();
}

export function BillingManager({
  billingData,
  plans,
  locale,
  orgId,
}: {
  billingData: Record<string, unknown>;
  plans: Record<string, unknown>[];
  locale: string;
  orgId: string;
}) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const subscription = asObj(billingData.subscription);
  const currentPlan = asObj(billingData.plan);
  const usage = asObj(billingData.usage);

  const hasSubscription = !!subscription.id;
  const status = asString(subscription.status);
  const planName = asString(currentPlan.name);

  const usageProperties = asNumber(usage.properties);
  const usageUnits = asNumber(usage.units);
  const usageUsers = asNumber(usage.users);

  const maxProperties = asNumber(currentPlan.max_properties) || 999;
  const maxUnits = asNumber(currentPlan.max_units) || 999;
  const maxUsers = asNumber(currentPlan.max_users) || 999;

  async function handleSubscribe(planId: string) {
    setSubmitting(true);
    try {
      await apiPost("/billing/subscribe", {
        organization_id: orgId,
        plan_id: planId,
      });
      router.refresh();
      setSubmitting(false);
    } catch {
      /* ignore */
      setSubmitting(false);
    }
  }

  async function cancelSubscription() {
    setSubmitting(true);
    try {
      await apiPost("/billing/cancel", { org_id: orgId });
      router.refresh();
      setSubmitting(false);
    } catch {
      /* ignore */
      setSubmitting(false);
    }
  }

  function handleCancel() {
    toast(
      isEn
        ? "Cancel your subscription? You can resubscribe anytime."
        : "¿Cancelar tu suscripción? Puedes volver a suscribirte.",
      {
        action: {
          label: isEn ? "Cancel subscription" : "Cancelar suscripción",
          onClick: async () => {
            await cancelSubscription();
          },
        },
      }
    );
  }

  return (
    <div className="space-y-6">
      {/* Current plan section */}
      {hasSubscription ? (
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg">
                {isEn ? "Current Plan" : "Plan Actual"}: {planName}
              </h3>
              <StatusBadge label={status} value={status} />
            </div>
            {status !== "cancelled" && (
              <Button
                disabled={submitting}
                onClick={handleCancel}
                size="sm"
                variant="outline"
              >
                {isEn ? "Cancel" : "Cancelar"}
              </Button>
            )}
          </div>

          {asString(subscription.trial_ends_at) && status === "trialing" && (
            <p className="mb-3 text-muted-foreground text-sm">
              {isEn ? "Trial ends:" : "Prueba termina:"}{" "}
              {asString(subscription.trial_ends_at).slice(0, 10)}
            </p>
          )}

          {/* Usage meters */}
          <div className="grid gap-4 sm:grid-cols-3">
            <UsageMeter
              current={usageProperties}
              isEn={isEn}
              label={isEn ? "Properties" : "Propiedades"}
              max={maxProperties}
            />
            <UsageMeter
              current={usageUnits}
              isEn={isEn}
              label={isEn ? "Units" : "Unidades"}
              max={maxUnits}
            />
            <UsageMeter
              current={usageUsers}
              isEn={isEn}
              label={isEn ? "Users" : "Usuarios"}
              max={maxUsers}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/50 p-4 text-center">
          <p className="text-muted-foreground">
            {isEn
              ? "No active subscription. Choose a plan below."
              : "Sin suscripción activa. Elige un plan abajo."}
          </p>
        </div>
      )}

      {/* Plans grid */}
      <div>
        <h3 className="mb-3 font-semibold text-lg">
          {isEn ? "Available Plans" : "Planes Disponibles"}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const id = asString(plan.id);
            const name = asString(plan.name);
            const priceUsd = asNumber(plan.price_usd);
            const pricePyg = asNumber(plan.price_pyg);
            const isCurrent = id === asString(currentPlan.id);

            return (
              <div
                className={`rounded-lg border p-4 ${isCurrent ? "border-primary ring-2 ring-primary/20" : ""}`}
                key={id}
              >
                <h4 className="font-bold text-lg">{name}</h4>
                <p className="font-semibold text-2xl">
                  {priceUsd === 0
                    ? isEn
                      ? "Free"
                      : "Gratis"
                    : formatCurrency(priceUsd, "USD", locale)}
                  <span className="font-normal text-muted-foreground text-sm">
                    {priceUsd > 0 && (isEn ? "/mo" : "/mes")}
                  </span>
                </p>
                {pricePyg > 0 && (
                  <p className="text-muted-foreground text-sm">
                    ≈ {formatCurrency(pricePyg, "PYG", locale)}
                  </p>
                )}
                <ul className="mt-3 space-y-1 text-muted-foreground text-sm">
                  <li>
                    {asNumber(plan.max_properties)}{" "}
                    {isEn ? "properties" : "propiedades"}
                  </li>
                  <li>
                    {asNumber(plan.max_units)} {isEn ? "units" : "unidades"}
                  </li>
                  <li>
                    {asNumber(plan.max_users)} {isEn ? "users" : "usuarios"}
                  </li>
                </ul>
                <Button
                  className="mt-3 w-full"
                  disabled={isCurrent || submitting}
                  onClick={() => handleSubscribe(id)}
                  size="sm"
                  variant={isCurrent ? "outline" : "default"}
                >
                  {isCurrent
                    ? isEn
                      ? "Current"
                      : "Actual"
                    : isEn
                      ? "Select"
                      : "Seleccionar"}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upgrade warning banners */}
      <UpgradePrompt
        isEn={isEn}
        limits={{
          agent_calls: asNumber(currentPlan.max_agent_calls_monthly) || 999,
          messages: asNumber(currentPlan.max_messages_monthly) || 999,
          properties: maxProperties,
        }}
        usage={{
          agent_calls: asNumber(usage.agent_calls),
          messages: asNumber(usage.messages),
          properties: usageProperties,
        }}
      />

      {/* Usage history charts */}
      <UsageHistoryCharts isEn={isEn} orgId={orgId} />

      {/* Plan comparison matrix */}
      <PlanComparisonMatrix
        currentPlanId={asString(currentPlan.id)}
        isEn={isEn}
        orgId={orgId}
      />

      {/* Referral program */}
      <ReferralCard isEn={isEn} orgId={orgId} />
    </div>
  );
}

function ReferralCard({ orgId, isEn }: { orgId: string; isEn: boolean }) {
  const [copied, setCopied] = useState(false);

  const codeQuery = useQuery({
    queryKey: ["referral-code", orgId],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/referrals/my-code?org_id=${encodeURIComponent(orgId)}`,
        { method: "GET", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const referral = data.referral;
      if (referral?.code) {
        return String(referral.code);
      }
      return null;
    },
  });

  const historyQuery = useQuery({
    queryKey: ["referral-history", orgId],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/referrals/history?org_id=${encodeURIComponent(orgId)}`,
        { method: "GET", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const histData = await res.json();
      if (Array.isArray(histData.data)) {
        return histData.data as Record<string, unknown>[];
      }
      return [];
    },
  });

  const loading = codeQuery.isLoading || historyQuery.isLoading;
  const code = codeQuery.data ?? null;
  const redemptions = historyQuery.data ?? [];

  function handleCopy() {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-2 font-semibold text-lg">
        {isEn ? "Refer & Earn" : "Refiere y Gana"}
      </h3>
      <p className="mb-3 text-muted-foreground text-sm">
        {isEn
          ? "Share your referral code with other property managers. When they subscribe, both of you earn 1 free month."
          : "Comparte tu código de referido con otros administradores. Cuando se suscriban, ambos ganan 1 mes gratis."}
      </p>

      {loading ? (
        <p className="text-muted-foreground text-sm">
          {isEn ? "Loading..." : "Cargando..."}
        </p>
      ) : code ? (
        <div className="flex items-center gap-2">
          <Input className="font-mono text-lg" readOnly value={code} />
          <Button onClick={handleCopy} size="sm" variant="outline">
            {copied
              ? isEn
                ? "Copied!"
                : "Copiado!"
              : isEn
                ? "Copy"
                : "Copiar"}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {isEn
            ? "Could not load referral code."
            : "No se pudo cargar el código de referido."}
        </p>
      )}

      {redemptions.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 font-medium text-sm">
            {isEn ? "Referral History" : "Historial de Referidos"} (
            {redemptions.length})
          </h4>
          <ul className="space-y-1 text-muted-foreground text-sm">
            {redemptions.map((r) => (
              <li
                className="flex items-center gap-2"
                key={`${String(r.created_at)}-${String(r.status)}`}
              >
                <StatusBadge
                  label={String(r.status ?? "pending")}
                  value={String(r.status ?? "pending")}
                />
                <span>{String(r.created_at ?? "").slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UsageMeter({
  label,
  current,
  max,
  isEn,
}: {
  label: string;
  current: number;
  max: number;
  isEn: boolean;
}) {
  const percent = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {current} / {max}
        </span>
      </div>
      <Progress value={percent} />
      {percent >= 90 && (
        <p className="mt-1 text-amber-600 text-xs">
          {isEn ? "Approaching limit" : "Acercándose al límite"}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Upgrade Prompt — 80%+ usage warning banners                               */
/* -------------------------------------------------------------------------- */

type UsageLimits = {
  agent_calls: number;
  messages: number;
  properties: number;
};

export function UpgradePrompt({
  isEn,
  usage,
  limits,
}: {
  isEn: boolean;
  usage: UsageLimits;
  limits: UsageLimits;
}) {
  const warnings: { key: string; label: string; percent: number }[] = [];

  const checks: { key: string; enLabel: string; esLabel: string }[] = [
    {
      key: "agent_calls",
      enLabel: "agent calls",
      esLabel: "llamadas de agente",
    },
    { key: "messages", enLabel: "messages", esLabel: "mensajes" },
    { key: "properties", enLabel: "properties", esLabel: "propiedades" },
  ];

  for (const c of checks) {
    const used = usage[c.key as keyof UsageLimits];
    const limit = limits[c.key as keyof UsageLimits];
    if (limit > 0 && used / limit >= 0.8) {
      warnings.push({
        key: c.key,
        label: isEn ? c.enLabel : c.esLabel,
        percent: Math.round((used / limit) * 100),
      });
    }
  }

  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((w) => (
        <div
          className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40"
          key={w.key}
        >
          <p className="text-amber-800 text-sm dark:text-amber-200">
            {isEn
              ? `You've used ${w.percent}% of your ${w.label}. Upgrade to unlock more ${w.label}.`
              : `Has usado el ${w.percent}% de tus ${w.label}. Mejora tu plan para desbloquear más ${w.label}.`}
          </p>
          <span className="ml-3 shrink-0 rounded bg-amber-200 px-2 py-0.5 font-medium text-amber-900 text-xs dark:bg-amber-800 dark:text-amber-100">
            {w.percent}%
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Usage History Charts — sparkline cards per event type                      */
/* -------------------------------------------------------------------------- */

type UsageHistoryMonth = {
  month: string;
  event_type: string;
  count: number;
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  agent_call: "#6366f1",
  message_sent: "#0ea5e9",
  property_created: "#10b981",
  unit_created: "#f59e0b",
  workflow_run: "#ec4899",
  integration_call: "#8b5cf6",
};

function eventColor(eventType: string): string {
  return EVENT_TYPE_COLORS[eventType] ?? "#94a3b8";
}

function eventLabel(eventType: string, isEn: boolean): string {
  const labels: Record<string, [string, string]> = {
    agent_call: ["Agent Calls", "Llamadas de Agente"],
    message_sent: ["Messages Sent", "Mensajes Enviados"],
    property_created: ["Properties Created", "Propiedades Creadas"],
    unit_created: ["Units Created", "Unidades Creadas"],
    workflow_run: ["Workflow Runs", "Ejecuciones de Flujo"],
    integration_call: ["Integration Calls", "Llamadas de Integración"],
  };
  const pair = labels[eventType];
  if (pair) return isEn ? pair[0] : pair[1];
  return eventType.replace(/_/g, " ");
}

function SparklineCard({
  eventType,
  months,
  isEn,
}: {
  eventType: string;
  months: { month: string; count: number }[];
  isEn: boolean;
}) {
  const total = months.reduce((s, m) => s + m.count, 0);
  const maxVal = Math.max(...months.map((m) => m.count), 1);

  // SVG sparkline dimensions
  const W = 160;
  const H = 40;
  const padding = 2;
  const usableW = W - padding * 2;
  const usableH = H - padding * 2;

  const points = months.map((m, i) => {
    const x =
      padding +
      (months.length > 1 ? (i / (months.length - 1)) * usableW : usableW / 2);
    const y = padding + usableH - (m.count / maxVal) * usableH;
    return `${x},${y}`;
  });

  const color = eventColor(eventType);

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-sm">
          {eventLabel(eventType, isEn)}
        </span>
        <span className="font-semibold text-sm" style={{ color }}>
          {total.toLocaleString()}
        </span>
      </div>
      <svg
        className="w-full"
        height={H}
        preserveAspectRatio="none"
        viewBox={`0 0 ${W} ${H}`}
      >
        {/* filled area under the line */}
        {months.length > 1 && (
          <polygon
            fill={color}
            opacity={0.1}
            points={`${padding},${H - padding} ${points.join(" ")} ${padding + usableW},${H - padding}`}
          />
        )}
        {/* the line itself */}
        <polyline
          fill="none"
          points={points.join(" ")}
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
        />
        {/* dots on each data point */}
        {months.map((m, i) => {
          const x =
            padding +
            (months.length > 1
              ? (i / (months.length - 1)) * usableW
              : usableW / 2);
          const y = padding + usableH - (m.count / maxVal) * usableH;
          return <circle cx={x} cy={y} fill={color} key={m.month} r={2.5} />;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-muted-foreground text-xs">
        {months.length > 0 && <span>{months[0].month}</span>}
        {months.length > 1 && <span>{months.at(-1).month}</span>}
      </div>
    </div>
  );
}

function UsageHistoryCharts({ orgId, isEn }: { orgId: string; isEn: boolean }) {
  const [data, setData] = useState<UsageHistoryMonth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `${API_BASE}/billing/usage-history?org_id=${encodeURIComponent(orgId)}&months=6`,
          { method: "GET", headers: { Accept: "application/json" } }
        );
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          const rows = Array.isArray(json.data) ? json.data : [];
          setData(
            rows.map((r: Record<string, unknown>) => ({
              month: asString(r.month),
              event_type: asString(r.event_type),
              count: asNumber(r.count),
            }))
          );
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Group by event_type
  const byType: Record<string, { month: string; count: number }[]> = {};
  for (const row of data) {
    if (!byType[row.event_type]) byType[row.event_type] = [];
    byType[row.event_type].push({ month: row.month, count: row.count });
  }
  // Sort each group by month ascending
  for (const key of Object.keys(byType)) {
    byType[key].sort((a, b) => a.month.localeCompare(b.month));
  }

  const eventTypes = Object.keys(byType).sort();

  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 font-semibold text-lg">
        {isEn ? "Usage History (6 months)" : "Historial de Uso (6 meses)"}
      </h3>
      {loading ? (
        <p className="text-muted-foreground text-sm">
          {isEn ? "Loading usage data..." : "Cargando datos de uso..."}
        </p>
      ) : eventTypes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {isEn
            ? "No usage data available yet."
            : "Aún no hay datos de uso disponibles."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {eventTypes.map((et) => (
            <SparklineCard
              eventType={et}
              isEn={isEn}
              key={et}
              months={byType[et]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Plan Comparison Matrix                                                     */
/* -------------------------------------------------------------------------- */

type PlanComparison = {
  id: string;
  name: string;
  max_properties: number;
  max_units: number;
  max_users: number;
  max_agent_calls_monthly: number;
  max_messages_monthly: number;
  max_integrations: number;
  max_workflow_rules: number;
};

const COMPARISON_COLUMNS: {
  key: keyof PlanComparison;
  en: string;
  es: string;
}[] = [
  { key: "name", en: "Plan", es: "Plan" },
  { key: "max_properties", en: "Properties", es: "Propiedades" },
  { key: "max_units", en: "Units", es: "Unidades" },
  { key: "max_users", en: "Users", es: "Usuarios" },
  {
    key: "max_agent_calls_monthly",
    en: "Agent Calls/mo",
    es: "Llamadas Agente/mes",
  },
  { key: "max_messages_monthly", en: "Messages/mo", es: "Mensajes/mes" },
  { key: "max_integrations", en: "Integrations", es: "Integraciones" },
  { key: "max_workflow_rules", en: "Workflow Rules", es: "Reglas de Flujo" },
];

function PlanComparisonMatrix({
  orgId,
  currentPlanId,
  isEn,
}: {
  orgId: string;
  currentPlanId: string;
  isEn: boolean;
}) {
  const [plans, setPlans] = useState<PlanComparison[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `${API_BASE}/billing/plan-comparison?org_id=${encodeURIComponent(orgId)}`,
          { method: "GET", headers: { Accept: "application/json" } }
        );
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          const rows = Array.isArray(json.data) ? json.data : [];
          setPlans(
            rows.map((r: Record<string, unknown>) => ({
              id: asString(r.id),
              name: asString(r.name),
              max_properties: asNumber(r.max_properties),
              max_units: asNumber(r.max_units),
              max_users: asNumber(r.max_users),
              max_agent_calls_monthly: asNumber(r.max_agent_calls_monthly),
              max_messages_monthly: asNumber(r.max_messages_monthly),
              max_integrations: asNumber(r.max_integrations),
              max_workflow_rules: asNumber(r.max_workflow_rules),
            }))
          );
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 font-semibold text-lg">
        {isEn ? "Plan Comparison" : "Comparación de Planes"}
      </h3>
      {loading ? (
        <p className="text-muted-foreground text-sm">
          {isEn ? "Loading plans..." : "Cargando planes..."}
        </p>
      ) : plans.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {isEn
            ? "Plan comparison not available."
            : "Comparación de planes no disponible."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                {COMPARISON_COLUMNS.map((col) => (
                  <th
                    className="px-3 py-2 text-left font-medium text-muted-foreground"
                    key={col.key}
                  >
                    {isEn ? col.en : col.es}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => {
                const isCurrent = plan.id === currentPlanId;
                return (
                  <tr
                    className={`border-b transition-colors ${
                      isCurrent
                        ? "bg-primary/5 font-medium"
                        : "hover:bg-muted/50"
                    }`}
                    key={plan.id}
                  >
                    {COMPARISON_COLUMNS.map((col) => (
                      <td className="px-3 py-2" key={col.key}>
                        {col.key === "name" ? (
                          <span className="flex items-center gap-2">
                            {plan.name}
                            {isCurrent && (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary text-xs">
                                {isEn ? "Current" : "Actual"}
                              </span>
                            )}
                          </span>
                        ) : (
                          (plan[col.key] as number).toLocaleString()
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
