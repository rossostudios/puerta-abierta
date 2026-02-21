"use client";

import {
  ArrowUp02Icon,
  AttachmentIcon,
  Mic01Icon,
  MicOff01Icon,
  StopCircleIcon,
} from "@hugeicons/core-free-icons";
import { useRef } from "react";

import { ChatAttachmentPreview } from "@/components/agent/chat-attachment-preview";
import type { ChatAttachment } from "@/components/agent/use-chat-attachments";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function ChatInputBar({
  draft,
  onDraftChange,
  onSend,
  onStop,
  isSending,
  isEn,
  isEmbedded,
  editingSourceId,
  onCancelEdit,
  // Voice
  voiceSupported,
  voiceModeActive,
  isListening,
  voiceTranscript,
  onToggleVoice,
  // Attachments
  attachments,
  onAddFiles,
  onRemoveAttachment,
  attachmentsReady,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (value?: string) => void;
  onStop: () => void;
  isSending: boolean;
  isEn: boolean;
  isEmbedded: boolean;
  editingSourceId: string | null;
  onCancelEdit: () => void;
  // Voice
  voiceSupported?: boolean;
  voiceModeActive?: boolean;
  isListening?: boolean;
  voiceTranscript?: string;
  onToggleVoice?: () => void;
  // Attachments
  attachments?: ChatAttachment[];
  onAddFiles?: (files: FileList) => void;
  onRemoveAttachment?: (id: string) => void;
  attachmentsReady?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const displayValue =
    voiceModeActive && isListening && voiceTranscript ? voiceTranscript : draft;
  const canSend =
    !isSending && (draft.trim() || (attachments?.length && attachmentsReady));

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 bg-gradient-to-t pt-6 pr-4 pb-6 pl-4 sm:pr-6 sm:pl-6",
        isEmbedded
          ? "border-border/60 border-t from-card via-card/95 to-transparent"
          : "from-background via-background/95 to-transparent"
      )}
    >
      <div className="mx-auto max-w-3xl space-y-3">
        {editingSourceId ? (
          <div className="glass-inner flex items-center justify-between rounded-xl px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              {isEn
                ? "Editing a previous message before resend"
                : "Editando un mensaje previo antes de reenviar"}
            </span>
            <Button
              className="h-6 px-2 text-[11px]"
              disabled={isSending}
              onClick={onCancelEdit}
              size="sm"
              variant="ghost"
            >
              {isEn ? "Cancel" : "Cancelar"}
            </Button>
          </div>
        ) : null}

        {voiceModeActive && isListening ? (
          <div className="flex items-center gap-2 px-1">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--sidebar-primary)]" />
            <span className="text-[11px] text-muted-foreground">
              {isEn ? "Voice mode — listening..." : "Modo voz — escuchando..."}
            </span>
          </div>
        ) : null}

        {attachments && attachments.length > 0 && onRemoveAttachment ? (
          <ChatAttachmentPreview
            attachments={attachments}
            onRemove={onRemoveAttachment}
          />
        ) : null}

        <div className="glass-surface relative flex rounded-2xl shadow-md transition-shadow focus-within:ring-1 focus-within:ring-[var(--sidebar-primary)]/30 hover:shadow-lg">
          <div className="flex items-end gap-1 py-2.5 pl-3">
            {onAddFiles ? (
              <>
                <Button
                  className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  disabled={isSending}
                  onClick={() => fileInputRef.current?.click()}
                  size="icon"
                  variant="ghost"
                >
                  <Icon className="h-4 w-4" icon={AttachmentIcon} />
                  <span className="sr-only">
                    {isEn ? "Attach file" : "Adjuntar archivo"}
                  </span>
                </Button>
                <input
                  accept="image/*,.pdf,.txt,.csv,.md,.json"
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      onAddFiles(e.target.files);
                      e.target.value = "";
                    }
                  }}
                  ref={fileInputRef}
                  type="file"
                />
              </>
            ) : null}

            {voiceSupported && onToggleVoice ? (
              <Button
                className={cn(
                  "h-8 w-8 shrink-0 rounded-full transition-colors",
                  voiceModeActive
                    ? "bg-[var(--sidebar-primary)] text-white hover:bg-[var(--sidebar-primary)]/90"
                    : "text-muted-foreground hover:text-foreground"
                )}
                disabled={isSending}
                onClick={onToggleVoice}
                size="icon"
                variant={voiceModeActive ? "default" : "ghost"}
              >
                <Icon
                  className={cn(
                    "h-4 w-4",
                    voiceModeActive && isListening && "animate-pulse"
                  )}
                  icon={voiceModeActive ? MicOff01Icon : Mic01Icon}
                />
                <span className="sr-only">
                  {voiceModeActive
                    ? isEn
                      ? "Exit voice mode"
                      : "Salir del modo voz"
                    : isEn
                      ? "Voice mode"
                      : "Modo voz"}
                </span>
              </Button>
            ) : null}
          </div>

          <Textarea
            className="min-h-[52px] w-full resize-none border-0 bg-transparent px-3 py-3.5 pr-24 shadow-none focus-visible:ring-0 sm:text-sm"
            maxLength={4000}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={isEn ? "Message Zoey..." : "Enviar mensaje a Zoey..."}
            rows={1}
            value={displayValue}
          />

          <div className="absolute right-3 bottom-2.5 flex items-center gap-1.5">
            {isSending ? (
              <Button
                className="h-8 w-8 rounded-full"
                onClick={onStop}
                size="icon"
                variant="outline"
              >
                <Icon className="h-4 w-4" icon={StopCircleIcon} />
                <span className="sr-only">{isEn ? "Stop" : "Detener"}</span>
              </Button>
            ) : null}
            <Button
              className="h-8 w-8 rounded-full bg-[var(--sidebar-primary)] text-white shadow-sm hover:bg-[var(--sidebar-primary)]/90 disabled:opacity-40"
              disabled={!canSend}
              onClick={() => onSend()}
              size="icon"
            >
              <Icon className="h-4 w-4" icon={ArrowUp02Icon} />
              <span className="sr-only">
                {isEn ? "Send message" : "Enviar mensaje"}
              </span>
            </Button>
          </div>
        </div>

        <div className="text-center">
          <span className="text-[10px] text-muted-foreground/60">
            {isEn
              ? "AI can make mistakes. Verify important information."
              : "La IA puede cometer errores. Verifica la información importante."}
          </span>
        </div>
      </div>
    </div>
  );
}
