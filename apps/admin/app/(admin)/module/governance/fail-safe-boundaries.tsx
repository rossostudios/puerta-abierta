"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type BoundaryRule = {
  id: string;
  category: string;
  is_blocked: boolean;
  custom_response?: string | null;
};

type FailSafeBoundariesProps = {
  orgId: string;
  isEn: boolean;
};

const CATEGORY_LABELS: Record<string, { en: string; es: string }> = {
  financial_advice: {
    en: "Financial advice",
    es: "Asesoría financiera",
  },
  legal_interpretation: {
    en: "Legal interpretation",
    es: "Interpretación legal",
  },
  medical_guidance: {
    en: "Medical guidance",
    es: "Orientación médica",
  },
  personal_data_sharing: {
    en: "Personal data sharing",
    es: "Compartir datos personales",
  },
  contract_signing: {
    en: "Contract signing authority",
    es: "Autoridad para firmar contratos",
  },
  payment_authorization: {
    en: "Payment authorization",
    es: "Autorización de pagos",
  },
};

export function FailSafeBoundaries({ orgId, isEn }: FailSafeBoundariesProps) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [editingResponse, setEditingResponse] = useState<
    Record<string, string>
  >({});

  const { data: rules = [], isPending: loading } = useQuery<BoundaryRule[]>({
    queryKey: ["boundary-rules", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/boundary-rules?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as { data?: BoundaryRule[] };
      return payload.data ?? [];
    },
    staleTime: 60_000,
  });

  const toggleRule = useCallback(
    async (ruleId: string, blocked: boolean) => {
      setSaving((prev) => new Set([...prev, ruleId]));
      try {
        const res = await fetch(
          `/api/agent/boundary-rules/${encodeURIComponent(ruleId)}?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              is_blocked: blocked,
              custom_response: editingResponse[ruleId] ?? null,
            }),
          }
        );
        if (res.ok) {
          queryClient.setQueryData(
            ["boundary-rules", orgId],
            (prev: BoundaryRule[] | undefined) =>
              prev
                ? prev.map((r) =>
                    r.id === ruleId ? { ...r, is_blocked: blocked } : r
                  )
                : []
          );
        }
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(ruleId);
          return next;
        });
      }
    },
    [orgId, queryClient, editingResponse]
  );

  return (
    <Card>
      <CardHeader className="space-y-1 border-border/70 border-b pb-4">
        <CardTitle className="text-base">
          {isEn ? "Fail-Safe Boundaries" : "Limites de Seguridad"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Configure categories the agent cannot handle and custom rejection responses"
            : "Configura las categorías que el agente no puede manejar y respuestas de rechazo personalizadas"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((k) => (
              <Skeleton className="h-16 w-full rounded-xl" key={k} />
            ))}
          </div>
        ) : rules.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground/60 text-sm">
            {isEn
              ? "No boundary rules configured yet."
              : "No se han configurado reglas de limites aún."}
          </p>
        ) : (
          rules.map((rule) => {
            const labels = CATEGORY_LABELS[rule.category];
            return (
              <div
                className="rounded-xl border border-border/30 bg-muted/10 px-4 py-3"
                key={rule.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-[13px] text-foreground/90">
                      {labels
                        ? isEn
                          ? labels.en
                          : labels.es
                        : rule.category.replace(/_/g, " ")}
                    </p>
                  </div>
                  <button
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                      rule.is_blocked
                        ? "bg-destructive/80"
                        : "bg-emerald-500/80"
                    )}
                    disabled={saving.has(rule.id)}
                    onClick={() => {
                      toggleRule(rule.id, !rule.is_blocked).catch(
                        () => undefined
                      );
                    }}
                    type="button"
                  >
                    <span
                      className={cn(
                        "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out",
                        rule.is_blocked ? "translate-x-5" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>
                {rule.is_blocked ? (
                  <div className="mt-2">
                    <Textarea
                      className="h-16 resize-none text-[12px]"
                      onChange={(e) =>
                        setEditingResponse((prev) => ({
                          ...prev,
                          [rule.id]: e.target.value,
                        }))
                      }
                      placeholder={
                        isEn
                          ? "Custom rejection response (optional)..."
                          : "Respuesta de rechazo personalizada (opcional)..."
                      }
                      value={
                        editingResponse[rule.id] ?? rule.custom_response ?? ""
                      }
                    />
                    <Button
                      className="mt-1.5"
                      disabled={saving.has(rule.id)}
                      onClick={() => {
                        toggleRule(rule.id, true).catch(() => undefined);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {isEn ? "Save response" : "Guardar respuesta"}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
