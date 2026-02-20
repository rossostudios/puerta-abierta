"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { AgentChatMessage, AgentChatSummary } from "@/lib/api";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PROMPTS: Record<string, { "en-US": string[]; "es-PY": string[] }> = {
  "morning-brief": {
    "en-US": [
      "Give me today's top 5 priorities.",
      "Which turnovers are at risk this morning?",
      "What is the biggest operational bottleneck now?",
    ],
    "es-PY": [
      "Dame las 5 prioridades de hoy.",
      "¿Qué turnovers están en riesgo esta mañana?",
      "¿Cuál es el mayor cuello de botella operativo ahora?",
    ],
  },
  "ops-dispatch": {
    "en-US": [
      "Show all tasks at risk of SLA breach today.",
      "Which team assignments should I rebalance right now?",
      "Give me a dispatch plan for overdue turnovers.",
    ],
    "es-PY": [
      "Muestra todas las tareas en riesgo de incumplir SLA hoy.",
      "¿Qué asignaciones del equipo debo rebalancear ahora?",
      "Dame un plan de despacho para turnovers vencidos.",
    ],
  },
  "leasing-funnel": {
    "en-US": [
      "Which applications are stalled and need follow-up?",
      "What is slowing down lease conversion this week?",
      "Prioritize the top applicants that should move forward today.",
    ],
    "es-PY": [
      "¿Qué solicitudes están estancadas y requieren seguimiento?",
      "¿Qué está frenando la conversión de contratos esta semana?",
      "Prioriza los mejores solicitantes para avanzar hoy.",
    ],
  },
  "collections-finance": {
    "en-US": [
      "Summarize this month's revenue by property.",
      "Compare revenue vs expenses for the last 3 months.",
      "Flag any unusual expenses this month.",
    ],
    "es-PY": [
      "Resume los ingresos de este mes por propiedad.",
      "Compara ingresos vs gastos de los últimos 3 meses.",
      "Señala gastos inusuales de este mes.",
    ],
  },
  "guest-comms": {
    "en-US": [
      "Draft a check-in message for this week's arrivals.",
      "Show me all guests arriving in the next 7 days.",
      "Write a welcome message for the guest in unit 3.",
    ],
    "es-PY": [
      "Redacta un mensaje de check-in para las llegadas de esta semana.",
      "Muéstrame todos los huéspedes que llegan en los próximos 7 días.",
      "Escribe un mensaje de bienvenida para el huésped de la unidad 3.",
    ],
  },
  "marketplace-growth": {
    "en-US": [
      "Which listings have low conversion this week?",
      "Identify missing transparency info hurting conversion.",
      "What listing improvements would raise demand fastest?",
    ],
    "es-PY": [
      "¿Qué anuncios tienen baja conversión esta semana?",
      "Identifica información de transparencia faltante que afecta conversión.",
      "¿Qué mejoras de anuncios subirían la demanda más rápido?",
    ],
  },
  "price-optimizer": {
    "en-US": [
      "Which units have the lowest occupancy this month?",
      "Identify underpriced units based on market trends.",
      "Suggest seasonal pricing adjustments for next quarter.",
    ],
    "es-PY": [
      "¿Qué unidades tienen la ocupación más baja este mes?",
      "Identifica unidades con precios bajos según tendencias.",
      "Sugiere ajustes de precios estacionales para el próximo trimestre.",
    ],
  },
  "market-match": {
    "en-US": [
      "Match the latest applicants to available listings.",
      "Which pet-friendly listings are currently available?",
      "Score the top 5 pending applications by fit.",
    ],
    "es-PY": [
      "Empareja los últimos solicitantes con anuncios disponibles.",
      "¿Qué anuncios pet-friendly están disponibles?",
      "Puntúa las 5 mejores solicitudes pendientes por compatibilidad.",
    ],
  },
  "maintenance-triage": {
    "en-US": [
      "Show open maintenance requests sorted by urgency.",
      "Which properties have the most pending repairs?",
      "Estimate repair costs for all open tickets this month.",
    ],
    "es-PY": [
      "Muestra solicitudes de mantenimiento abiertas por urgencia.",
      "¿Qué propiedades tienen más reparaciones pendientes?",
      "Estima costos de reparación para tickets abiertos este mes.",
    ],
  },
  "compliance-guard": {
    "en-US": [
      "Flag any leases expiring in the next 30 days.",
      "Which tenants have overdue payments this month?",
      "Check document expirations across all properties.",
    ],
    "es-PY": [
      "Señala contratos que vencen en los próximos 30 días.",
      "¿Qué inquilinos tienen pagos vencidos este mes?",
      "Revisa vencimientos de documentos en todas las propiedades.",
    ],
  },
  default: {
    "en-US": [
      "Summarize the key risks for today.",
      "What should I fix first in operations?",
      "Give me a concise action plan.",
    ],
    "es-PY": [
      "Resume los riesgos clave de hoy.",
      "¿Qué debo corregir primero en operaciones?",
      "Dame un plan de acción conciso.",
    ],
  },
};

