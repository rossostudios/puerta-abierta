"use client";

import { Copy01Icon, Loading03Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ChatMessage,
  type DisplayMessage,
} from "@/components/agent/chat-message";
import { ChatInputBar } from "@/components/agent/chat-input-bar";
import {
  ChatToolEventStrip,
  type StreamToolEvent,
  type ToolTraceEntry,
} from "@/components/agent/chat-tool-event";
import { normalizeAgents } from "@/components/agent/chat-thread-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ui/conversation";
import { Icon } from "@/components/ui/icon";
import { Message, MessageContent } from "@/components/ui/message";
import { Select } from "@/components/ui/select";
import type { AgentDefinition, AgentModelOption } from "@/lib/api";
import { isInputFocused } from "@/lib/hotkeys/is-input-focused";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { PROMPT_TEMPLATES } from "./prompt-templates";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeModels(payload: unknown): AgentModelOption[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const models: AgentModelOption[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const model =
      typeof item.model === "string"
        ? item.model.trim()
        : typeof item.id === "string"
          ? item.id.trim()
          : "";
    if (!model || seen.has(model)) continue;
    seen.add(model);
    models.push({ model, is_primary: item.is_primary === true });
  }
  return models;
}

type ToolInspectorEntry = {
  id: string;
  tool_name: string;
  args: Record<string, unknown>;
  result?: string;
  ok?: boolean;
  duration_ms?: number;
  timestamp: number;
};

