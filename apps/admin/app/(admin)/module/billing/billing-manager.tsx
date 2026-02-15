"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
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
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (
      !confirm(
        isEn
          ? "Cancel your subscription? You can resubscribe anytime."
          : "¿Cancelar tu suscripción? Puedes volver a suscribirte."
      )
    )
      return;
    setSubmitting(true);
    try {
      await apiPost("/billing/cancel", { org_id: orgId });
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Current plan section */}
      {hasSubscription ? (
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">
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
            <p className="text-muted-foreground mb-3 text-sm">
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
        <div className="bg-muted/50 rounded-lg border p-4 text-center">
          <p className="text-muted-foreground">
            {isEn
              ? "No active subscription. Choose a plan below."
              : "Sin suscripción activa. Elige un plan abajo."}
          </p>
        </div>
      )}

      {/* Plans grid */}
      <div>
        <h3 className="mb-3 text-lg font-semibold">
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
                className={`rounded-lg border p-4 ${isCurrent ? "border-primary ring-primary/20 ring-2" : ""}`}
                key={id}
              >
                <h4 className="text-lg font-bold">{name}</h4>
                <p className="text-2xl font-semibold">
                  {priceUsd === 0
                    ? isEn
                      ? "Free"
                      : "Gratis"
                    : formatCurrency(priceUsd, "USD", locale)}
                  <span className="text-muted-foreground text-sm font-normal">
                    {priceUsd > 0 && (isEn ? "/mo" : "/mes")}
                  </span>
                </p>
                {pricePyg > 0 && (
                  <p className="text-muted-foreground text-sm">
                    ≈ {formatCurrency(pricePyg, "PYG", locale)}
                  </p>
                )}
                <ul className="text-muted-foreground mt-3 space-y-1 text-sm">
                  <li>
                    {asNumber(plan.max_properties)} {isEn ? "properties" : "propiedades"}
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
        <p className="mt-1 text-xs text-amber-600">
          {isEn ? "Approaching limit" : "Acercándose al límite"}
        </p>
      )}
    </div>
  );
}