const MESSAGE_SKELETON_KEYS = [
  "message-skeleton-1",
  "message-skeleton-2",
  "message-skeleton-3",
  "message-skeleton-4",
  "message-skeleton-5",
];

interface ThreadData {
  chat: AgentChatSummary | null;
  messages: AgentChatMessage[];
}

function normalizeChat(payload: unknown): AgentChatSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (!(row.id && row.title)) return null;

  return {
    id: String(row.id),
    org_id: String(row.org_id ?? ""),
    agent_id: String(row.agent_id ?? ""),
    agent_slug: String(row.agent_slug ?? ""),
    agent_name: String(row.agent_name ?? ""),
    agent_icon_key:
      typeof row.agent_icon_key === "string" ? row.agent_icon_key : undefined,
    title: String(row.title),
    is_archived: Boolean(row.is_archived),
    last_message_at: String(row.last_message_at ?? ""),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    latest_message_preview:
      typeof row.latest_message_preview === "string"
        ? row.latest_message_preview
        : null,
  };
}

function normalizeMessages(payload: unknown): AgentChatMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];

  return data
    .filter((row): row is AgentChatMessage =>
      Boolean(row && typeof row === "object")
    )
    .map((row) => {
      const role: "user" | "assistant" =
        row.role === "assistant" ? "assistant" : "user";

      return {
        id: String(row.id ?? ""),
        chat_id: String(row.chat_id ?? ""),
        org_id: String(row.org_id ?? ""),
        role,
        content: String(row.content ?? ""),
        tool_trace: Array.isArray(row.tool_trace)
          ? (row.tool_trace as AgentChatMessage["tool_trace"])
          : undefined,
        model_used:
          typeof row.model_used === "string" ? row.model_used : undefined,
        fallback_used: Boolean(row.fallback_used ?? false),
        created_at: String(row.created_at ?? ""),
      };
    })
    .filter((row) => row.id && row.content);
}

async function fetchThread(chatId: string, orgId: string): Promise<ThreadData> {
  const [chatRes, messagesRes] = await Promise.all([
    fetch(
      `/api/agent/chats/${encodeURIComponent(chatId)}?org_id=${encodeURIComponent(orgId)}`,
      {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }
    ),
    fetch(
      `/api/agent/chats/${encodeURIComponent(chatId)}/messages?org_id=${encodeURIComponent(orgId)}&limit=160`,
      {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }
    ),
  ]);

  const chatPayload = (await chatRes.json()) as unknown;
  const messagesPayload = (await messagesRes.json()) as unknown;

  if (!chatRes.ok) {
    let message = "Could not load chat.";
    if (chatPayload != null && typeof chatPayload === "object" && "error" in chatPayload) {
      message = String((chatPayload as { error?: unknown }).error);
    }
    throw new Error(message);
  }

  if (!messagesRes.ok) {
    let message = "Could not load messages.";
    if (messagesPayload != null && typeof messagesPayload === "object" && "error" in messagesPayload) {
      message = String((messagesPayload as { error?: unknown }).error);
    }
    throw new Error(message);
  }

  return {
    chat: normalizeChat(chatPayload),
    messages: normalizeMessages(messagesPayload),
  };
}

