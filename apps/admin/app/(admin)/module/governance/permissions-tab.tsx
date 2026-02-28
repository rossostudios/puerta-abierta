"use client";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { authedFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApprovalMode = "required" | "auto" | "disabled";

type ApprovalPolicy = {
  id: string;
  tool_name: string;
  mode: ApprovalMode;
  updated_at?: string;
};

type BoundaryRule = {
  id: string;
  category: string;
  is_blocked: boolean;
  custom_response?: string | null;
};

type PermissionsTabProps = {
  orgId: string;
  isEn: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_STYLES: Record<ApprovalMode, string> = {
  required:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  auto: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  disabled: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

const ROW_TINTS: Record<ApprovalMode, string> = {
  required: "bg-amber-500/[0.03]",
  auto: "bg-emerald-500/[0.04]",
  disabled: "bg-red-500/[0.03]",
};

const MODE_LABELS: Record<ApprovalMode, { en: string; es: string }> = {
  required: { en: "Approval Required", es: "Requiere aprobación" },
  auto: { en: "Auto-Approve", es: "Auto-aprobar" },
  disabled: { en: "Disabled", es: "Deshabilitado" },
};

const MODE_CYCLE: ApprovalMode[] = ["required", "auto", "disabled"];

type ToolDef = {
  name: string;
  labelEn: string;
  labelEs: string;
};

type CategoryDef = {
  key: string;
  labelEn: string;
  labelEs: string;
  descriptionEn: string;
  descriptionEs: string;
  tools: ToolDef[];
};

const CATEGORIES: CategoryDef[] = [
  {
    key: "guest_communication",
    labelEn: "Guest Communication",
    labelEs: "Comunicación con huéspedes",
    descriptionEn: "Sending messages and access codes to guests",
    descriptionEs: "Enviar mensajes y códigos de acceso a huéspedes",
    tools: [
      {
        name: "send_message",
        labelEn: "Send message",
        labelEs: "Enviar mensaje",
      },
      {
        name: "send_access_code",
        labelEn: "Send access code",
        labelEs: "Enviar código de acceso",
      },
    ],
  },
  {
    key: "maintenance",
    labelEn: "Maintenance & Operations",
    labelEs: "Mantenimiento y operaciones",
    descriptionEn:
      "Creating tasks, assigning vendors, and managing maintenance workflows",
    descriptionEs:
      "Crear tareas, asignar proveedores y gestionar flujos de mantenimiento",
    tools: [
      {
        name: "create_maintenance_task",
        labelEn: "Create task",
        labelEs: "Crear tarea",
      },
      {
        name: "auto_assign_maintenance",
        labelEn: "Auto-assign task",
        labelEs: "Auto-asignar tarea",
      },
      {
        name: "escalate_maintenance",
        labelEn: "Escalate task",
        labelEs: "Escalar tarea",
      },
      {
        name: "dispatch_to_vendor",
        labelEn: "Dispatch to vendor",
        labelEs: "Enviar a proveedor",
      },
      {
        name: "verify_completion",
        labelEn: "Verify completion",
        labelEs: "Verificar finalización",
      },
      {
        name: "request_vendor_quote",
        labelEn: "Request vendor quote",
        labelEs: "Solicitar cotización",
      },
      {
        name: "select_vendor",
        labelEn: "Select vendor",
        labelEs: "Seleccionar proveedor",
      },
      {
        name: "create_defect_tickets",
        labelEn: "Create defect tickets",
        labelEs: "Crear tickets de defecto",
      },
      {
        name: "voice_create_maintenance_request",
        labelEn: "Voice maintenance request",
        labelEs: "Solicitud de mantenimiento por voz",
      },
    ],
  },
  {
    key: "financial",
    labelEn: "Financial Actions",
    labelEs: "Acciones financieras",
    descriptionEn: "Pricing changes, bank transactions, and payment processing",
    descriptionEs:
      "Cambios de precios, transacciones bancarias y procesamiento de pagos",
    tools: [
      {
        name: "apply_pricing_recommendation",
        labelEn: "Apply pricing",
        labelEs: "Aplicar precios",
      },
      {
        name: "import_bank_transactions",
        labelEn: "Import transactions",
        labelEs: "Importar transacciones",
      },
      {
        name: "auto_reconcile_batch",
        labelEn: "Auto-reconcile",
        labelEs: "Auto-conciliar",
      },
      {
        name: "handle_split_payment",
        labelEn: "Split payment",
        labelEs: "Pago dividido",
      },
      {
        name: "auto_populate_lease_charges",
        labelEn: "Populate lease charges",
        labelEs: "Cargar cobros de contrato",
      },
    ],
  },
  {
    key: "access_security",
    labelEn: "Access & Security",
    labelEs: "Acceso y seguridad",
    descriptionEn:
      "Managing access codes and processing security sensor events",
    descriptionEs:
      "Gestionar códigos de acceso y procesar eventos de sensores de seguridad",
    tools: [
      {
        name: "generate_access_code",
        labelEn: "Generate access code",
        labelEs: "Generar código de acceso",
      },
      {
        name: "revoke_access_code",
        labelEn: "Revoke access code",
        labelEs: "Revocar código de acceso",
      },
      {
        name: "process_sensor_event",
        labelEn: "Process sensor event",
        labelEs: "Procesar evento de sensor",
      },
    ],
  },
  {
    key: "data_management",
    labelEn: "Data Management",
    labelEs: "Gestión de datos",
    descriptionEn: "Creating, updating, and deleting records in the system",
    descriptionEs: "Crear, actualizar y eliminar registros en el sistema",
    tools: [
      {
        name: "create_row",
        labelEn: "Create record",
        labelEs: "Crear registro",
      },
      {
        name: "update_row",
        labelEn: "Update record",
        labelEs: "Actualizar registro",
      },
      {
        name: "delete_row",
        labelEn: "Delete record",
        labelEs: "Eliminar registro",
      },
    ],
  },
  {
    key: "automation",
    labelEn: "Automation & AI",
    labelEs: "Automatización e IA",
    descriptionEn:
      "Application scoring, task delegation, and playbook execution",
    descriptionEs:
      "Puntaje de solicitudes, delegación de tareas y ejecución de playbooks",
    tools: [
      {
        name: "score_application",
        labelEn: "Score application",
        labelEs: "Puntuar solicitud",
      },
      {
        name: "classify_and_delegate",
        labelEn: "Classify & delegate",
        labelEs: "Clasificar y delegar",
      },
      {
        name: "execute_playbook",
        labelEn: "Execute playbook",
        labelEs: "Ejecutar playbook",
      },
    ],
  },
];

const BOUNDARY_LABELS: Record<
  string,
  { en: string; es: string; descEn: string; descEs: string }
> = {
  financial_advice: {
    en: "Financial advice",
    es: "Asesoría financiera",
    descEn:
      "When blocked, the AI will decline and suggest contacting a professional",
    descEs:
      "Cuando está bloqueado, la IA declinará y sugerirá contactar a un profesional",
  },
  legal_interpretation: {
    en: "Legal interpretation",
    es: "Interpretación legal",
    descEn:
      "When blocked, the AI will decline and suggest contacting a professional",
    descEs:
      "Cuando está bloqueado, la IA declinará y sugerirá contactar a un profesional",
  },
  medical_guidance: {
    en: "Medical guidance",
    es: "Orientación médica",
    descEn:
      "When blocked, the AI will decline and suggest contacting a professional",
    descEs:
      "Cuando está bloqueado, la IA declinará y sugerirá contactar a un profesional",
  },
  personal_data_sharing: {
    en: "Personal data sharing",
    es: "Compartir datos personales",
    descEn:
      "When blocked, the AI will not share personal information with third parties",
    descEs:
      "Cuando está bloqueado, la IA no compartirá información personal con terceros",
  },
  contract_signing: {
    en: "Contract signing authority",
    es: "Autoridad para firmar contratos",
    descEn: "When blocked, the AI will decline and require human authorization",
    descEs:
      "Cuando está bloqueado, la IA declinará y requerirá autorización humana",
  },
  payment_authorization: {
    en: "Payment authorization",
    es: "Autorización de pagos",
    descEn:
      "When blocked, the AI will not authorize payments without human approval",
    descEs:
      "Cuando está bloqueado, la IA no autorizará pagos sin aprobación humana",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PermissionsTab({ orgId, isEn }: PermissionsTabProps) {
  const queryClient = useQueryClient();
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set([CATEGORIES[0].key])
  );
  const [savingBoundary, setSavingBoundary] = useState<Set<string>>(new Set());

  // Search & filters
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Bulk mode
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());

  // -- Fetch approval policies -----------------------------------------------

  const { data: policies = [], isPending: loadingPolicies } = useQuery<
    ApprovalPolicy[]
  >({
    queryKey: ["approval-policies", orgId],
    queryFn: async () => {
      try {
        const payload = await authedFetch<{ data?: ApprovalPolicy[] }>(
          `/agent/approval-policies?org_id=${encodeURIComponent(orgId)}`
        );
        return payload.data ?? [];
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  // -- Fetch boundary rules --------------------------------------------------

  const { data: boundaryRules = [], isPending: loadingBoundaries } = useQuery<
    BoundaryRule[]
  >({
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

  // -- Build lookup map for policies -----------------------------------------

  const policyMap = new Map(policies.map((p) => [p.tool_name, p]));

  // -- Filtered categories ---------------------------------------------------

  const filteredCategories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let cats = CATEGORIES;

    // Filter by department
    if (activeFilter) {
      cats = cats.filter((c) => c.key === activeFilter);
    }

    // Filter by search
    if (query) {
      cats = cats
        .map((cat) => {
          const matchingTools = cat.tools.filter(
            (t) =>
              t.labelEn.toLowerCase().includes(query) ||
              t.labelEs.toLowerCase().includes(query) ||
              t.name.toLowerCase().includes(query)
          );
          if (matchingTools.length > 0) {
            return { ...cat, tools: matchingTools };
          }
          // Check if category name matches
          if (
            cat.labelEn.toLowerCase().includes(query) ||
            cat.labelEs.toLowerCase().includes(query)
          ) {
            return cat;
          }
          return null;
        })
        .filter((c): c is CategoryDef => c !== null);
    }

    return cats;
  }, [searchQuery, activeFilter]);

  // -- Toggle policy mode ----------------------------------------------------

  const cyclePolicyMode = useCallback(
    async (toolName: string) => {
      const existing = policyMap.get(toolName);
      const currentMode: ApprovalMode = existing?.mode ?? "required";
      const currentIdx = MODE_CYCLE.indexOf(currentMode);
      const nextMode = MODE_CYCLE[(currentIdx + 1) % MODE_CYCLE.length];

      const key = existing?.id ?? toolName;
      setTogglingIds((prev) => new Set([...prev, key]));

      try {
        await authedFetch(
          `/agent/approval-policies?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "PUT",
            body: JSON.stringify({ tool_name: toolName, mode: nextMode }),
          }
        );

        queryClient.setQueryData(
          ["approval-policies", orgId],
          (prev: ApprovalPolicy[] | undefined) => {
            if (!prev) return prev;
            const idx = prev.findIndex((p) => p.tool_name === toolName);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = { ...updated[idx], mode: nextMode };
              return updated;
            }
            return [
              ...prev,
              {
                id: toolName,
                tool_name: toolName,
                mode: nextMode,
                updated_at: new Date().toISOString(),
              },
            ];
          }
        );
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [orgId, policyMap, queryClient]
  );

  // -- Bulk set mode ---------------------------------------------------------

  const bulkSetMode = useCallback(
    async (mode: ApprovalMode) => {
      const toolNames = [...selectedTools];
      if (toolNames.length === 0) return;

      setTogglingIds((prev) => new Set([...prev, ...toolNames]));

      try {
        await Promise.allSettled(
          toolNames.map((toolName) =>
            authedFetch(
              `/agent/approval-policies?org_id=${encodeURIComponent(orgId)}`,
              {
                method: "PUT",
                body: JSON.stringify({ tool_name: toolName, mode }),
              }
            )
          )
        );

        queryClient.setQueryData(
          ["approval-policies", orgId],
          (prev: ApprovalPolicy[] | undefined) => {
            if (!prev) return prev;
            const updated = [...prev];
            for (const toolName of toolNames) {
              const idx = updated.findIndex((p) => p.tool_name === toolName);
              if (idx >= 0) {
                updated[idx] = { ...updated[idx], mode };
              } else {
                updated.push({
                  id: toolName,
                  tool_name: toolName,
                  mode,
                  updated_at: new Date().toISOString(),
                });
              }
            }
            return updated;
          }
        );

        setSelectedTools(new Set());
        setBulkMode(false);
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          for (const t of toolNames) next.delete(t);
          return next;
        });
      }
    },
    [orgId, selectedTools, queryClient]
  );

  // -- Toggle category expand ------------------------------------------------

  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // -- Toggle tool selection -------------------------------------------------

  const toggleToolSelection = useCallback((name: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // -- Toggle boundary rule --------------------------------------------------

  const toggleBoundary = useCallback(
    async (ruleId: string, blocked: boolean) => {
      setSavingBoundary((prev) => new Set([...prev, ruleId]));
      try {
        const res = await fetch(
          `/api/agent/boundary-rules/${encodeURIComponent(ruleId)}?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ is_blocked: blocked }),
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
        setSavingBoundary((prev) => {
          const next = new Set(prev);
          next.delete(ruleId);
          return next;
        });
      }
    },
    [orgId, queryClient]
  );

  // -- Helpers ---------------------------------------------------------------

  function getCategoryModesSummary(tools: ToolDef[]): {
    required: number;
    auto: number;
    disabled: number;
  } {
    const counts = { required: 0, auto: 0, disabled: 0 };
    for (const tool of tools) {
      const mode = policyMap.get(tool.name)?.mode ?? "required";
      counts[mode]++;
    }
    return counts;
  }

  // -- Render ----------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Search bar + bulk toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Icon
            className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground/50"
            icon={Search01Icon}
            size={14}
          />
          <input
            className="h-9 w-full rounded-lg border border-border/40 bg-muted/10 pr-3 pl-9 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/10"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isEn ? "Search tools..." : "Buscar herramientas..."}
            type="text"
            value={searchQuery}
          />
        </div>
        <Button
          className="shrink-0 text-[12px]"
          onClick={() => {
            setBulkMode((v) => !v);
            if (bulkMode) setSelectedTools(new Set());
          }}
          size="sm"
          variant={bulkMode ? "default" : "outline"}
        >
          {bulkMode
            ? isEn
              ? "Cancel"
              : "Cancelar"
            : isEn
              ? "Bulk Edit"
              : "Editar lote"}
        </Button>
      </div>

      {/* Department filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className={cn(
            "rounded-full px-2.5 py-1 font-medium text-[11px] transition-colors",
            activeFilter === null
              ? "bg-foreground/10 text-foreground"
              : "bg-muted/20 text-muted-foreground/60 hover:bg-muted/30 hover:text-muted-foreground/80"
          )}
          onClick={() => setActiveFilter(null)}
          type="button"
        >
          {isEn ? "All" : "Todos"}
        </button>
        {CATEGORIES.map((cat) => (
          <button
            className={cn(
              "rounded-full px-2.5 py-1 font-medium text-[11px] transition-colors",
              activeFilter === cat.key
                ? "bg-foreground/10 text-foreground"
                : "bg-muted/20 text-muted-foreground/60 hover:bg-muted/30 hover:text-muted-foreground/80"
            )}
            key={cat.key}
            onClick={() =>
              setActiveFilter((prev) => (prev === cat.key ? null : cat.key))
            }
            type="button"
          >
            {isEn ? cat.labelEn : cat.labelEs}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {bulkMode && selectedTools.size > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-muted/20 px-3 py-2">
          <span className="font-medium text-[12px] text-foreground/70">
            {selectedTools.size} {isEn ? "selected" : "seleccionados"}
          </span>
          <span className="text-border/50">|</span>
          <span className="text-[11px] text-muted-foreground/60">
            {isEn ? "Set all to:" : "Cambiar a:"}
          </span>
          <Button
            className="h-6 text-[11px]"
            onClick={() => {
              bulkSetMode("required").catch(() => undefined);
            }}
            size="sm"
            variant="outline"
          >
            {isEn ? "Approval Required" : "Requiere aprobación"}
          </Button>
          <Button
            className="h-6 text-[11px]"
            onClick={() => {
              bulkSetMode("auto").catch(() => undefined);
            }}
            size="sm"
            variant="outline"
          >
            {isEn ? "Auto-Approve" : "Auto-aprobar"}
          </Button>
          <Button
            className="h-6 text-[11px]"
            onClick={() => {
              bulkSetMode("disabled").catch(() => undefined);
            }}
            size="sm"
            variant="outline"
          >
            {isEn ? "Disabled" : "Deshabilitado"}
          </Button>
        </div>
      )}

      {/* Tool permission categories */}
      <div>
        <h2 className="mb-3 font-semibold text-foreground/90 text-sm">
          {isEn ? "What the AI can do" : "Lo que la IA puede hacer"}
        </h2>

        {loadingPolicies ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((k) => (
              <Skeleton className="h-20 w-full rounded-xl" key={k} />
            ))}
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="rounded-xl border border-border/20 py-8 text-center">
            <p className="text-[13px] text-muted-foreground/50">
              {isEn
                ? "No tools match your search."
                : "Ninguna herramienta coincide con tu búsqueda."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredCategories.map((cat) => {
              const expanded = expandedCategories.has(cat.key);
              const summary = getCategoryModesSummary(cat.tools);

              return (
                <Card className="overflow-hidden" key={cat.key}>
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
                    onClick={() => toggleCategory(cat.key)}
                    type="button"
                  >
                    <span
                      className={cn(
                        "text-[11px] text-muted-foreground transition-transform",
                        expanded && "rotate-90"
                      )}
                    >
                      ▸
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[13px] text-foreground/90">
                        {isEn ? cat.labelEn : cat.labelEs}
                        <span className="ml-1.5 font-normal text-[11px] text-muted-foreground/50">
                          ({cat.tools.length})
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground/60">
                        {isEn ? cat.descriptionEn : cat.descriptionEs}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {summary.required > 0 && (
                        <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-medium text-[9px] text-amber-700 dark:text-amber-400">
                          {summary.required}
                        </span>
                      )}
                      {summary.auto > 0 && (
                        <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-medium text-[9px] text-emerald-700 dark:text-emerald-400">
                          {summary.auto}
                        </span>
                      )}
                      {summary.disabled > 0 && (
                        <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-medium text-[9px] text-red-700 dark:text-red-400">
                          {summary.disabled}
                        </span>
                      )}
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-border/30 border-t px-4 py-2">
                      <div className="space-y-1">
                        {cat.tools.map((tool) => {
                          const policy = policyMap.get(tool.name);
                          const mode: ApprovalMode = policy?.mode ?? "required";
                          const toggling = togglingIds.has(
                            policy?.id ?? tool.name
                          );
                          const isSelected = selectedTools.has(tool.name);

                          return (
                            <div
                              className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                                ROW_TINTS[mode],
                                isSelected && "ring-1 ring-foreground/15"
                              )}
                              key={tool.name}
                            >
                              {bulkMode && (
                                <input
                                  checked={isSelected}
                                  className="h-3.5 w-3.5 shrink-0 rounded border-border/50 accent-foreground"
                                  onChange={() =>
                                    toggleToolSelection(tool.name)
                                  }
                                  type="checkbox"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-[12.5px] text-foreground/80">
                                  {isEn ? tool.labelEn : tool.labelEs}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  className={cn(
                                    "whitespace-nowrap text-[10px]",
                                    MODE_STYLES[mode]
                                  )}
                                  variant="outline"
                                >
                                  {isEn
                                    ? MODE_LABELS[mode].en
                                    : MODE_LABELS[mode].es}
                                </Badge>
                                {!bulkMode && (
                                  <Button
                                    className="shrink-0"
                                    disabled={toggling}
                                    onClick={() => {
                                      cyclePolicyMode(tool.name).catch(
                                        () => undefined
                                      );
                                    }}
                                    size="sm"
                                    variant="outline"
                                  >
                                    {toggling
                                      ? "..."
                                      : isEn
                                        ? "Change"
                                        : "Cambiar"}
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Safety boundaries */}
      <div>
        <h2 className="mb-3 font-semibold text-foreground/90 text-sm">
          {isEn ? "Topics the AI should avoid" : "Temas que la IA debe evitar"}
        </h2>

        {loadingBoundaries ? (
          <div className="space-y-2">
            {[1, 2, 3].map((k) => (
              <Skeleton className="h-14 w-full rounded-xl" key={k} />
            ))}
          </div>
        ) : boundaryRules.length === 0 ? (
          <Card>
            <CardContent className="py-6">
              <p className="text-center text-muted-foreground/60 text-sm">
                {isEn
                  ? "No safety boundaries configured yet."
                  : "No se han configurado limites de seguridad aún."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-1 pt-4">
              {boundaryRules.map((rule) => {
                const labels = BOUNDARY_LABELS[rule.category];
                return (
                  <div
                    className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                    key={rule.id}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[13px] text-foreground/90">
                        {labels
                          ? isEn
                            ? labels.en
                            : labels.es
                          : rule.category.replace(/_/g, " ")}
                      </p>
                      <p className="text-[11px] text-muted-foreground/50">
                        {labels ? (isEn ? labels.descEn : labels.descEs) : ""}
                      </p>
                    </div>
                    <button
                      className={cn(
                        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
                        rule.is_blocked
                          ? "bg-destructive/80"
                          : "bg-emerald-500/80"
                      )}
                      disabled={savingBoundary.has(rule.id)}
                      onClick={() => {
                        toggleBoundary(rule.id, !rule.is_blocked).catch(
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
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