const MUTATION_TOOLS = new Set([
  "create_row",
  "update_row",
  "delete_row",
  "send_message",
]);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlaygroundManager({
  orgId,
  locale,
  propertyId,
  propertyName,
  defaultAgentSlug,
}: {
  orgId: string;
  locale: Locale;
  propertyId?: string;
  propertyName?: string;
  defaultAgentSlug?: string;
}) {
  const isEn = locale === "en-US";
  const hasPropertyContext = !!(propertyId && propertyName);
  const isFirstMessageRef = useRef(true);

  // --- state ---------------------------------------------------------------
  const [selectedAgentSlug, setSelectedAgentSlug] = useState(
    defaultAgentSlug || "guest-concierge"
  );
  const [selectedModel, setSelectedModel] = useState("");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamToolEvents, setStreamToolEvents] = useState<StreamToolEvent[]>(
    []
  );
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [toolInspector, setToolInspector] = useState<ToolInspectorEntry[]>([]);

  const activeChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  // --- queries -------------------------------------------------------------
  const agentsQuery = useQuery<AgentDefinition[], Error>({
    queryKey: ["agents", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/agents?org_id=${encodeURIComponent(orgId)}`,
        { method: "GET", cache: "no-store", headers: { Accept: "application/json" } }
      );
      const payload = (await res.json()) as unknown;
      if (!res.ok) return [];
      return normalizeAgents(payload);
    },
    staleTime: 60_000,
    enabled: !!orgId,
    retry: false,
  });

  const activeAgents = useMemo(
    () => (agentsQuery.data ?? []).filter((a) => a.is_active !== false),
    [agentsQuery.data]
  );

  const modelOptionsQuery = useQuery<AgentModelOption[], Error>({
    queryKey: ["agent-model-options", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/models?org_id=${encodeURIComponent(orgId)}`,
        { method: "GET", cache: "no-store", headers: { Accept: "application/json" } }
      );
      const payload = (await res.json()) as unknown;
      if (!res.ok) return [];
      return normalizeModels(payload);
    },
    staleTime: 60_000,
    enabled: !!orgId,
    retry: false,
  });

  const modelOptions = modelOptionsQuery.data ?? [];
  const primaryModel =
    modelOptions.find((i) => i.is_primary)?.model ?? modelOptions[0]?.model ?? "";

  useEffect(() => {
    if (!selectedModel && primaryModel) setSelectedModel(primaryModel);
  }, [primaryModel, selectedModel]);

  // Auto-select agent
  useEffect(() => {
    if (activeAgents.length === 0) return;
    const exists = activeAgents.some((a) => a.slug === selectedAgentSlug);
    if (!exists) {
      // If a default was provided via URL param, try that first
      if (defaultAgentSlug) {
        const defaultAgent = activeAgents.find((a) => a.slug === defaultAgentSlug);
        if (defaultAgent) {
          setSelectedAgentSlug(defaultAgent.slug);
          return;
        }
      }
      const preferred = activeAgents.find((a) => a.slug === "guest-concierge");
      setSelectedAgentSlug(preferred?.slug ?? activeAgents[0].slug);
    }
  }, [activeAgents, selectedAgentSlug, defaultAgentSlug]);

  const selectedAgent = useMemo(
    () => activeAgents.find((a) => a.slug === selectedAgentSlug) ?? null,
    [activeAgents, selectedAgentSlug]
  );

  // --- chat creation + streaming -------------------------------------------
  const ensureChatId = async (): Promise<string> => {
    if (activeChatIdRef.current) return activeChatIdRef.current;
    const res = await fetch("/api/agent/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org_id: orgId,
        agent_slug: selectedAgentSlug,
        preferred_model: selectedModel || null,
      }),
    });
    const payload = (await res.json()) as { id?: string; error?: string };
    if (!(res.ok && payload.id))
      throw new Error(
        payload.error ?? (isEn ? "Failed to create chat." : "No se pudo crear el chat.")
      );
    const nextId = String(payload.id);
    activeChatIdRef.current = nextId;
    setActiveChatId(nextId);
    return nextId;
  };

  const handleSend = useCallback(
    async (value?: string) => {
      const message = (value ?? draft).trim();
      if (!message || isSending) return;

      setError(null);
      setDraft("");
      setStreamToolEvents([]);
      setStreamStatus(null);
      setThinkingSteps([]);

      // Inject property context into first message
      let messageToSend = message;
      if (hasPropertyContext && isFirstMessageRef.current) {
        messageToSend = `[Property context: ${propertyName}, ID: ${propertyId}]\n${message}`;
        isFirstMessageRef.current = false;
      }

      // Add user message immediately (show original, not injected)
      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: message,
        source: "live",
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsSending(true);

      try {
        const chatId = await ensureChatId();

        // Use SSE streaming endpoint
        const res = await fetch(
          `/api/agent/chats/${encodeURIComponent(chatId)}/messages/stream?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({ message: messageToSend, org_id: orgId }),
          }
        );

        if (!res.ok) {
          const errorPayload = await res.json().catch(() => ({}));
          throw new Error(
            (errorPayload as { error?: string }).error ??
              (isEn ? "Request failed." : "La solicitud fallo.")
          );
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream.");

        const decoder = new TextDecoder();
        let buffer = "";
        let assistantContent = "";
        let modelUsed: string | null = null;
        let toolTrace: ToolTraceEntry[] = [];
        const assistantId = `assistant-${Date.now()}`;
        const toolTimings = new Map<string, number>();

        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;

          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;

            try {
              const parsed = JSON.parse(raw);

              // Text content
              if (parsed.type === "text-delta" || parsed.type === "text") {
                const delta =
                  typeof parsed.textDelta === "string"
                    ? parsed.textDelta
                    : typeof parsed.delta === "string"
                      ? parsed.delta
                      : typeof parsed.text === "string"
                        ? parsed.text
                        : "";
                if (delta) {
                  assistantContent += delta;
                  setMessages((prev) => {
                    const existing = prev.find((m) => m.id === assistantId);
                    if (existing) {
                      return prev.map((m) =>
                        m.id === assistantId
                          ? { ...m, content: assistantContent }
                          : m
                      );
                    }
                    return [
                      ...prev,
                      {
                        id: assistantId,
                        role: "assistant",
                        content: assistantContent,
                        model_used: modelUsed,
                        tool_trace: toolTrace.length > 0 ? toolTrace : undefined,
                        source: "live",
                      },
                    ];
                  });
                }
              }

              // Tool events (casaora custom) — handle both
              // array-wrapped format: { type: "data", data: [...] }
              // and direct format: { type: "data-casaora-tool", data: {...} }
              const eventItems: Array<{ type?: string; data?: unknown }> =
                parsed.type === "data" &&
                parsed.data &&
                Array.isArray(parsed.data)
                  ? (parsed.data as Array<{ type?: string; data?: unknown }>)
                  : typeof parsed.type === "string" &&
                      parsed.type.startsWith("data-casaora")
                    ? [parsed as { type?: string; data?: unknown }]
                    : [];

              for (const item of eventItems) {
                if (item.type === "data-casaora-tool" && item.data) {
                  const d = item.data as {
                    phase?: string;
                    tool_name?: string;
                    tool_call_id?: string;
                    ok?: boolean;
                    preview?: string;
                    args?: Record<string, unknown>;
                  };
                  const toolCallId =
                    typeof d.tool_call_id === "string"
                      ? d.tool_call_id
                      : `tool-${Date.now()}`;
                  const toolName =
                    typeof d.tool_name === "string" ? d.tool_name : "tool";

                  setStreamToolEvents((prev) => [
                    ...prev,
                    {
                      phase: d.phase === "result" ? "result" : "call",
                      tool_name: toolName,
                      tool_call_id: toolCallId,
                      ok: typeof d.ok === "boolean" ? d.ok : undefined,
                      preview:
                        typeof d.preview === "string" ? d.preview : undefined,
                    },
                  ]);

                  if (d.phase === "call") {
                    toolTimings.set(toolCallId, Date.now());
                    setToolInspector((prev) => [
                      ...prev,
                      {
                        id: toolCallId,
                        tool_name: toolName,
                        args: d.args ?? {},
                        timestamp: Date.now(),
                      },
                    ]);
                  } else if (d.phase === "result") {
                    const startTime = toolTimings.get(toolCallId);
                    const duration_ms = startTime
                      ? Date.now() - startTime
                      : undefined;
                    setToolInspector((prev) =>
                      prev.map((entry) =>
                        entry.id === toolCallId
                          ? {
                              ...entry,
                              result: d.preview ?? (d.ok !== false ? "ok" : "error"),
                              ok: d.ok,
                              duration_ms,
                            }
                          : entry
                      )
                    );
                    toolTrace.push({
                      tool: toolName,
                      ok: d.ok,
                      preview: d.preview,
                    });
                  }
                }

                if (item.type === "data-casaora-meta" && item.data) {
                  const meta = item.data as { model_used?: string };
                  if (typeof meta.model_used === "string") {
                    modelUsed = meta.model_used;
                  }
                }

                // Accumulate thinking steps
                if (item.type === "data-casaora-status" && item.data) {
                  const s = item.data as { message?: string };
                  if (typeof s.message === "string" && s.message.trim()) {
                    const stepMsg = s.message.trim();
                    setStreamStatus(stepMsg);
                    setThinkingSteps((prev) => {
                      if (prev[prev.length - 1] === stepMsg) return prev;
                      return [...prev, stepMsg];
                    });
                  }
                }
              }
            } catch {
              // skip non-JSON lines
            }
          }
        }

        // Finalize assistant message
        if (assistantContent) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: assistantContent,
                    model_used: modelUsed,
                    tool_trace: toolTrace.length > 0 ? toolTrace : undefined,
                  }
                : m
            )
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSending(false);
        setStreamToolEvents([]);
        setStreamStatus(null);
        setThinkingSteps([]);
      }
    },
    [draft, isSending, isEn, orgId, selectedAgentSlug, selectedModel, hasPropertyContext, propertyName, propertyId]
  );

  // Stable ref for send
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  const handleNewSession = useCallback(() => {
    activeChatIdRef.current = null;
    isFirstMessageRef.current = true;
    setActiveChatId(null);
    setMessages([]);
    setToolInspector([]);
    setError(null);
    setDraft("");
    setStreamToolEvents([]);
    setStreamStatus(null);
    setThinkingSteps([]);
  }, []);

  const handleAgentChange = useCallback(
    (slug: string) => {
      setSelectedAgentSlug(slug);
      handleNewSession();
    },
    [handleNewSession]
  );

  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      /* ignore */
    }
  }, []);

  // --- Item 6: Keyboard shortcuts ------------------------------------------
  useHotkey("Mod+K", (e) => {
    e.preventDefault();
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "[data-playground-input] textarea"
    );
    textarea?.focus();
  });

  useHotkey("Mod+Shift+N", (e) => {
    if (!isInputFocused()) {
      e.preventDefault();
      handleNewSession();
    }
  });

  // --- render --------------------------------------------------------------
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      {/* Main chat area */}
      <Card className="flex flex-col overflow-hidden" style={{ minHeight: "70vh" }}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border/40 px-4 py-3">
          <Select
            className="w-48"
            onChange={(e) => handleAgentChange(e.target.value)}
            value={selectedAgentSlug}
          >
            {activeAgents.map((agent) => (
              <option key={agent.slug} value={agent.slug}>
                {agent.name}
              </option>
            ))}
          </Select>

          <Select
            className="w-40"
            onChange={(e) => setSelectedModel(e.target.value)}
            value={selectedModel}
          >
            {modelOptions.map((opt) => (
              <option key={opt.model} value={opt.model}>
                {opt.model}
                {opt.is_primary ? " *" : ""}
              </option>
            ))}
          </Select>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[10px] text-muted-foreground/50 sm:inline">
              {isEn ? "⌘K focus · ⌘⇧N new" : "⌘K enfocar · ⌘⇧N nueva"}
            </span>
            <Button
              onClick={handleNewSession}
              size="sm"
              variant="outline"
            >
              {isEn ? "New Session" : "Nueva Sesion"}
            </Button>
          </div>
        </div>

        {/* Property context banner */}
        {hasPropertyContext && (
          <div className="flex items-center gap-2 border-b border-border/20 bg-primary/5 px-4 py-2">
            <Icon className="h-3.5 w-3.5 text-primary" icon={SparklesIcon} />
            <span className="text-[11px] font-medium text-primary">
              {isEn ? "Context:" : "Contexto:"} {propertyName}
            </span>
          </div>
        )}

        {/* Prompt template chips */}
        <div className="flex flex-wrap gap-1.5 border-b border-border/20 px-4 py-2">
          {PROMPT_TEMPLATES.map((tmpl) => (
            <button
              className={cn(
                "rounded-full border border-border/40 bg-muted/30 px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors",
                "hover:border-border/60 hover:bg-muted/60 hover:text-foreground",
                isSending && "pointer-events-none opacity-50"
              )}
              disabled={isSending}
              key={tmpl.label}
              onClick={() => handleSend(tmpl.prompt)}
              type="button"
            >
              {tmpl.label}
            </button>
          ))}
        </div>

        {/* Messages */}
        <Conversation className="flex-1 p-0 pb-48">
          <ConversationContent className="mx-auto flex max-w-3xl flex-col space-y-5 p-4 sm:p-6">
            {error ? (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            {messages.length === 0 && !isSending ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-casaora-gradient text-white shadow-casaora">
                  <Icon className="h-5 w-5" icon={SparklesIcon} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {isEn
                    ? "Select a prompt template above or type your own message to start testing."
                    : "Selecciona una plantilla arriba o escribe tu propio mensaje para comenzar."}
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <ChatMessage
                  isEn={isEn}
                  isSending={isSending}
                  key={msg.id}
                  message={msg}
                  onCopy={handleCopy}
                  onEdit={() => {}}
                  onRetry={() => {}}
                />
              ))
            )}

            {/* Streaming indicator with thinking steps */}
            {isSending ? (
              <Message className="items-start py-3" from="assistant">
                <div className="mt-0.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-casaora-gradient text-white shadow-casaora">
                    <Icon
                      className="h-3.5 w-3.5 animate-spin"
                      icon={Loading03Icon}
                    />
                  </div>
                </div>
                <MessageContent variant="flat">
                  <div className="min-w-0 flex-1 space-y-2 py-0.5">
                    {/* Item 4: Thinking steps timeline */}
                    {thinkingSteps.length > 0 ? (
                      <div className="space-y-1">
                        {thinkingSteps.map((step, idx) => {
                          const isLatest = idx === thinkingSteps.length - 1;
                          return (
                            <div
                              className="flex items-start gap-2"
                              key={`step-${idx}`}
                            >
                              <span
                                className={cn(
                                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[9px] tabular-nums",
                                  isLatest
                                    ? "animate-pulse bg-[var(--sidebar-primary)]/20 text-[var(--sidebar-primary)]"
                                    : "bg-muted/60 text-muted-foreground/60"
                                )}
                              >
                                {isLatest ? (
                                  idx + 1
                                ) : (
                                  <span className="text-emerald-500">✓</span>
                                )}
                              </span>
                              <span
                                className={cn(
                                  "text-[11px]",
                                  isLatest
                                    ? "text-muted-foreground/70"
                                    : "text-muted-foreground/50"
                                )}
                              >
                                {step}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {streamToolEvents.length > 0 ? (
                      <ChatToolEventStrip events={streamToolEvents} isEn={isEn} />
                    ) : null}

                    {streamToolEvents.length === 0 && thinkingSteps.length === 0 ? (
                      <p className="flex items-center gap-2.5 text-[13px] text-muted-foreground/60">
                        <span className="flex gap-1">
                          <span
                            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sidebar-primary)]/60"
                            style={{ animationDelay: "0ms" }}
                          />
                          <span
                            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sidebar-primary)]/60"
                            style={{ animationDelay: "150ms" }}
                          />
                          <span
                            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sidebar-primary)]/60"
                            style={{ animationDelay: "300ms" }}
                          />
                        </span>
                        {isEn ? "Thinking" : "Pensando"}
                      </p>
                    ) : null}
                  </div>
                </MessageContent>
              </Message>
            ) : null}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Input */}
        <div data-playground-input>
          <ChatInputBar
            agentName={selectedAgent?.name}
            attachments={[]}
            attachmentsReady
            draft={draft}
            editingSourceId={null}
            isEmbedded={false}
            isEn={isEn}
            isListening={false}
            isSending={isSending}
            onAddFiles={() => {}}
            onCancelEdit={() => {}}
            onDraftChange={setDraft}
            onRemoveAttachment={() => {}}
            onSend={(value) => {
              handleSend(value).catch(() => undefined);
            }}
            onStop={() => {}}
            onToggleVoice={() => {}}
            voiceModeActive={false}
            voiceSupported={false}
            voiceTranscript=""
          />
        </div>
      </Card>

      {/* Tool Inspector panel */}
      <Card className="flex flex-col overflow-hidden" style={{ minHeight: "70vh" }}>
        <div className="border-b border-border/40 px-4 py-3">
          <h3 className="font-semibold text-sm">
            {isEn ? "Tool Inspector" : "Inspector de Herramientas"}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {isEn
              ? "Tool calls from the current session"
              : "Llamadas de herramientas de la sesion actual"}
          </p>
        </div>

        <CardContent className="flex-1 overflow-y-auto p-0">
          {toolInspector.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-xs text-muted-foreground/60">
                {isEn
                  ? "Tool calls will appear here as the agent processes your request."
                  : "Las llamadas de herramientas apareceran aqui cuando el agente procese tu solicitud."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {toolInspector.map((entry) => (
                <ToolInspectorCard entry={entry} isEn={isEn} key={entry.id} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool Inspector Card (Item 7: copy buttons + mutation highlighting)
// ---------------------------------------------------------------------------

function ToolInspectorCard({
  entry,
  isEn,
}: {
  entry: ToolInspectorEntry;
  isEn: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const hasResult = entry.result !== undefined;
  const isMutation = MUTATION_TOOLS.has(entry.tool_name);

  const handleCopyJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(entry.args, null, 2)
      );
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 1500);
    } catch {
      /* ignore */
    }
  }, [entry.args]);

  const handleCopyCurl = useCallback(async () => {
    const curl = `curl -X POST /api/agent/tools/${entry.tool_name} \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(entry.args)}'`;
    try {
      await navigator.clipboard.writeText(curl);
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 1500);
    } catch {
      /* ignore */
    }
  }, [entry.tool_name, entry.args]);

  return (
    <div
      className={cn(
        "px-3 py-2.5",
        isMutation && "border-l-2 border-l-amber-500"
      )}
    >
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((prev) => !prev)}
        type="button"
      >
        {hasResult ? (
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              entry.ok !== false ? "bg-emerald-500" : "bg-destructive"
            )}
          />
        ) : (
          <Icon className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" icon={Loading03Icon} />
        )}
        <span className="flex-1 truncate font-mono text-[11px] font-medium text-foreground/80">
          {entry.tool_name.replace(/_/g, " ")}
        </span>
        {isMutation ? (
          <Badge className="text-[8px] text-amber-600" variant="outline">
            mut
          </Badge>
        ) : null}
        {entry.duration_ms !== undefined ? (
          <Badge className="text-[9px]" variant="outline">
            {entry.duration_ms}ms
          </Badge>
        ) : null}
      </button>

      {expanded ? (
        <div className="mt-2 space-y-2">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <p className="text-[10px] font-medium text-muted-foreground">
                {isEn ? "Arguments" : "Argumentos"}
              </p>
              <button
                className={cn(
                  "flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors",
                  copiedJson
                    ? "text-emerald-500"
                    : "text-muted-foreground/60 hover:bg-muted/60 hover:text-foreground"
                )}
                onClick={handleCopyJson}
                type="button"
              >
                <Icon className="h-2.5 w-2.5" icon={Copy01Icon} />
                {copiedJson
                  ? isEn
                    ? "Copied!"
                    : "Copiado!"
                  : "JSON"}
              </button>
              <button
                className={cn(
                  "flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium transition-colors",
                  copiedCurl
                    ? "text-emerald-500"
                    : "text-muted-foreground/60 hover:bg-muted/60 hover:text-foreground"
                )}
                onClick={handleCopyCurl}
                type="button"
              >
                <Icon className="h-2.5 w-2.5" icon={Copy01Icon} />
                {copiedCurl
                  ? isEn
                    ? "Copied!"
                    : "Copiado!"
                  : "cURL"}
              </button>
            </div>
            <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px] text-foreground/70">
              {JSON.stringify(entry.args, null, 2)}
            </pre>
          </div>
          {entry.result ? (
            <div>
              <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                {isEn ? "Result" : "Resultado"}
              </p>
              <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px] text-foreground/70">
                {entry.result}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
