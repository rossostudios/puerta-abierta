"use client";

import { SparklesIcon } from "@hugeicons/core-free-icons";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { authedFetch } from "@/lib/api-client";

type MessageItem = {
  direction?: string;
  body?: string | null;
  channel?: string;
};

type AiComposeAssistProps = {
  orgId: string;
  conversation: MessageItem[];
  channel: string;
  guestName: string;
  isEn: boolean;
  onDraftAccepted: (text: string) => void;
};

export function AiComposeAssist({
  orgId,
  conversation,
  channel,
  guestName,
  isEn,
  onDraftAccepted,
}: AiComposeAssistProps) {
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAsk = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDraft(null);

    const preparedMessages = conversation
      .filter((m) => m.body)
      .map((m) => {
        const bodyVal = m.body;
        const role = m.direction === "outbound" ? "assistant" : "user";
        const content = bodyVal != null ? bodyVal : "";
        return { role, content };
      });

    const noDraftMsg = isEn ? "No draft generated." : "No se generó borrador.";
    const fallbackErrMsg = isEn
      ? "AI request failed."
      : "Error en la solicitud de IA.";

    const draftPrompt = isEn
      ? `Draft a concise and professional ${channel} reply for guest ${guestName}. Use the conversation context and return only the reply body.`
      : `Redacta una respuesta breve y profesional por ${channel} para el huesped ${guestName}. Usa el contexto de la conversacion y devuelve solo el texto de respuesta.`;

    let chatId = "";
    try {
      const chat = await authedFetch<{ id?: string }>("/agent/chats", {
        method: "POST",
        body: JSON.stringify({
          org_id: orgId,
          agent_slug: "guest-concierge",
          title: isEn ? "AI Compose Assist" : "Asistente de Redacción IA",
        }),
      });
      chatId = typeof chat.id === "string" ? chat.id : "";
      if (!chatId) {
        throw new Error(fallbackErrMsg);
      }

      const transcript = preparedMessages
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n");
      const runtimeMessage = `${draftPrompt}\n\nConversation context:\n${transcript}`;

      const result = await authedFetch<{
        assistant_message?: { content?: string };
        reply?: string;
      }>(
        `/agent/chats/${encodeURIComponent(chatId)}/messages?org_id=${encodeURIComponent(orgId)}`,
        {
          method: "POST",
          body: JSON.stringify({
            message: runtimeMessage,
            allow_mutations: false,
            confirm_write: false,
          }),
        }
      );

      const text = result.assistant_message?.content ?? result.reply ?? "";
      if (text) {
        setDraft(text);
      } else {
        setError(noDraftMsg);
      }
    } catch (err) {
      let msg = fallbackErrMsg;
      if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      if (chatId) {
        authedFetch(
          `/agent/chats/${encodeURIComponent(chatId)}/archive?org_id=${encodeURIComponent(orgId)}`,
          { method: "POST" }
        ).catch(() => {
          /* swallow */
        });
      }
      setLoading(false);
    }
  }, [orgId, conversation, channel, guestName, isEn]);

  // Not showing anything, just the button and draft
  if (draft) {
    return (
      <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-center gap-1.5">
          <Icon className="text-primary" icon={SparklesIcon} size={13} />
          <span className="font-medium text-primary text-xs">
            {isEn ? "AI Draft" : "Borrador IA"}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-[13px] text-foreground leading-relaxed">
          {draft}
        </p>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              onDraftAccepted(draft);
              setDraft(null);
            }}
            size="sm"
            type="button"
          >
            {isEn ? "Use draft" : "Usar borrador"}
          </Button>
          <Button
            onClick={() => setDraft(null)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {isEn ? "Discard" : "Descartar"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        className="gap-1.5"
        disabled={loading}
        onClick={handleAsk}
        size="sm"
        type="button"
        variant="outline"
      >
        <Icon icon={SparklesIcon} size={13} />
        {loading
          ? isEn
            ? "Thinking..."
            : "Pensando..."
          : isEn
            ? "Ask AI"
            : "Pedir a IA"}
      </Button>
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}
