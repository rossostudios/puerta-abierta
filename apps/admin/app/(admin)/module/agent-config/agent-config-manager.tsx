"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authedFetch } from "@/lib/api-client";

const ALL_TOOLS = [
  "list_tables",
  "get_org_snapshot",
  "list_rows",
  "get_row",
  "create_row",
  "update_row",
  "delete_row",
  "delegate_to_agent",
  "get_occupancy_forecast",
  "get_anomaly_alerts",
  "get_today_ops_brief",
  "get_lease_risk_summary",
  "get_collections_risk",
  "get_owner_statement_summary",
  "search_knowledge",
  "send_message",
  "get_staff_availability",
  "create_maintenance_task",
  "get_revenue_analytics",
  "get_seasonal_demand",
  "generate_owner_statement",
  "reconcile_collections",
  "categorize_expense",
  "recall_memory",
  "store_memory",
] as const;

type AgentRow = {
  slug: string;
  name: string;
  description: string;
  icon_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type AgentDetail = AgentRow & {
  system_prompt?: string | null;
  allowed_tools: string[];
};

type Props = {
  orgId: string;
  initialAgents: AgentRow[];
  locale: string;
};

export function AgentConfigManager({ orgId, initialAgents, locale }: Props) {
  const isEn = locale === "en-US";
  const [agents, setAgents] = useState<AgentRow[]>(initialAgents);
  const [selected, setSelected] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [prompt, setPrompt] = useState("");
  const [enabledTools, setEnabledTools] = useState<Set<string>>(new Set());
  const [isActive, setIsActive] = useState(false);

  // Test panel
  const [testInput, setTestInput] = useState("");
  const [testResult, setTestResult] = useState("");
  const [testing, setTesting] = useState(false);

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
        setPrompt(detail.system_prompt ?? "");
        setEnabledTools(new Set(detail.allowed_tools ?? []));
        setIsActive(detail.is_active);
      } catch (err) {
        console.error("Failed to fetch agent:", err);
      } finally {
        setLoading(false);
      }
    },
    [orgId]
  );

  const handleSave = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await authedFetch(`/ai-agents/${selected.slug}`, {
        method: "PATCH",
        body: JSON.stringify({
          org_id: orgId,
          system_prompt: prompt,
          allowed_tools: Array.from(enabledTools),
          is_active: isActive,
        }),
      });
      // Update local list
      setAgents((prev) =>
        prev.map((a) =>
          a.slug === selected.slug ? { ...a, is_active: isActive } : a
        )
      );
    } catch (err) {
      console.error("Failed to save agent:", err);
    } finally {
      setSaving(false);
    }
  }, [selected, orgId, prompt, enabledTools, isActive]);

  const toggleTool = useCallback((tool: string) => {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) {
        next.delete(tool);
      } else {
        next.add(tool);
      }
      return next;
    });
  }, []);

  const handleTest = useCallback(async () => {
    if (!selected || !testInput.trim()) return;
    setTesting(true);
    setTestResult("");
    try {
      const res = await authedFetch<{ reply?: string; content?: string }>(
        `/agent/chats`,
        {
          method: "POST",
          body: JSON.stringify({
            org_id: orgId,
            agent_slug: selected.slug,
            title: `Test: ${testInput.slice(0, 40)}`,
          }),
        }
      );
      const chatId = (res as Record<string, unknown>).id as string;
      if (chatId) {
        const msgRes = await authedFetch<{
          assistant_message?: { content?: string };
        }>(`/agent/chats/${chatId}/messages?org_id=${orgId}`, {
          method: "POST",
          body: JSON.stringify({ message: testInput }),
        });
        setTestResult(
          msgRes.assistant_message?.content ?? JSON.stringify(msgRes, null, 2)
        );
      }
    } catch (err) {
      setTestResult(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setTesting(false);
    }
  }, [selected, orgId, testInput]);

  return (
    <div className="flex gap-6">
      {/* Agent list (left panel) */}
      <div className="w-64 shrink-0 space-y-1">
        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
          {isEn ? "Agents" : "Agentes"}
        </p>
        {agents.map((agent) => (
          <button
            key={agent.slug}
            onClick={() => selectAgent(agent.slug)}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
              selected?.slug === agent.slug
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{agent.name}</span>
              <Badge
                variant={agent.is_active ? "default" : "secondary"}
                className="text-[10px] shrink-0"
              >
                {agent.is_active
                  ? isEn
                    ? "Active"
                    : "Activo"
                  : isEn
                    ? "Inactive"
                    : "Inactivo"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {agent.description}
            </p>
          </button>
        ))}
        {agents.length === 0 && (
          <p className="text-sm text-muted-foreground py-4">
            {isEn ? "No agents configured." : "No hay agentes configurados."}
          </p>
        )}
      </div>

      {/* Detail panel (right) */}
      <div className="flex-1 min-w-0">
        {!selected && !loading && (
          <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
            {isEn
              ? "Select an agent to configure."
              : "Seleccione un agente para configurar."}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
            {isEn ? "Loading..." : "Cargando..."}
          </div>
        )}

        {selected && !loading && (
          <div className="space-y-6">
            {/* Header + active toggle */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">{selected.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {selected.slug}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded"
                  />
                  {isEn ? "Active" : "Activo"}
                </label>
                <Button size="sm" disabled={saving} onClick={handleSave}>
                  {saving
                    ? isEn
                      ? "Saving..."
                      : "Guardando..."
                    : isEn
                      ? "Save Changes"
                      : "Guardar Cambios"}
                </Button>
              </div>
            </div>

            {/* System prompt */}
            <div>
              <label className="text-sm font-medium block mb-1.5">
                {isEn ? "System Prompt" : "Prompt del Sistema"}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={10}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={
                  isEn
                    ? "Enter system instructions for this agent..."
                    : "Ingresa las instrucciones del sistema para este agente..."
                }
              />
              <p className="text-xs text-muted-foreground mt-1">
                {prompt.length.toLocaleString()}{" "}
                {isEn ? "characters" : "caracteres"}
              </p>
            </div>

            {/* Allowed tools */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">
                  {isEn ? "Allowed Tools" : "Herramientas Permitidas"} (
                  {enabledTools.size}/{ALL_TOOLS.length})
                </label>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEnabledTools(new Set(ALL_TOOLS))}
                  >
                    {isEn ? "Select All" : "Seleccionar Todo"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEnabledTools(new Set())}
                  >
                    {isEn ? "Clear" : "Limpiar"}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_TOOLS.map((tool) => (
                  <button
                    key={tool}
                    onClick={() => toggleTool(tool)}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors border ${
                      enabledTools.has(tool)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted text-muted-foreground border-transparent hover:border-border"
                    }`}
                  >
                    {tool}
                  </button>
                ))}
              </div>
            </div>

            {/* Test panel */}
            <div className="rounded-lg border p-4 space-y-3">
              <h4 className="text-sm font-medium">
                {isEn ? "Test Agent" : "Probar Agente"}
              </h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) handleTest();
                  }}
                  placeholder={
                    isEn
                      ? "Type a test message..."
                      : "Escribe un mensaje de prueba..."
                  }
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button
                  size="sm"
                  disabled={testing || !testInput.trim()}
                  onClick={handleTest}
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
                <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                  {testResult}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
