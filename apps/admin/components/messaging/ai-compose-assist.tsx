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

    try {
      const messages = conversation
        .filter((m) => m.body)
        .map((m) => ({
          role: m.direction === "outbound" ? "assistant" : "user",
          content: m.body ?? "",
        }));

      const result = await authedFetch<{ reply?: string; message?: string }>(
        "/agent/chat",
        {
          method: "POST",
          body: JSON.stringify({
            org_id: orgId,
            messages,
            context: {
              channel,
              guest_name: guestName,
            },
          }),
        }
      );

      const text = result.reply || result.message || "";
      if (text) {
        setDraft(text);
      } else {
        setError(isEn ? "No draft generated." : "No se generó borrador.");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isEn
            ? "AI request failed."
            : "Error en la solicitud de IA."
      );
    } finally {
      setLoading(false);
    }
  }, [orgId, conversation, channel, guestName, isEn]);

  // Not showing anything, just the button and draft
  if (draft) {
    return (
      <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-center gap-1.5">
          <Icon className="text-primary" icon={SparklesIcon} size={13} />
          <span className="text-xs font-medium text-primary">
            {isEn ? "AI Draft" : "Borrador IA"}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
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
      {error && (
        <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  );
}
