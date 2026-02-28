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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { authedFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GuardrailEntry = {
  id: string;
  key: string;
  value: unknown;
  description?: string;
  updated_at?: string;
};

type GuardrailConfigProps = {
  orgId: string;
  isEn: boolean;
};

// ---------------------------------------------------------------------------
// Default guardrails definition (for display metadata)
// ---------------------------------------------------------------------------

type GuardrailMeta = {
  key: string;
  labelEn: string;
  labelEs: string;
  descriptionEn: string;
  descriptionEs: string;
  defaultValue: unknown;
  inputType: "number" | "json" | "keywords";
};

const GUARDRAIL_DEFS: GuardrailMeta[] = [
  {
    key: "price_threshold_pct",
    labelEn: "Price Threshold %",
    labelEs: "Umbral de Precio %",
    descriptionEn:
      "Price changes above this percentage require human approval before applying.",
    descriptionEs:
      "Los cambios de precio por encima de este porcentaje requieren aprobacion humana antes de aplicarse.",
    defaultValue: 0.15,
    inputType: "number",
  },
  {
    key: "content_moderation_keywords",
    labelEn: "Content Moderation Keywords",
    labelEs: "Palabras Clave de Moderacion",
    descriptionEn:
      "Array of blocked keywords that trigger content moderation on agent-generated text.",
    descriptionEs:
      "Lista de palabras clave bloqueadas que activan la moderacion de contenido en texto generado por agentes.",
    defaultValue: [],
    inputType: "keywords",
  },
  {
    key: "vendor_scoring_weights",
    labelEn: "Vendor Scoring Weights",
    labelEs: "Pesos de Puntuacion de Proveedores",
    descriptionEn:
      "Weight distribution for vendor evaluation: specialty, rating, availability, proximity (must sum to 1.0).",
    descriptionEs:
      "Distribucion de pesos para evaluacion de proveedores: especialidad, calificacion, disponibilidad, proximidad (deben sumar 1.0).",
    defaultValue: {
      specialty: 0.4,
      rating: 0.3,
      availability: 0.2,
      proximity: 0.1,
    },
    inputType: "json",
  },
  {
    key: "price_elasticity",
    labelEn: "Price Elasticity",
    labelEs: "Elasticidad de Precio",
    descriptionEn:
      "Default price elasticity coefficient used in the dynamic pricing model.",
    descriptionEs:
      "Coeficiente de elasticidad de precio por defecto utilizado en el modelo de precios dinamicos.",
    defaultValue: -0.8,
    inputType: "number",
  },
  {
    key: "auto_apply_delta_pct",
    labelEn: "Auto-Apply Delta %",
    labelEs: "Delta de Auto-Aplicacion %",
    descriptionEn:
      "Pricing changes below this delta percentage are auto-applied without approval.",
    descriptionEs:
      "Los cambios de precio por debajo de este porcentaje delta se aplican automaticamente sin aprobacion.",
    defaultValue: 0.1,
    inputType: "number",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function parseInputValue(
  raw: string,
  inputType: GuardrailMeta["inputType"]
): unknown {
  if (inputType === "number") return Number(raw);
  if (inputType === "keywords") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // json
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GuardrailConfig({ orgId, isEn }: GuardrailConfigProps) {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // -- Fetch guardrail entries -----------------------------------------------

  const { data: entries = [], isPending: loading } = useQuery<GuardrailEntry[]>(
    {
      queryKey: ["guardrail-config", orgId],
      queryFn: async () => {
        try {
          const payload = await authedFetch<{ data?: GuardrailEntry[] }>(
            `/agent/guardrail-config?org_id=${encodeURIComponent(orgId)}`
          );
          return payload.data ?? [];
        } catch {
          return [];
        }
      },
      staleTime: 60_000,
    }
  );

  // -- Build lookup map -------------------------------------------------------

  const entryMap = new Map(entries.map((e) => [e.key, e]));

  // -- Start editing ----------------------------------------------------------

  const startEditing = useCallback(
    (def: GuardrailMeta) => {
      const existing = entryMap.get(def.key);
      const currentValue = existing?.value ?? def.defaultValue;
      setEditingKey(def.key);
      setEditDraft(formatValue(currentValue));
    },
    [entryMap]
  );

  // -- Save -------------------------------------------------------------------

  const saveGuardrail = useCallback(
    async (def: GuardrailMeta) => {
      setSaving(true);
      try {
        const parsed = parseInputValue(editDraft, def.inputType);
        await authedFetch(
          `/agent/guardrail-config?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "PUT",
            body: JSON.stringify({ key: def.key, value: parsed }),
          }
        );

        queryClient.setQueryData(
          ["guardrail-config", orgId],
          (prev: GuardrailEntry[] | undefined) => {
            if (!prev) return prev;
            const idx = prev.findIndex((e) => e.key === def.key);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], value: parsed };
              return updated;
            }
            return [
              ...prev,
              {
                id: def.key,
                key: def.key,
                value: parsed,
                updated_at: new Date().toISOString(),
              },
            ];
          }
        );

        setEditingKey(null);
        setEditDraft("");
      } finally {
        setSaving(false);
      }
    },
    [orgId, editDraft, queryClient]
  );

  // -- Render -----------------------------------------------------------------

  return (
    <Card>
      <CardHeader className="space-y-1 border-border/70 border-b pb-4">
        <CardTitle className="text-base">
          {isEn ? "Guardrail Configuration" : "Configuracion de Guardarrailes"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Tune safety thresholds, scoring weights, and auto-apply rules for agent operations"
            : "Ajusta los umbrales de seguridad, pesos de puntuacion y reglas de auto-aplicacion para operaciones de agentes"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((k) => (
              <Skeleton className="h-28 w-full rounded-xl" key={k} />
            ))}
          </div>
        ) : (
          GUARDRAIL_DEFS.map((def) => {
            const entry = entryMap.get(def.key);
            const currentValue = entry?.value ?? def.defaultValue;
            const isEditing = editingKey === def.key;

            return (
              <div
                className="rounded-xl border border-border/30 bg-muted/10 px-4 py-4"
                key={def.key}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[13px] text-foreground/90">
                      {isEn ? def.labelEn : def.labelEs}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground/60">
                      {isEn ? def.descriptionEn : def.descriptionEs}
                    </p>
                  </div>
                  {isEditing ? null : (
                    <Button
                      className="shrink-0"
                      onClick={() => startEditing(def)}
                      size="sm"
                      variant="outline"
                    >
                      {isEn ? "Edit" : "Editar"}
                    </Button>
                  )}
                </div>

                {isEditing ? (
                  <div className="mt-3">
                    {def.inputType === "json" ? (
                      <textarea
                        className={cn(
                          "w-full rounded-lg border border-border/40 bg-background px-3 py-2 font-mono text-[12px] leading-relaxed",
                          "resize-y focus:outline-none focus:ring-2 focus:ring-ring/30"
                        )}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={5}
                        value={editDraft}
                      />
                    ) : def.inputType === "keywords" ? (
                      <div>
                        <Input
                          className="h-9 font-mono text-sm"
                          onChange={(e) => setEditDraft(e.target.value)}
                          placeholder={
                            isEn
                              ? "Comma-separated keywords..."
                              : "Palabras separadas por comas..."
                          }
                          value={editDraft}
                        />
                        <p className="mt-1 text-[10px] text-muted-foreground/50">
                          {isEn
                            ? "Separate keywords with commas"
                            : "Separa las palabras con comas"}
                        </p>
                      </div>
                    ) : (
                      <Input
                        className="h-9 font-mono text-sm"
                        onChange={(e) => setEditDraft(e.target.value)}
                        step="any"
                        type="number"
                        value={editDraft}
                      />
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        disabled={saving}
                        onClick={() => {
                          saveGuardrail(def).catch(() => undefined);
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {saving ? "..." : isEn ? "Save" : "Guardar"}
                      </Button>
                      <Button
                        disabled={saving}
                        onClick={() => {
                          setEditingKey(null);
                          setEditDraft("");
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        {isEn ? "Cancel" : "Cancelar"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <pre
                      className={cn(
                        "rounded-lg bg-muted/20 px-3 py-2 font-mono text-[12px] text-foreground/70",
                        "overflow-x-auto whitespace-pre-wrap"
                      )}
                    >
                      {formatValue(currentValue)}
                    </pre>
                    {entry?.updated_at ? (
                      <p className="mt-1 text-[10px] text-muted-foreground/40">
                        {isEn ? "Updated" : "Actualizado"}:{" "}
                        {new Date(entry.updated_at).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
