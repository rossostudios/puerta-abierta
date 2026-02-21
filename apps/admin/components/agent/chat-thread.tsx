"use client";

import { useChat } from "@ai-sdk/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type DataUIPart,
  DefaultChatTransport,
  isTextUIPart,
  type UIDataTypes,
  type UIMessage,
} from "ai";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatEmptyState } from "@/components/agent/chat-empty-state";
import { ChatHeader } from "@/components/agent/chat-header";
import { ChatInputBar } from "@/components/agent/chat-input-bar";
import {
  ChatMessageBubble,
  type DisplayMessage,
} from "@/components/agent/chat-message-bubble";
import {
  fetchThread,
  MESSAGE_SKELETON_KEYS,
  normalizeChat,
  type ThreadData,
  ZOEY_PROMPTS,
} from "@/components/agent/chat-thread-types";
import {
  ChatToolEventStrip,
  type StreamToolEvent,
} from "@/components/agent/chat-tool-event";
import { useChatAttachments } from "@/components/agent/use-chat-attachments";
import { useVoiceChat } from "@/components/agent/use-voice-chat";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  AgentChatMessage,
  AgentChatSummary,
  AgentModelOption,
} from "@/lib/api";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type StreamMeta = {
  model_used?: string | null;
  fallback_used?: boolean;
  tool_trace?: AgentChatMessage["tool_trace"];
};

const BACKEND_AGENT_SLUG = "guest-concierge";

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

function extractUiMessageText(message: UIMessage | undefined): string {
  if (!message) return "";
  const chunks: string[] = [];
  for (const part of message.parts) {
    if (!isTextUIPart(part)) continue;
    const text = part.text.trim();
    if (text) chunks.push(text);
  }
  return chunks.join("").trim();
}

function findLastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row.role !== "user") continue;
    const text = extractUiMessageText(row);
    if (text) return text;
  }
  return "";
}

// ---------------------------------------------------------------------------
// ChatThread — orchestrator
// ---------------------------------------------------------------------------

