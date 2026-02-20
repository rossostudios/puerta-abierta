"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
