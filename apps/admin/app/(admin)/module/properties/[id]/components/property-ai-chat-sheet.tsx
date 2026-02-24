"use client";

import { Loading03Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatInputBar } from "@/components/agent/chat-input-bar";
import {
  ChatMessage,
  type DisplayMessage,
} from "@/components/agent/chat-message";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ui/conversation";
import { Icon } from "@/components/ui/icon";
import { Message, MessageContent } from "@/components/ui/message";
import { Sheet } from "@/components/ui/sheet";

type PropertyAiChatSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  propertyId: string;
  propertyName: string;
  propertyCode?: string;
  propertyAddress?: string;
  occupancyRate?: number | null;
  unitCount?: number;
  isEn: boolean;
};

export function PropertyAiChatSheet({
  open,
  onOpenChange,
  orgId,
  propertyId,
  propertyName,
  propertyCode,
  propertyAddress,
  occupancyRate,
  unitCount,
  isEn,
}: PropertyAiChatSheetProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const isFirstMessageRef = useRef(true);

  // Reset chat state when sheet closes
  useEffect(() => {
    if (!open) {
      activeChatIdRef.current = null;
      isFirstMessageRef.current = true;
      setMessages([]);
      setDraft("");
      setError(null);
      setIsSending(false);
    }
  }, [open]);

  const buildContextPrefix = useCallback(() => {
    const parts = [`Property context: ${propertyName}`];
    if (propertyCode) parts[0] += ` (${propertyCode})`;
    if (propertyAddress) parts.push(propertyAddress);
    if (occupancyRate != null) parts.push(`Occupancy: ${occupancyRate}%`);
    if (unitCount != null) parts.push(`Units: ${unitCount}`);
    return `[${parts.join(", ")}]\n`;
  }, [propertyName, propertyCode, propertyAddress, occupancyRate, unitCount]);

  const ensureChatId = async (): Promise<string> => {
    if (activeChatIdRef.current) return activeChatIdRef.current;
    const res = await fetch("/api/agent/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org_id: orgId,
        agent_slug: "guest-concierge",
      }),
    });
    const payload = (await res.json()) as { id?: string; error?: string };
    if (!(res.ok && payload.id)) {
      throw new Error(
        payload.error ?? (isEn ? "Failed to create chat." : "No se pudo crear el chat.")
      );
    }
    const nextId = String(payload.id);
    activeChatIdRef.current = nextId;
    return nextId;
  };

  const handleSend = useCallback(
    async (value?: string) => {
      const rawMessage = (value ?? draft).trim();
      if (!rawMessage || isSending) return;

      setError(null);
      setDraft("");

      // Inject property context into first message
      let messageToSend = rawMessage;
      if (isFirstMessageRef.current) {
        messageToSend = buildContextPrefix() + rawMessage;
        isFirstMessageRef.current = false;
      }

      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: rawMessage,
        source: "live",
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsSending(true);

      try {
        const chatId = await ensureChatId();

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
              (isEn ? "Request failed." : "La solicitud falló.")
          );
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response stream.");

        const decoder = new TextDecoder();
        let buffer = "";
        let assistantContent = "";
        const assistantId = `assistant-${Date.now()}`;

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
              if (parsed.type === "text-delta" || parsed.type === "text") {
                const delta =
                  typeof parsed.textDelta === "string"
                    ? parsed.textDelta
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
                        source: "live",
                      },
                    ];
                  });
                }
              }
            } catch {
              // skip non-JSON lines
            }
          }
        }

        if (assistantContent) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: assistantContent } : m
            )
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSending(false);
      }
    },
    [draft, isSending, isEn, orgId, buildContextPrefix]
  );

  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <Sheet
      description={
        isEn
          ? `Chat with AI about ${propertyName}`
          : `Chatea con IA sobre ${propertyName}`
      }
      onOpenChange={onOpenChange}
      open={open}
      side="right"
      title={
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" icon={SparklesIcon} />
          {isEn ? "AI Assistant" : "Asistente IA"}
        </span>
      }
    >
      <div className="flex h-full flex-col -mx-6 -my-5">
        <Conversation className="flex-1 p-0">
          <ConversationContent className="flex flex-col space-y-4 p-4">
            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {messages.length === 0 && !isSending && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-casaora-gradient text-white shadow-casaora">
                  <Icon className="h-4 w-4" icon={SparklesIcon} />
                </div>
                <p className="max-w-[240px] text-xs text-muted-foreground">
                  {isEn
                    ? `Ask anything about ${propertyName}. The AI has your property context.`
                    : `Pregunta lo que sea sobre ${propertyName}. La IA tiene el contexto de tu propiedad.`}
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <ChatMessage
                isEn={isEn}
                isSending={isSending}
                key={msg.id}
                message={msg}
                onCopy={handleCopy}
                onEdit={() => {}}
                onRetry={() => {}}
              />
            ))}

            {isSending && (
              <Message className="items-start py-3" from="assistant">
                <div className="relative mt-0.5">
                  <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-casaora-gradient text-white shadow-casaora">
                    <Icon className="h-3.5 w-3.5 animate-spin" icon={Loading03Icon} />
                  </div>
                </div>
                <MessageContent variant="flat">
                  <p className="flex items-center gap-2.5 text-[13px] text-muted-foreground/60">
                    <span className="flex gap-1">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sidebar-primary)]/60" style={{ animationDelay: "0ms" }} />
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sidebar-primary)]/60" style={{ animationDelay: "150ms" }} />
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--sidebar-primary)]/60" style={{ animationDelay: "300ms" }} />
                    </span>
                    {isEn ? "Thinking" : "Pensando"}
                  </p>
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="border-t border-border/40 px-2 py-2">
          <ChatInputBar
            agentName={isEn ? "AI Assistant" : "Asistente IA"}
            attachments={[]}
            attachmentsReady
            draft={draft}
            editingSourceId={null}
            isEmbedded
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
      </div>
    </Sheet>
  );
}