export function ChatThread({
  orgId,
  locale,
  chatId,
}: {
  orgId: string;
  locale: Locale;
  chatId: string;
}) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const queryClient = useQueryClient();

  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [allowMutations, setAllowMutations] = useState(false);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingTools, setStreamingTools] = useState<
    { name: string; preview?: string; ok?: boolean }[]
  >([]);
  // Local messages appended optimistically during send (before refetch)
  const [localMessages, setLocalMessages] = useState<AgentChatMessage[]>([]);
  const [localChat, setLocalChat] = useState<AgentChatSummary | null>(null);

  const threadQuery = useQuery<ThreadData, Error>({
    queryKey: ["agent-thread", chatId, orgId],
    queryFn: () => fetchThread(chatId, orgId),
  });

  const chat = localChat ?? threadQuery.data?.chat ?? null;
  const messages = [
    ...(threadQuery.data?.messages ?? []),
    ...localMessages,
  ];
  const loading = threadQuery.isLoading;

  const quickPrompts = useMemo(() => {
    const key =
      chat?.agent_slug && PROMPTS[chat.agent_slug]
        ? chat.agent_slug
        : "default";
    return PROMPTS[key][locale];
  }, [chat?.agent_slug, locale]);

  const sendMessageStream = async (message: string) => {
    // Optimistically add user message
    setLocalMessages((prev) => [
      ...prev,
      {
        id: `temp-user-${Date.now()}`,
        chat_id: chatId,
        org_id: orgId,
        role: "user" as const,
        content: message,
        fallback_used: false,
        created_at: new Date().toISOString(),
      },
    ]);
    setStreamingText("");
    setStreamingTools([]);

    const response = await fetch(
      `/api/agent/chats/${encodeURIComponent(chatId)}/messages/stream?org_id=${encodeURIComponent(orgId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          allow_mutations: allowMutations,
          confirm_write: confirmWrite,
        }),
      }
    );

    if (!response.ok || !response.body) {
      throw new Error(
        isEn ? "Streaming failed." : "La transmisi\u00f3n fall\u00f3."
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      const remainder = lines.pop();
      buffer = remainder != null ? remainder : "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        let parsedEvent: Record<string, unknown> | null = null;
        try {
          parsedEvent = JSON.parse(data) as Record<string, unknown>;
        } catch {
          // Skip unparseable lines
        }
        if (parsedEvent == null) continue;

        const eventType = String(parsedEvent.type);
        const eventName = typeof parsedEvent.name === "string" ? parsedEvent.name : undefined;

        if (eventType === "tool_call" && eventName) {
          const nameVal = eventName;
          setStreamingTools((prev) => [
            ...prev,
            { name: nameVal },
          ]);
        } else if (eventType === "tool_result" && eventName) {
          const nameVal = eventName;
          const previewVal = typeof parsedEvent.preview === "string" ? parsedEvent.preview : undefined;
          const okVal = typeof parsedEvent.ok === "boolean" ? parsedEvent.ok : undefined;
          setStreamingTools((prev) =>
            prev.map((t) => {
              if (t.name === nameVal && t.preview === undefined) {
                return { ...t, preview: previewVal, ok: okVal };
              }
              return t;
            })
          );
        } else if (eventType === "token" && typeof parsedEvent.text === "string") {
          setStreamingText(parsedEvent.text);
        } else if (eventType === "done" && typeof parsedEvent.content === "string") {
          // Finalize: add assistant message
          const doneContent = parsedEvent.content as string;
          const doneToolTrace = parsedEvent.tool_trace as AgentChatMessage["tool_trace"];
          setLocalMessages((prev) => [
            ...prev,
            {
              id: `temp-assistant-${Date.now()}`,
              chat_id: chatId,
              org_id: orgId,
              role: "assistant" as const,
              content: doneContent,
              tool_trace: doneToolTrace,
              fallback_used: false,
              created_at: new Date().toISOString(),
            },
          ]);
          setStreamingText("");
          setStreamingTools([]);
        } else if (eventType === "error") {
          let errorMessage = "Agent error";
          if (typeof parsedEvent.message === "string") {
            errorMessage = parsedEvent.message;
          }
          throw new Error(errorMessage);
        }
      }
    }
  };

  const sendMessageFallback = async (message: string) => {
    const response = await fetch(
      `/api/agent/chats/${encodeURIComponent(chatId)}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          org_id: orgId,
          message,
          allow_mutations: allowMutations,
          confirm_write: confirmWrite,
        }),
      }
    );

    const payload = (await response.json()) as {
      error?: string;
      user_message?: AgentChatMessage;
      assistant_message?: AgentChatMessage;
      chat?: AgentChatSummary;
    };

    if (!response.ok) {
      throw new Error(
        payload.error ||
          (isEn ? "Message failed to send." : "No se pudo enviar el mensaje.")
      );
    }

    if (payload.chat) {
      setLocalChat(payload.chat);
    }

    const appended: AgentChatMessage[] = [];
    if (payload.user_message) appended.push(payload.user_message);
    if (payload.assistant_message) appended.push(payload.assistant_message);

    if (appended.length) {
      setLocalMessages((previous) => [...previous, ...appended]);
    } else {
      // Clear local messages before refetch to avoid duplicates
      setLocalMessages([]);
      setLocalChat(null);
      await queryClient.invalidateQueries({ queryKey: ["agent-thread", chatId, orgId] });
    }
  };

  const sendMessage = async (value?: string) => {
    const message = (value ?? draft).trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);

    try {
      try {
        await sendMessageStream(message);
      } catch {
        // Fall back to non-streaming POST
        await sendMessageFallback(message);
      }
      setDraft("");
      setSending(false);
      setStreamingText("");
      setStreamingTools([]);
    } catch (err) {
      let errMsg = String(err);
      if (err instanceof Error) {
        errMsg = err.message;
      }
      setError(errMsg);
      setSending(false);
      setStreamingText("");
      setStreamingTools([]);
    }
  };

  const mutateChat = async (action: "archive" | "restore" | "delete") => {
    setBusy(true);
    setError(null);
    const fallbackErrorMsg = isEn ? "Chat update failed." : "La actualizaci\u00f3n del chat fall\u00f3.";

    try {
      let response: Response;
      if (action === "delete") {
        response = await fetch(
          `/api/agent/chats/${encodeURIComponent(chatId)}?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "DELETE",
            headers: {
              Accept: "application/json",
            },
          }
        );
      } else {
        response = await fetch(
          `/api/agent/chats/${encodeURIComponent(chatId)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              org_id: orgId,
              action,
            }),
          }
        );
      }

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        let errorMsg = fallbackErrorMsg;
        if (payload.error) {
          errorMsg = payload.error;
        }
        setError(errorMsg);
        setBusy(false);
        return;
      }

      if (action === "delete") {
        router.push("/app/chats");
        router.refresh();
        setBusy(false);
        return;
      }

      setLocalMessages([]);
      setLocalChat(null);
      await queryClient.invalidateQueries({ queryKey: ["agent-thread", chatId, orgId] });
      router.refresh();
      setBusy(false);
    } catch (err) {
      let errMsg = String(err);
      if (err instanceof Error) {
        errMsg = err.message;
      }
      setError(errMsg);
      setBusy(false);
    }
  };

  const displayError = error ?? threadQuery.error?.message ?? null;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            {loading ? (
              <Skeleton className="h-7 w-44" />
            ) : (
              <CardTitle>{chat?.title || (isEn ? "Chat" : "Chat")}</CardTitle>
            )}
            {loading ? (
              <Skeleton className="h-4 w-64" />
            ) : (
              <CardDescription className="flex items-center gap-2">
                <Badge variant="secondary">{chat?.agent_name || "AI"}</Badge>
                <span>
                  {chat?.is_archived
                    ? isEn
                      ? "Archived"
                      : "Archivado"
                    : isEn
                      ? "Active"
                      : "Activo"}
                </span>
              </CardDescription>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => router.push("/app/chats")}
              size="sm"
              variant="outline"
            >
              {isEn ? "Back" : "Volver"}
            </Button>
            <Button
              disabled={loading || busy}
              onClick={() => {
                const action = chat?.is_archived ? "restore" : "archive";
                mutateChat(action).catch(() => undefined);
                setDeleteArmed(false);
              }}
              size="sm"
              variant="outline"
            >
              {chat?.is_archived
                ? isEn
                  ? "Restore"
                  : "Restaurar"
                : isEn
                  ? "Archive"
                  : "Archivar"}
            </Button>
            {deleteArmed ? (
              <Button
                disabled={loading || busy}
                onClick={() => setDeleteArmed(false)}
                size="sm"
                variant="outline"
              >
                {isEn ? "Cancel" : "Cancelar"}
              </Button>
            ) : null}
            <Button
              disabled={loading || busy}
              onClick={() => {
                if (!deleteArmed) {
                  setDeleteArmed(true);
                  return;
                }
                mutateChat("delete").catch(() => undefined);
                setDeleteArmed(false);
              }}
              size="sm"
              variant="destructive"
            >
              {deleteArmed
                ? isEn
                  ? "Confirm delete"
                  : "Confirmar"
                : isEn
                  ? "Delete"
                  : "Eliminar"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {displayError ? (
          <Alert variant="destructive">
            <AlertTitle>
              {isEn ? "Request failed" : "Solicitud fallida"}
            </AlertTitle>
            <AlertDescription>{displayError}</AlertDescription>
          </Alert>
        ) : null}

        <Alert variant={allowMutations ? "warning" : "info"}>
          <AlertTitle>
            {allowMutations
              ? isEn
                ? "Write mode requested"
                : "Modo escritura solicitado"
              : isEn
                ? "Read-only mode"
                : "Modo solo lectura"}
          </AlertTitle>
          <AlertDescription>
            {allowMutations
              ? isEn
                ? "Writes run only when confirmation is checked below."
                : "La escritura se ejecuta solo cuando se marca la confirmaci\u00f3n abajo."
              : isEn
                ? "The agent analyzes data without mutating records."
                : "El agente analiza datos sin modificar registros."}
          </AlertDescription>
        </Alert>

        <div className="max-h-[52vh] space-y-3 overflow-y-auto rounded-xl border bg-background/70 p-3">
          {loading ? (
            MESSAGE_SKELETON_KEYS.map((key, index) => (
              <div
                className={cn(
                  "flex",
                  index % 2 === 0 ? "justify-end" : "justify-start"
                )}
                key={key}
              >
                <Skeleton className="h-16 w-[70%] rounded-2xl" />
              </div>
            ))
          ) : messages.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/25 p-4 text-muted-foreground text-sm">
              {isEn
                ? "No messages yet. Start the conversation below."
                : "Todav\u00eda no hay mensajes. Inicia la conversaci\u00f3n abajo."}
            </div>
          ) : (
            messages.map((message) => (
              <div
                className={cn(
                  "flex",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
                key={message.id}
              >
                <div
                  className={cn(
                    "max-w-[92%] rounded-2xl border px-3 py-2",
                    message.role === "user"
                      ? "border-primary/30 bg-primary/10"
                      : "border-border/60 bg-card"
                  )}
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground uppercase tracking-wide">
                    {message.role === "user"
                      ? isEn
                        ? "You"
                        : "T\u00fa"
                      : isEn
                        ? "Agent"
                        : "Agente"}
                    {message.model_used ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] normal-case tracking-normal">
                        {message.model_used}
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                    {message.content}
                  </p>

                  {message.role === "assistant" &&
                  message.tool_trace?.length ? (
                    <Collapsible>
                      <CollapsibleTrigger className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
                        {isEn ? "Tool trace" : "Traza de herramientas"}
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-2 space-y-1 rounded-lg border bg-muted/20 p-2">
                          {message.tool_trace.map((tool) => (
                            <div
                              className="flex items-center justify-between gap-2 rounded-md bg-background/80 px-2 py-1"
                              key={`${message.id}-${tool.tool ?? "tool"}-${tool.preview ?? ""}-${String(tool.ok)}`}
                            >
                              <span className="font-mono text-[11px]">
                                {tool.tool || "tool"}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {tool.preview || (tool.ok ? "ok" : "error")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : null}
                </div>
              </div>
            ))
          )}

          {sending ? (
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl border border-border/60 bg-card px-3 py-2 space-y-2">
                {streamingTools.length > 0 ? (
                  <div className="space-y-1">
                    {streamingTools.map((tool) => (
                      <div
                        className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1 text-[11px]"
                        key={`stream-${tool.name}-${tool.preview ?? ""}-${String(tool.ok)}`}
                      >
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        <span className="font-mono">{tool.name}</span>
                        {tool.preview ? (
                          <span className="text-muted-foreground">
                            {tool.ok ? tool.preview : `error: ${tool.preview}`}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {isEn ? "running..." : "ejecutando..."}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {streamingText ? (
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                    {streamingText}
                  </p>
                ) : streamingTools.length === 0 ? (
                  <p className="text-muted-foreground text-sm flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    {isEn ? "Agent is thinking..." : "El agente est\u00e1 pensando..."}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/20 p-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              checked={allowMutations}
              onChange={(event) => {
                const checked = event.target.checked;
                setAllowMutations(checked);
                if (!checked) {
                  setConfirmWrite(false);
                }
              }}
              type="checkbox"
            />
            <span>
              {isEn ? "Enable write mode" : "Habilitar modo escritura"}
            </span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              checked={confirmWrite}
              disabled={!allowMutations}
              onChange={(event) => setConfirmWrite(event.target.checked)}
              type="checkbox"
            />
            <span>
              {isEn
                ? "Confirm write actions"
                : "Confirmar acciones de escritura"}
            </span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {quickPrompts.map((prompt) => (
            <Button
              className="h-8 rounded-full px-3 text-[12px]"
              key={prompt}
              onClick={() => {
                sendMessage(prompt).catch(() => undefined);
              }}
              size="sm"
              variant="outline"
            >
              {prompt}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <Textarea
            maxLength={4000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                sendMessage().catch(() => undefined);
              }
            }}
            placeholder={
              isEn
                ? "Ask the AI agent anything about your operations..."
                : "Pregunta al agente IA sobre tus operaciones..."
            }
            rows={4}
            value={draft}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {isEn
                ? "Send with Cmd/Ctrl + Enter"
                : "Enviar con Cmd/Ctrl + Enter"}
            </span>
            <Button
              disabled={sending || !draft.trim()}
              onClick={() => {
                sendMessage().catch(() => undefined);
              }}
            >
              {isEn ? "Send" : "Enviar"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
