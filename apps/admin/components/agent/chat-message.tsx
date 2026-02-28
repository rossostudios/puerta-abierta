"use client";

import {
  Copy01Icon,
  Edit02Icon,
  Refresh01Icon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons";
import { useCallback, useState } from "react";
import {
  ActionCard,
  type StructuredContent,
} from "@/components/agent/action-card";
import {
  ToolTraceBadges,
  type ToolTraceEntry,
} from "@/components/agent/chat-tool-event";
import {
  ExplainabilityPanel,
  type ExplanationPayload,
} from "@/components/agent/explainability-panel";
import { getModelDisplayName } from "@/components/agent/model-display";
import { QuickReplyChips } from "@/components/agent/quick-reply-chips";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Message, MessageContent } from "@/components/ui/message";
import { Response } from "@/components/ui/response";
import { cn } from "@/lib/utils";

export type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model_used?: string | null;
  tool_trace?: ToolTraceEntry[] | null;
  feedback_rating?: "positive" | "negative" | null;
  structured_content?: StructuredContent | null;
  explanation?: ExplanationPayload | null;
  feedbackConfirmed?: boolean;
  source: "server" | "live";
};

const FEEDBACK_REASONS = [
  "Too formal",
  "Wrong facts",
  "Too long",
  "Missed context",
  "Other",
] as const;