export function ChatThread({
  orgId,
  locale,
  chatId,
  mode = "full",
  freshKey,
}: {
  orgId: string;
  locale: Locale;
  chatId?: string;
  defaultAgentSlug?: string;
  mode?: "full" | "embedded";
  freshKey?: string;
}) {
  const isEn = locale === "en-US";
  const isEmbedded = mode === "embedded";
  const isChatDetailRoute = Boolean(chatId);
  const router = useRouter();
  const queryClient = useQueryClient();

  // --- state ---------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | undefined>(chatId);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelBusy, setModelBusy] = useState(false);
  const [localChat, setLocalChat] = useState<AgentChatSummary | null>(null);
  const [streamToolEvents, setStreamToolEvents] = useState<StreamToolEvent[]>(
    []
  );
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [streamMetaByMessageId, setStreamMetaByMessageId] = useState<
    Record<string, StreamMeta>
  >({});

  const activeChatIdRef = useRef<string | undefined>(chatId);
  const pendingSendRef = useRef<{
    chatId: string;
    message: string;
    fallbackAttempted: boolean;
  } | null>(null);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  // --- queries -------------------------------------------------------------
  const threadQuery = useQuery<ThreadData, Error>({
    queryKey: ["agent-thread", activeChatId, orgId],
    queryFn: () => {
      if (!activeChatId)
        throw new Error(isEn ? "Missing chat id." : "Falta id de chat.");
      return fetchThread(activeChatId, orgId);
    },
    enabled: !!activeChatId,
  });

  // Model options — fail silently (no error banners)
  const modelOptionsQuery = useQuery<AgentModelOption[], Error>({
    queryKey: ["agent-model-options", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/models?org_id=${encodeURIComponent(orgId)}`,
        {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        }
      );
      const payload = (await res.json()) as unknown;
      if (!res.ok) return [];
      return normalizeModels(payload);
    },
    staleTime: 60_000,
    enabled: !!orgId,
    retry: false,
  });

  // --- voice chat ----------------------------------------------------------
  const handleVoiceSend = useCallback((text: string) => {
    if (!text.trim()) return;
    setDraft("");
    handleSendRef.current(text);
  }, []);

  const voice = useVoiceChat(handleVoiceSend);

  // --- attachments ---------------------------------------------------------
  const attachmentHook = useChatAttachments(orgId, isEn);

  // --- transport + chat hook -----------------------------------------------
  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/agent/chats/pending/messages/stream",
        prepareSendMessagesRequest: ({
          messages,
          body,
          headers,
          credentials,
        }) => {
          const cid = activeChatIdRef.current;
          if (!cid)
            throw new Error(isEn ? "Missing chat id." : "Falta id de chat.");
          const text = findLastUserText(messages);
          if (!text)
            throw new Error(
              isEn ? "Missing message content." : "Falta contenido del mensaje."
            );
          return {
            api: `/api/agent/chats/${encodeURIComponent(cid)}/messages/stream?org_id=${encodeURIComponent(orgId)}`,
            headers,
            credentials,
            body: { ...(body ?? {}), org_id: orgId, message: text },
          };
        },
      }),
    [isEn, orgId]
  );

  const {
    messages: liveMessages,
    sendMessage,
    stop,
    setMessages: setLiveMessages,
    status,
    error: chatError,
    clearError,
  } = useChat<UIMessage>({
    id: activeChatId ? `agent-${activeChatId}` : "agent-draft-zoey",
    transport,
    onData: (part: DataUIPart<UIDataTypes>) => {
      const typed = part as { type: string; data?: unknown };
      if (typed.type === "data-casaora-status") {
        if (typed.data && typeof typed.data === "object") {
          const msg = (typed.data as { message?: unknown }).message;
          if (typeof msg === "string" && msg.trim())
            setStreamStatus(msg.trim());
        }
        return;
      }
      if (typed.type === "data-casaora-tool") {
        if (typed.data && typeof typed.data === "object") {
          const d = typed.data as {
            phase?: unknown;
            tool_name?: unknown;
            tool_call_id?: unknown;
            ok?: unknown;
            preview?: unknown;
          };
          setStreamToolEvents((prev) => [
            ...prev,
            {
              phase: d.phase === "result" ? "result" : "call",
              tool_name:
                typeof d.tool_name === "string" && d.tool_name.trim()
                  ? d.tool_name.trim()
                  : "tool",
              tool_call_id:
                typeof d.tool_call_id === "string" && d.tool_call_id.trim()
                  ? d.tool_call_id.trim()
                  : `tool-${Date.now()}`,
              ok: typeof d.ok === "boolean" ? d.ok : undefined,
              preview: typeof d.preview === "string" ? d.preview : undefined,
            },
          ]);
        }
        return;
      }
      if (
        typed.type === "data-casaora-meta" &&
        typed.data &&
        typeof typed.data === "object"
      ) {
        const d = typed.data as {
          messageId?: unknown;
          model_used?: unknown;
          fallback_used?: unknown;
          tool_trace?: unknown;
        };
        const mid = typeof d.messageId === "string" ? d.messageId : "";
        if (!mid) return;
        setStreamMetaByMessageId((prev) => ({
          ...prev,
          [mid]: {
            model_used: typeof d.model_used === "string" ? d.model_used : null,
            fallback_used:
              typeof d.fallback_used === "boolean" ? d.fallback_used : false,
            tool_trace: Array.isArray(d.tool_trace)
              ? (d.tool_trace as AgentChatMessage["tool_trace"])
              : [],
          },
        }));
      }
    },
    onFinish: () => {
      pendingSendRef.current = null;
      const current = activeChatIdRef.current;
      if (!current) return;
      const sync = async () => {
        await queryClient.invalidateQueries({
          queryKey: ["agent-thread", current, orgId],
        });
        await queryClient.invalidateQueries({
          queryKey: ["agent-chats", orgId],
        });
        await queryClient.invalidateQueries({
          queryKey: ["sidebar-chat-data", orgId],
        });
        setLiveMessages([]);
        setStreamToolEvents([]);
        setStreamStatus(null);
        setStreamMetaByMessageId({});
        setLocalChat(null);
      };
      sync().catch(() => undefined);
    },
    onError: (incomingError) => {
      const pending = pendingSendRef.current;
      if (!pending || pending.fallbackAttempted) {
        setError(incomingError.message);
        return;
      }
      pending.fallbackAttempted = true;
      const runFallback = async () => {
        try {
          await sendMessageFallback(pending.chatId, pending.message);
          pendingSendRef.current = null;
          clearError();
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      };
      runFallback().catch(() => undefined);
    },
  });

  // --- derived data --------------------------------------------------------
  const modelOptions = modelOptionsQuery.data ?? [];
  const primaryModel =
    modelOptions.find((i) => i.is_primary)?.model ??
    modelOptions[0]?.model ??
    "";
  const chat = localChat ?? threadQuery.data?.chat ?? null;
  const serverMessages = threadQuery.data?.messages ?? [];
  const loading = !!activeChatId && threadQuery.isLoading;
  const isSending = status === "submitted" || status === "streaming";

  // --- model preference ----------------------------------------------------
  const updatePreferredModel = useCallback(
    async (nextModel: string) => {
      setSelectedModel(nextModel);
      const cid = activeChatIdRef.current;
      if (!cid) return;
      setModelBusy(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/agent/chats/${encodeURIComponent(cid)}/preferences`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ org_id: orgId, preferred_model: nextModel }),
          }
        );
        const payload = (await res.json()) as {
          error?: string;
          chat?: unknown;
        };
        if (!res.ok)
          throw new Error(
            payload.error ||
              (isEn
                ? "Could not update model preference."
                : "No se pudo actualizar el modelo.")
          );
        const normalized = normalizeChat(payload.chat);
        if (normalized) setLocalChat(normalized);
        await queryClient.invalidateQueries({
          queryKey: ["agent-thread", cid, orgId],
        });
        await queryClient.invalidateQueries({
          queryKey: ["agent-chats", orgId],
        });
        await queryClient.invalidateQueries({
          queryKey: ["sidebar-chat-data", orgId],
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setModelBusy(false);
      }
    },
    [isEn, orgId, queryClient]
  );

  // --- sync effects --------------------------------------------------------
  useEffect(() => {
    setActiveChatId(chatId);
    activeChatIdRef.current = chatId;
    setDeleteArmed(false);
    setError(null);
    setDraft("");
    setEditingSourceId(null);
    setLiveMessages([]);
    setStreamToolEvents([]);
    setStreamStatus(null);
    setStreamMetaByMessageId({});
    setLocalChat(null);
  }, [chatId, setLiveMessages]);

  useEffect(() => {
    if (!freshKey || isChatDetailRoute) return;
    setActiveChatId(undefined);
    activeChatIdRef.current = undefined;
    setDeleteArmed(false);
    setError(null);
    setDraft("");
    setEditingSourceId(null);
    setLiveMessages([]);
    setStreamToolEvents([]);
    setStreamStatus(null);
    setStreamMetaByMessageId({});
    setLocalChat(null);
  }, [freshKey, isChatDetailRoute, setLiveMessages]);

  useEffect(() => {
    const preferred = chat?.preferred_model?.trim();
    if (preferred) {
      setSelectedModel(preferred);
      return;
    }
    if (activeChatId && primaryModel && selectedModel !== primaryModel) {
      setSelectedModel(primaryModel);
      return;
    }
    if (!selectedModel && primaryModel) setSelectedModel(primaryModel);
  }, [activeChatId, chat?.preferred_model, primaryModel, selectedModel]);

  useEffect(() => {
    if (!(selectedModel && modelOptions.length && primaryModel)) return;
    if (modelOptions.some((o) => o.model === selectedModel)) return;
    setSelectedModel(primaryModel);
    const cid = activeChatIdRef.current;
    if (cid) updatePreferredModel(primaryModel).catch(() => undefined);
  }, [modelOptions, primaryModel, selectedModel, updatePreferredModel]);

  // --- display messages ----------------------------------------------------
  const serverDisplayMessages = useMemo<DisplayMessage[]>(
    () =>
      serverMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model_used: m.model_used ?? null,
        tool_trace: m.tool_trace,
        source: "server",
      })),
    [serverMessages]
  );

  const liveDisplayMessages = useMemo<DisplayMessage[]>(() => {
    const next: DisplayMessage[] = [];
    for (const m of liveMessages) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      const content = extractUiMessageText(m);
      if (!content && m.role === "assistant") continue;
      next.push({
        id: m.id,
        role: m.role,
        content,
        model_used: streamMetaByMessageId[m.id]?.model_used ?? null,
        tool_trace: streamMetaByMessageId[m.id]?.tool_trace,
        source: "live",
      });
    }
    return next;
  }, [liveMessages, streamMetaByMessageId]);

  const displayMessages = useMemo<DisplayMessage[]>(() => {
    const ids = new Set(serverDisplayMessages.map((i) => i.id));
    return [
      ...serverDisplayMessages,
      ...liveDisplayMessages.filter((i) => !ids.has(i.id)),
    ];
  }, [liveDisplayMessages, serverDisplayMessages]);

  // --- auto-speak for voice mode -------------------------------------------
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!voice.voiceModeActive) return;
    const lastAssistant = [...displayMessages]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant || lastAssistant.id === lastSpokenRef.current) return;
    if (isSending) return; // wait until message is complete
    lastSpokenRef.current = lastAssistant.id;
    voice.speak(lastAssistant.content);
  }, [displayMessages, isSending, voice]);

  // --- auto-scroll ---------------------------------------------------------
  useEffect(() => {
    const vp = messageViewportRef.current;
    if (!vp) return;
    if (
      displayMessages.length > 0 ||
      isSending ||
      streamToolEvents.length > 0 ||
      streamStatus
    ) {
      vp.scrollTop = vp.scrollHeight;
    }
  }, [
    displayMessages.length,
    isSending,
    streamStatus,
    streamToolEvents.length,
  ]);

  // --- quick prompts -------------------------------------------------------
  const quickPrompts = ZOEY_PROMPTS[locale];

  // --- actions -------------------------------------------------------------
  const ensureChatId = async (): Promise<string> => {
    if (activeChatIdRef.current) return activeChatIdRef.current;
    const res = await fetch("/api/agent/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org_id: orgId,
        agent_slug: BACKEND_AGENT_SLUG,
        preferred_model: selectedModel || null,
      }),
    });
    const payload = (await res.json()) as { id?: string; error?: string };
    if (!(res.ok && payload.id))
      throw new Error(
        payload.error ||
          (isEn ? "Failed to create chat." : "No se pudo crear el chat.")
      );
    const nextId = String(payload.id);
    activeChatIdRef.current = nextId;
    setActiveChatId(nextId);
    const normalized = normalizeChat(payload);
    if (normalized) setLocalChat(normalized);
    return nextId;
  };

  const sendMessageFallback = async (targetChatId: string, message: string) => {
    const res = await fetch(
      `/api/agent/chats/${encodeURIComponent(targetChatId)}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ org_id: orgId, message }),
      }
    );
    const payload = (await res.json()) as { error?: string };
    if (!res.ok)
      throw new Error(
        payload.error ||
          (isEn ? "Message failed to send." : "No se pudo enviar el mensaje.")
      );
    await queryClient.invalidateQueries({
      queryKey: ["agent-thread", targetChatId, orgId],
    });
    await queryClient.invalidateQueries({ queryKey: ["agent-chats", orgId] });
    await queryClient.invalidateQueries({
      queryKey: ["sidebar-chat-data", orgId],
    });
    setLiveMessages([]);
    setStreamToolEvents([]);
    setStreamStatus(null);
    setStreamMetaByMessageId({});
    setLocalChat(null);
  };

  const handleSend = async (value?: string) => {
    const message = (value ?? draft).trim();
    if (!message || isSending) return;

    // Include attachment URLs if any
    let fullMessage = message;
    const urls = attachmentHook.getReadyUrls();
    if (urls.length > 0) {
      fullMessage = `${message}\n\n[Attachments]\n${urls.join("\n")}`;
    }

    setError(null);
    clearError();
    try {
      const finalChatId = await ensureChatId();
      pendingSendRef.current = {
        chatId: finalChatId,
        message: fullMessage,
        fallbackAttempted: false,
      };
      setDraft("");
      setEditingSourceId(null);
      setStreamToolEvents([]);
      setStreamStatus(null);
      attachmentHook.clearAttachments();
      await sendMessage({ text: fullMessage });
    } catch (err) {
      const fb = pendingSendRef.current;
      if (fb && !fb.fallbackAttempted) {
        fb.fallbackAttempted = true;
        try {
          await sendMessageFallback(fb.chatId, fb.message);
          pendingSendRef.current = null;
          return;
        } catch (fe) {
          setError(fe instanceof Error ? fe.message : String(fe));
          return;
        }
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Stable ref for voice callback
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  const handleRetryAssistant = async (messageId: string) => {
    if (isSending) return;
    const idx = displayMessages.findIndex((m) => m.id === messageId);
    if (idx <= 0) return;
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (displayMessages[i].role === "user") {
        await handleSend(displayMessages[i].content);
        return;
      }
    }
  };

  const handleCopyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      /* ignore */
    }
  };

  const resetToFreshThread = () => {
    setActiveChatId(undefined);
    activeChatIdRef.current = undefined;
    setDeleteArmed(false);
    setError(null);
    setDraft("");
    setEditingSourceId(null);
    setLocalChat(null);
    setLiveMessages([]);
    setStreamToolEvents([]);
    setStreamStatus(null);
    setStreamMetaByMessageId({});
    attachmentHook.clearAttachments();
    if (primaryModel) setSelectedModel(primaryModel);
  };

  const mutateChat = async (action: "archive" | "restore" | "delete") => {
    if (!activeChatIdRef.current) return;
    const cid = activeChatIdRef.current;
    setBusy(true);
    setError(null);
    const fallbackMsg = isEn
      ? "Chat update failed."
      : "La actualización del chat falló.";
    try {
      let res: Response;
      if (action === "delete") {
        res = await fetch(
          `/api/agent/chats/${encodeURIComponent(cid)}?org_id=${encodeURIComponent(orgId)}`,
          { method: "DELETE", headers: { Accept: "application/json" } }
        );
      } else {
        res = await fetch(`/api/agent/chats/${encodeURIComponent(cid)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ org_id: orgId, action }),
        });
      }
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(payload.error || fallbackMsg);
        setBusy(false);
        return;
      }
      if (action === "delete") {
        setBusy(false);
        if (isChatDetailRoute) {
          router.push("/app/chats");
          router.refresh();
          return;
        }
        resetToFreshThread();
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: ["agent-thread", cid, orgId],
      });
      await queryClient.invalidateQueries({ queryKey: ["agent-chats", orgId] });
      await queryClient.invalidateQueries({
        queryKey: ["sidebar-chat-data", orgId],
      });
      setBusy(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const displayError =
    error ?? threadQuery.error?.message ?? chatError?.message ?? null;

  // --- render --------------------------------------------------------------
  return (
    <div
      className={cn(
        "relative flex h-full flex-col",
        isEmbedded
          ? "glass-surface min-h-[38rem] overflow-hidden rounded-3xl shadow-[0_24px_60px_-40px_hsl(var(--foreground)/0.65)]"
          : "min-h-[calc(100vh-4rem)] bg-background"
      )}
    >
      {/* Header */}
      <ChatHeader
        busy={busy}
        chatTitle={chat?.title}
        deleteArmed={deleteArmed}
        isArchived={chat?.is_archived}
        isChatDetailRoute={isChatDetailRoute}
        isEmbedded={isEmbedded}
        isEn={isEn}
        isSending={isSending}
        loading={loading}
        modelBusy={modelBusy}
        modelOptions={modelOptions}
        onArchiveToggle={() => {
          const action = chat?.is_archived ? "restore" : "archive";
          mutateChat(action).catch(() => undefined);
          setDeleteArmed(false);
        }}
        onDeleteArm={() => setDeleteArmed(true)}
        onDeleteCancel={() => setDeleteArmed(false)}
        onDeleteConfirm={() => {
          mutateChat("delete").catch(() => undefined);
          setDeleteArmed(false);
        }}
        onHistoryClick={() => router.push("/app/chats")}
        onModelChange={(model) =>
          updatePreferredModel(model).catch(() => undefined)
        }
        onNewThread={() => resetToFreshThread()}
        primaryModel={primaryModel}
        selectedModel={selectedModel}
      />

      {/* Message area */}
      <div
        className={cn(
          "flex-1 overflow-y-auto p-4 pb-48 sm:p-6",
          isEmbedded ? "pb-52" : ""
        )}
        ref={messageViewportRef}
      >
        <div
          className={cn(
            "mx-auto flex flex-col space-y-5",
            isEmbedded ? "max-w-4xl" : "max-w-3xl"
          )}
        >
          {/* Error — only real errors, no agent/model banners */}
          {displayError ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{displayError}</AlertDescription>
            </Alert>
          ) : null}

          {/* Body */}
          {loading ? (
            MESSAGE_SKELETON_KEYS.map((key, i) => (
              <div
                className={cn(
                  "flex",
                  i % 2 === 0 ? "justify-end" : "justify-start"
                )}
                key={key}
              >
                <Skeleton className="h-16 w-[70%] rounded-2xl" />
              </div>
            ))
          ) : displayMessages.length === 0 ? (
            <ChatEmptyState
              disabled={isSending}
              isEn={isEn}
              onSendPrompt={(prompt) => {
                handleSend(prompt).catch(() => undefined);
              }}
              quickPrompts={quickPrompts}
            />
          ) : (
            displayMessages.map((msg) => (
              <ChatMessageBubble
                isEn={isEn}
                isSending={isSending}
                key={msg.id}
                message={msg}
                onCopy={(content) => {
                  handleCopyMessage(content).catch(() => undefined);
                }}
                onEdit={(_, content) => {
                  setDraft(content);
                  setEditingSourceId(msg.id);
                }}
                onRetry={(id) => {
                  handleRetryAssistant(id).catch(() => undefined);
                }}
                onSpeak={
                  voice.isSupported
                    ? (content) => voice.speak(content)
                    : undefined
                }
              />
            ))
          )}

          {/* Streaming indicator */}
          {isSending ? (
            <div className="flex gap-3">
              <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--sidebar-primary)] to-[var(--sidebar-primary)]/70 text-white">
                <Icon
                  className="h-3.5 w-3.5 animate-spin"
                  icon={Loading03Icon}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-2 py-1">
                {streamStatus ? (
                  <p className="text-[12px] text-muted-foreground">
                    {streamStatus}
                  </p>
                ) : null}

                {streamToolEvents.length > 0 ? (
                  <ChatToolEventStrip events={streamToolEvents} isEn={isEn} />
                ) : null}

                {streamToolEvents.length === 0 && !streamStatus ? (
                  <p className="flex items-center gap-2 text-muted-foreground text-sm">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sidebar-primary)]" />
                    {isEn ? "Thinking..." : "Pensando..."}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Input bar */}
      <ChatInputBar
        attachments={attachmentHook.attachments}
        attachmentsReady={attachmentHook.allReady}
        draft={draft}
        editingSourceId={editingSourceId}
        isEmbedded={isEmbedded}
        isEn={isEn}
        isListening={voice.isListening}
        isSending={isSending}
        onAddFiles={(files) => attachmentHook.addFiles(files)}
        onCancelEdit={() => setEditingSourceId(null)}
        onDraftChange={setDraft}
        onRemoveAttachment={attachmentHook.removeAttachment}
        onSend={(value) => {
          handleSend(value).catch(() => undefined);
        }}
        onStop={() => stop()}
        onToggleVoice={voice.toggleVoiceMode}
        voiceModeActive={voice.voiceModeActive}
        voiceSupported={voice.isSupported}
        voiceTranscript={voice.transcript}
      />
    </div>
  );
}
