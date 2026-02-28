"use client";

import {
  Settings02Icon,
  SparklesIcon,
  TestTube01Icon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { authedFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import type { AgentRow } from "./agent-config-types";

type AgentDetail = AgentRow & {
  baseline_is_active?: boolean;
  model_override?: string | null;
  max_steps_override?: number | null;
  allow_mutations_default?: boolean | null;
  guardrail_overrides?: Record<string, unknown> | null;
};

type Props = {
  orgId: string;
  initialAgents?: AgentRow[];
  locale: string;
};

function parseGuardrailOverrides(
  input: string
): Record<string, unknown> | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Guardrail overrides must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function AgentConfigManager({ orgId, initialAgents, locale }: Props) {
  const isEn = locale === "en-US";

  const [agents, setAgents] = useState<AgentRow[]>(initialAgents ?? []);
  const [selected, setSelected] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [isActive, setIsActive] = useState(false);
  const [modelOverride, setModelOverride] = useState("");
  const [maxStepsOverride, setMaxStepsOverride] = useState("");
  const [allowMutationsDefault, setAllowMutationsDefault] = useState(true);
  const [guardrailOverrides, setGuardrailOverrides] = useState("{}");

  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState("");
  const [testing, setTesting] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  // Fetch agents on mount when no initial data is provided
  useEffect(() => {
    if (initialAgents && initialAgents.length > 0) return;
    let cancelled = false;
    authedFetch<{ data?: AgentRow[] }>(`/ai-agents?org_id=${orgId}`)
      .then((res) => {
        if (!cancelled) setAgents(res.data ?? []);
      })
      .catch(() => {
        /* swallow */
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, initialAgents]);

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name)),
    [agents]
  );

  const selectAgent = useCallback(
    async (slug: string) => {
      setLoading(true);
      setTestResult("");
      setTestInput("");
      try {
        const detail = await authedFetch<AgentDetail>(
          `/ai-agents/${slug}?org_id=${orgId}`
        );
        setSelected(detail);
        setIsActive(detail.is_active);
        setModelOverride(detail.model_override ?? "");
        setMaxStepsOverride(
          typeof detail.max_steps_override === "number"
            ? String(detail.max_steps_override)
            : ""
        );
        setAllowMutationsDefault(detail.allow_mutations_default ?? true);
        setGuardrailOverrides(
          JSON.stringify(detail.guardrail_overrides ?? {}, null, 2)
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        toast.error(
          isEn
            ? `Failed to load agent: ${msg}`
            : `Error al cargar agente: ${msg}`
        );
      } finally {
        setLoading(false);
      }
    },
    [orgId, isEn]
  );

  const handleSave = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const parsedMaxSteps = maxStepsOverride.trim()
        ? Number.parseInt(maxStepsOverride.trim(), 10)
        : null;
      if (
        parsedMaxSteps !== null &&
        (!Number.isFinite(parsedMaxSteps) ||
          parsedMaxSteps < 1 ||
          parsedMaxSteps > 24)
      ) {
        throw new Error(
          isEn
            ? "Max steps must be between 1 and 24."
            : "Los pasos máximos deben estar entre 1 y 24."
        );
      }

      const parsedGuardrails = parseGuardrailOverrides(guardrailOverrides);

      await authedFetch(`/ai-agents/${selected.slug}`, {
        method: "PATCH",
        body: JSON.stringify({
          org_id: orgId,
          is_active: isActive,
          model_override: modelOverride.trim() || null,
          max_steps_override: parsedMaxSteps,
          allow_mutations_default: allowMutationsDefault,
          guardrail_overrides: parsedGuardrails,
        }),
      });

      setAgents((prev) =>
        prev.map((agent) =>
          agent.slug === selected.slug
            ? {
                ...agent,
                is_active: isActive,
                model_override: modelOverride.trim() || null,
                max_steps_override: parsedMaxSteps,
                allow_mutations_default: allowMutationsDefault,
              }
            : agent
        )
      );

      toast.success(isEn ? "Runtime overrides saved" : "Overrides guardados");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [
    allowMutationsDefault,
    guardrailOverrides,
    isActive,
    isEn,
    maxStepsOverride,
    modelOverride,
    orgId,
    selected,
  ]);

  const handleTest = useCallback(async () => {
    if (!(selected && testInput.trim())) return;
    setTesting(true);
    setTestResult("");
    try {
      const chat = await authedFetch<{ id?: string }>("/agent/chats", {
        method: "POST",
        body: JSON.stringify({
          org_id: orgId,
          agent_slug: selected.slug,
          title: `Test: ${testInput.slice(0, 40)}`,
        }),
      });
      const chatId = typeof chat.id === "string" ? chat.id : "";
      if (!chatId) {
        throw new Error("Failed to create chat.");
      }

      const msgRes = await authedFetch<{
        assistant_message?: { content?: string };
        reply?: string;
      }>(`/agent/chats/${chatId}/messages?org_id=${orgId}`, {
        method: "POST",
        body: JSON.stringify({ message: testInput }),
      });

      setTestResult(
        msgRes.assistant_message?.content ??
          msgRes.reply ??
          JSON.stringify(msgRes, null, 2)
      );
    } catch (err) {
      setTestResult(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setTesting(false);
    }
  }, [orgId, selected, testInput]);

  return (
    <div className="flex gap-6">
      <div className="w-64 shrink-0 space-y-1">
        <p className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-[0.15em]">
          {isEn ? "Agents" : "Agentes"}
        </p>
        {sortedAgents.map((agent) => (
          <button
            className={cn(
              "w-full rounded-md px-3 py-2 text-left transition-colors",
              selected?.slug === agent.slug
                ? "bg-muted/60 text-foreground"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
            key={agent.slug}
            onClick={() => selectAgent(agent.slug)}
            type="button"
          >
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  agent.is_active ? "bg-emerald-500" : "bg-muted-foreground/30"
                )}
              />
              <span className="truncate font-medium text-sm">{agent.name}</span>
            </div>
            <p className="mt-0.5 ml-[18px] truncate text-muted-foreground text-xs">
              {agent.description}
            </p>
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        {!(selected || loading) && (
          <div className="flex h-64 items-center justify-center">
            <p className="text-muted-foreground text-sm">
              {isEn
                ? "Select an agent to configure."
                : "Seleccione un agente para configurar."}
            </p>
          </div>
        )}

        {loading && (
          <div className="flex h-64 items-center justify-center">
            <p className="animate-pulse text-muted-foreground text-sm">
              {isEn ? "Loading..." : "Cargando..."}
            </p>
          </div>
        )}

        {selected && !loading && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4 border-border/50 border-b pb-4">
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-base">
                  {selected.name}
                </h3>
                <p className="text-muted-foreground text-xs">
                  {selected.description}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                  <span className="text-muted-foreground">
                    {isActive
                      ? isEn
                        ? "Active"
                        : "Activo"
                      : isEn
                        ? "Inactive"
                        : "Inactivo"}
                  </span>
                </label>
                <Button
                  className="h-8 w-8 p-0"
                  onClick={() => setTestOpen((v) => !v)}
                  size="sm"
                  title={isEn ? "Test Agent" : "Probar Agente"}
                  variant="ghost"
                >
                  <Icon
                    className={cn(
                      "text-muted-foreground",
                      testOpen && "text-foreground"
                    )}
                    icon={TestTube01Icon}
                    size={16}
                  />
                </Button>
                <Button disabled={saving} onClick={handleSave} size="sm">
                  {saving
                    ? isEn
                      ? "Saving..."
                      : "Guardando..."
                    : isEn
                      ? "Save"
                      : "Guardar"}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
              <div className="flex items-start gap-2">
                <Icon
                  className="mt-0.5 text-primary"
                  icon={SparklesIcon}
                  size={14}
                />
                <div className="space-y-1">
                  <p className="font-medium text-sm">
                    {isEn
                      ? "Code-owned agent contracts"
                      : "Contratos gestionados por código"}
                  </p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {isEn
                      ? "System prompts and allowed tools are now managed in backend source control. This panel only edits per-organization runtime overrides."
                      : "Los prompts del sistema y herramientas permitidas ahora se administran en el código del backend. Este panel solo edita overrides de ejecución por organización."}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="font-medium text-sm" htmlFor="model-override">
                  {isEn ? "Model override" : "Override de modelo"}
                </label>
                <Input
                  id="model-override"
                  onChange={(e) => setModelOverride(e.target.value)}
                  placeholder={isEn ? "e.g. gpt-5.2-mini" : "ej. gpt-5.2-mini"}
                  value={modelOverride}
                />
                <p className="text-muted-foreground text-xs">
                  {isEn
                    ? "Leave empty to use chat preference or global model chain."
                    : "Déjalo vacío para usar la preferencia del chat o la cadena global de modelos."}
                </p>
              </div>

              <div className="space-y-2">
                <label
                  className="font-medium text-sm"
                  htmlFor="max-steps-override"
                >
                  {isEn ? "Max steps override" : "Override de pasos máximos"}
                </label>
                <Input
                  id="max-steps-override"
                  inputMode="numeric"
                  onChange={(e) => setMaxStepsOverride(e.target.value)}
                  placeholder="1-24"
                  value={maxStepsOverride}
                />
                <p className="text-muted-foreground text-xs">
                  {isEn
                    ? "Limits tool-loop iterations for this agent in this organization."
                    : "Limita las iteraciones del loop de herramientas para este agente en esta organización."}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <Icon
                  className="text-muted-foreground"
                  icon={Settings02Icon}
                  size={14}
                />
                <span className="font-medium text-sm">
                  {isEn
                    ? "Allow mutations by default"
                    : "Permitir mutaciones por defecto"}
                </span>
              </div>
              <Switch
                checked={allowMutationsDefault}
                onCheckedChange={setAllowMutationsDefault}
              />
            </div>

            <div className="space-y-2">
              <label
                className="font-medium text-sm"
                htmlFor="guardrail-overrides"
              >
                {isEn
                  ? "Guardrail overrides (JSON)"
                  : "Overrides de guardrails (JSON)"}
              </label>
              <Textarea
                className="font-mono text-[13px]"
                id="guardrail-overrides"
                onChange={(e) => setGuardrailOverrides(e.target.value)}
                rows={8}
                value={guardrailOverrides}
              />
              <div className="flex justify-end">
                <Badge className="text-[10px] tabular-nums" variant="secondary">
                  {guardrailOverrides.length.toLocaleString()}{" "}
                  {isEn ? "chars" : "caracteres"}
                </Badge>
              </div>
            </div>

            {testOpen && (
              <div className="space-y-3 border-border/50 border-t pt-4">
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    onChange={(e) => setTestInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) handleTest();
                    }}
                    placeholder={
                      isEn
                        ? "Type a test message..."
                        : "Escribe un mensaje de prueba..."
                    }
                    value={testInput}
                  />
                  <Button
                    disabled={testing || !testInput.trim()}
                    onClick={handleTest}
                    size="sm"
                  >
                    {testing
                      ? isEn
                        ? "Running..."
                        : "Ejecutando..."
                      : isEn
                        ? "Send"
                        : "Enviar"}
                  </Button>
                </div>
                {testResult && (
                  <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm leading-relaxed">
                    {testResult}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