export function ChatMessage({
  message,
  isEn,
  isSending,
  onCopy,
  onRetry,
  onEdit,
  onSpeak,
  onFeedback,
  onRegenerate,
  onActionCard,
  onQuickReply,
}: {
  message: DisplayMessage;
  isEn: boolean;
  isSending: boolean;
  onCopy: (content: string) => void;
  onRetry: (messageId: string) => void;
  onEdit: (messageId: string, content: string) => void;
  onSpeak?: (content: string) => void;
  onFeedback?: (
    messageId: string,
    rating: "positive" | "negative",
    reason?: string
  ) => void;
  onRegenerate?: (messageId: string) => void;
  onActionCard?: (messageId: string, actionKey: string) => void;
  onQuickReply?: (suggestion: string) => void;
}) {
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const isUser = message.role === "user";

  const handleCopy = useCallback(() => {
    onCopy(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [message.content, onCopy]);

  const handleThumbsDown = useCallback(() => {
    if (!onFeedback) return;
    onFeedback(message.id, "negative");
    setShowReasons(true);
  }, [message.id, onFeedback]);

  const handleReasonSelect = useCallback(
    (reason: string) => {
      if (!onFeedback) return;
      onFeedback(message.id, "negative", reason);
      setShowReasons(false);
    },
    [message.id, onFeedback]
  );

  return (
    <Message
      className={cn(
        "animate-[fadeInUp_0.3s_ease-out_both] py-3",
        isUser ? "" : "items-start"
      )}
      from={message.role}
    >
      {isUser ? null : (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-casaora-gradient text-white shadow-casaora">
          <Icon className="h-3.5 w-3.5" icon={SparklesIcon} />
        </div>
      )}

      <MessageContent variant={isUser ? "contained" : "flat"}>
        {isUser ? (
          <p className="whitespace-pre-wrap text-[14px] leading-[1.65]">
            {message.content}
          </p>
        ) : (
          <Response>{message.content}</Response>
        )}

        {/* Structured content: action cards & quick replies */}
        {!isUser && message.structured_content ? (
          message.structured_content.type === "action_card" ? (
            <ActionCard
              content={message.structured_content}
              disabled={isSending}
              isEn={isEn}
              onAction={(key) => onActionCard?.(message.id, key)}
            />
          ) : message.structured_content.type === "quick_replies" &&
            message.structured_content.suggestions?.length ? (
            <QuickReplyChips
              disabled={isSending}
              onSelect={(s) => onQuickReply?.(s)}
              suggestions={message.structured_content.suggestions}
            />
          ) : null
        ) : null}

        {/* Explainability panel (3-tier) or fallback ToolTraceBadges */}
        {!isUser && message.explanation?.summary ? (
          <ExplainabilityPanel
            explanation={message.explanation}
            isEn={isEn}
            toolTrace={message.tool_trace}
          />
        ) : !isUser && message.tool_trace?.length ? (
          <ToolTraceBadges
            isExpanded={traceExpanded}
            onToggle={() => setTraceExpanded((prev) => !prev)}
            trace={message.tool_trace}
          />
        ) : null}

        {!isUser && message.model_used ? (
          <div className="mt-2.5">
            <span className="inline-flex items-center rounded-md border border-border/40 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
              {getModelDisplayName(message.model_used)}
            </span>
          </div>
        ) : null}

        <div
          className={cn(
            "mt-2 flex items-center gap-0.5 opacity-0 transition-all duration-200 ease-out group-focus-within:opacity-100 group-hover:opacity-100"
          )}
        >
          <Button
            className={cn(
              "h-6 w-6 rounded-md transition-colors",
              isUser
                ? "text-white/50 hover:bg-white/10 hover:text-white/80"
                : "text-muted-foreground/60 hover:bg-muted/60 hover:text-foreground",
              copied && !isUser && "text-emerald-500 hover:text-emerald-500",
              copied && isUser && "text-white/80"
            )}
            onClick={handleCopy}
            size="icon"
            variant="ghost"
          >
            <Icon className="h-3 w-3" icon={Copy01Icon} />
            <span className="sr-only">{isEn ? "Copy" : "Copiar"}</span>
          </Button>

          {isUser ? (
            <Button
              className="h-6 w-6 rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
              disabled={isSending}
              onClick={() => onEdit(message.id, message.content)}
              size="icon"
              variant="ghost"
            >
              <Icon className="h-3 w-3" icon={Edit02Icon} />
              <span className="sr-only">
                {isEn ? "Edit & resend" : "Editar y reenviar"}
              </span>
            </Button>
          ) : (
            <>
              <Button
                className="h-6 w-6 rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground"
                disabled={isSending}
                onClick={() => onRetry(message.id)}
                size="icon"
                variant="ghost"
              >
                <Icon className="h-3 w-3" icon={Refresh01Icon} />
                <span className="sr-only">{isEn ? "Retry" : "Reintentar"}</span>
              </Button>

              {onSpeak ? (
                <Button
                  className="h-6 w-6 rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground"
                  onClick={() => onSpeak(message.content)}
                  size="icon"
                  variant="ghost"
                >
                  <Icon className="h-3 w-3" icon={VolumeHighIcon} />
                  <span className="sr-only">
                    {isEn ? "Listen" : "Escuchar"}
                  </span>
                </Button>
              ) : null}

              {onFeedback ? (
                <>
                  <span className="mx-0.5 h-3 w-px bg-border/40" />
                  <Button
                    className={cn(
                      "h-7 w-7 rounded-md transition-all hover:scale-110 active:scale-95",
                      message.feedback_rating === "positive"
                        ? "text-emerald-500 hover:text-emerald-500"
                        : "text-muted-foreground/60 hover:bg-muted/60 hover:text-emerald-500"
                    )}
                    onClick={() => onFeedback(message.id, "positive")}
                    size="icon"
                    variant="ghost"
                  >
                    <Icon className="h-3.5 w-3.5" icon={ThumbsUpIcon} />
                    <span className="sr-only">
                      {isEn ? "Good response" : "Buena respuesta"}
                    </span>
                  </Button>
                  <Button
                    className={cn(
                      "h-7 w-7 rounded-md transition-all hover:scale-110 active:scale-95",
                      message.feedback_rating === "negative"
                        ? "text-destructive hover:text-destructive"
                        : "text-muted-foreground/60 hover:bg-muted/60 hover:text-destructive"
                    )}
                    onClick={handleThumbsDown}
                    size="icon"
                    variant="ghost"
                  >
                    <Icon className="h-3.5 w-3.5" icon={ThumbsDownIcon} />
                    <span className="sr-only">
                      {isEn ? "Bad response" : "Mala respuesta"}
                    </span>
                  </Button>

                  {/* Item 3: Regenerate button after thumbs-down */}
                  {onRegenerate && message.feedback_rating === "negative" ? (
                    <Button
                      className="h-7 w-7 rounded-md text-amber-500 transition-all hover:scale-110 hover:bg-amber-500/10 hover:text-amber-600 active:scale-95"
                      disabled={isSending}
                      onClick={() => onRegenerate(message.id)}
                      size="icon"
                      title={
                        isEn
                          ? "Regenerate with more context"
                          : "Regenerar con mas contexto"
                      }
                      variant="ghost"
                    >
                      <Icon className="h-3.5 w-3.5" icon={Refresh01Icon} />
                      <span className="sr-only">
                        {isEn ? "Regenerate" : "Regenerar"}
                      </span>
                    </Button>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>

        {/* Item 5a: Feedback reasons dropdown */}
        {showReasons && message.feedback_rating === "negative" ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {FEEDBACK_REASONS.map((reason) => (
              <button
                className="rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 font-medium text-[10px] text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                key={reason}
                onClick={() => handleReasonSelect(reason)}
                type="button"
              >
                {reason}
              </button>
            ))}
          </div>
        ) : null}

        {/* Feedback confirmation banner */}
        {!isUser && message.feedbackConfirmed ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="text-[11.5px] text-emerald-700 dark:text-emerald-400">
              {isEn
                ? "Correction noted — this will improve future responses."
                : "Corrección registrada — esto mejorará las respuestas futuras."}
            </span>
          </div>
        ) : null}
      </MessageContent>
    </Message>
  );
}
