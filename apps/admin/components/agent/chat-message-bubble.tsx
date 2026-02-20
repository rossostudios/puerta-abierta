"use client";

import {
  Copy01Icon,
  Edit02Icon,
  Refresh01Icon,
  SparklesIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { useCallback, useState } from "react";
import {
  ToolTraceBadges,
  type ToolTraceEntry,
} from "@/components/agent/chat-tool-event";
import { MarkdownMessage } from "@/components/agent/markdown-message";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model_used?: string | null;
  tool_trace?: ToolTraceEntry[] | null;
  source: "server" | "live";
};

export function ChatMessageBubble({
  message,
  isEn,
  isSending,
  onCopy,
  onRetry,
  onEdit,
  onSpeak,
}: {
  message: DisplayMessage;
  isEn: boolean;
  isSending: boolean;
  onCopy: (content: string) => void;
  onRetry: (messageId: string) => void;
  onEdit: (messageId: string, content: string) => void;
  onSpeak?: (content: string) => void;
}) {
  const [traceExpanded, setTraceExpanded] = useState(false);

  const isUser = message.role === "user";

  const handleCopy = useCallback(() => {
    onCopy(message.content);
  }, [message.content, onCopy]);

  return (
    <div
      className={cn(
        "group flex gap-3",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {isUser ? null : (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--sidebar-primary)] to-[var(--sidebar-primary)]/70 text-white">
          <Icon className="h-3.5 w-3.5" icon={SparklesIcon} />
        </div>
      )}

      <div
        className={cn(
          "relative max-w-[85%] sm:max-w-[80%]",
          isUser
            ? "rounded-2xl rounded-br-md border border-primary/20 bg-primary/8 px-4 py-3"
            : "min-w-0 px-0 py-1"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed">
            {message.content}
          </p>
        ) : (
          <MarkdownMessage content={message.content} />
        )}

        {!isUser && message.tool_trace?.length ? (
          <ToolTraceBadges
            isExpanded={traceExpanded}
            onToggle={() => setTraceExpanded((prev) => !prev)}
            trace={message.tool_trace}
          />
        ) : null}

        {!isUser && message.model_used ? (
          <div className="mt-2">
            <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {message.model_used}
            </span>
          </div>
        ) : null}

        <div
          className={cn(
            "mt-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
          )}
        >
          <Button
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={handleCopy}
            size="icon"
            variant="ghost"
          >
            <Icon className="h-3.5 w-3.5" icon={Copy01Icon} />
            <span className="sr-only">{isEn ? "Copy" : "Copiar"}</span>
          </Button>

          {isUser ? (
            <Button
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              disabled={isSending}
              onClick={() => onEdit(message.id, message.content)}
              size="icon"
              variant="ghost"
            >
              <Icon className="h-3.5 w-3.5" icon={Edit02Icon} />
              <span className="sr-only">
                {isEn ? "Edit & resend" : "Editar y reenviar"}
              </span>
            </Button>
          ) : (
            <>
              <Button
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                disabled={isSending}
                onClick={() => onRetry(message.id)}
                size="icon"
                variant="ghost"
              >
                <Icon className="h-3.5 w-3.5" icon={Refresh01Icon} />
                <span className="sr-only">{isEn ? "Retry" : "Reintentar"}</span>
              </Button>

              {onSpeak ? (
                <Button
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => onSpeak(message.content)}
                  size="icon"
                  variant="ghost"
                >
                  <Icon className="h-3.5 w-3.5" icon={VolumeHighIcon} />
                  <span className="sr-only">
                    {isEn ? "Listen" : "Escuchar"}
                  </span>
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
