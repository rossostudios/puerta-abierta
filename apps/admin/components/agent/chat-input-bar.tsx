"use client";

import {
  ArrowUp02Icon,
  AttachmentIcon,
  Mail01Icon,
  Mic01Icon,
  MicOff01Icon,
  NoteIcon,
  StopCircleIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { useRef } from "react";

import { ChatAttachmentPreview } from "@/components/agent/chat-attachment-preview";
import type { ChatAttachment } from "@/components/agent/use-chat-attachments";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/textarea";
import { ScrollingWaveform } from "@/components/ui/waveform";
import { cn } from "@/lib/utils";

export type QuickAction = {
  label: string;
  prompt: string;
  icon: typeof Wrench01Icon;
};

const QUICK_ACTIONS_EN: QuickAction[] = [
  {
    label: "Log Maintenance",
    prompt: "Log a new maintenance request",
    icon: Wrench01Icon,
  },
  {
    label: "Generate Report",
    prompt: "Generate a financial report for this month",
    icon: NoteIcon,
  },
  {
    label: "Draft Guest Message",
    prompt: "Draft a message for an upcoming guest",
    icon: Mail01Icon,
  },
];

const QUICK_ACTIONS_ES: QuickAction[] = [
  {
    label: "Registrar Mantenimiento",
    prompt: "Registrar una nueva solicitud de mantenimiento",
    icon: Wrench01Icon,
  },
  {
    label: "Generar Reporte",
    prompt: "Generar un reporte financiero de este mes",
    icon: NoteIcon,
  },
  {
    label: "Mensaje a Huésped",
    prompt: "Redactar un mensaje para un próximo huésped",
    icon: Mail01Icon,
  },
];

export function ChatInputBar({
  draft,
  onDraftChange,
  onSend,
  onStop,
  isSending,
  isEn,
  isEmbedded,
  isHero,
  hasMessages,
  editingSourceId,
  onCancelEdit,
  agentName,
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
  // Quick actions
  quickActions,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (value?: string) => void;
  onStop: () => void;
  isSending: boolean;
  isEn: boolean;
  isEmbedded: boolean;
  isHero?: boolean;
  hasMessages?: boolean;
  editingSourceId: string | null;
  onCancelEdit: () => void;
  agentName?: string;
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
  // Quick actions
  quickActions?: QuickAction[];
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const displayValue =
    voiceModeActive && isListening && voiceTranscript ? voiceTranscript : draft;
  const canSend =
    !isSending && (draft.trim() || (attachments?.length && attachmentsReady));

  const placeholderName = agentName || "Casaora AI";
  const actions = quickActions ?? (isEn ? QUICK_ACTIONS_EN : QUICK_ACTIONS_ES);

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 pt-12 pr-4 pb-5 pl-4 sm:pr-6 sm:pl-6",
        isEmbedded && !isHero
          ? "border-border/40 border-t bg-card/95"
          : "pointer-events-none bg-gradient-to-t from-background via-background/90 to-transparent"
      )}
    >
      <div
        className={cn(
          "pointer-events-auto mx-auto space-y-2.5",
          isHero ? "max-w-2xl" : "max-w-3xl"
        )}
      >
        {editingSourceId ? (
          <div className="glass-inner flex items-center justify-between rounded-xl px-3.5 py-2 text-[11px] text-muted-foreground">
            <span>
              {isEn
                ? "Editing a previous message before resend"
                : "Editando un mensaje previo antes de reenviar"}
            </span>
            <Button
              className="h-6 rounded-md px-2 text-[11px]"
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
          <div className="flex items-center gap-2.5 px-1">
            <ScrollingWaveform
              barColor="var(--sidebar-primary)"
              barCount={24}
              barGap={2}
              barRadius={2}
              barWidth={3}
              className="w-20"
              height={16}
              speed={30}
            />
            <span className="text-[11px] text-muted-foreground/70">
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

        <div
          className={cn(
            "glass-float relative flex rounded-2xl transition-all duration-300",
            "focus-within:border-[var(--sidebar-primary)]/20"
          )}
        >
          <div className="flex items-end gap-0.5 py-2.5 pl-2.5">
            {onAddFiles ? (
              <>
                <Button
                  className="h-8 w-8 shrink-0 rounded-xl text-muted-foreground/50 transition-all duration-200 hover:scale-105 hover:bg-muted/30 hover:text-foreground"
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
                  "h-8 w-8 shrink-0 rounded-xl transition-all duration-200",
                  voiceModeActive
                    ? "bg-casaora-gradient text-white shadow-casaora hover:scale-105 hover:opacity-90"
                    : "text-muted-foreground/50 hover:scale-105 hover:bg-muted/30 hover:text-foreground"
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
            className="min-h-[52px] w-full resize-none border-0 bg-transparent px-3 py-3.5 pr-24 shadow-none placeholder:text-muted-foreground/40 focus-visible:ring-0 sm:text-[13.5px]"
            maxLength={4000}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={
              isEn
                ? `What would you like ${placeholderName} to handle today?`
                : `¿Qué te gustaría que ${placeholderName} gestione hoy?`
            }
            rows={1}
            value={displayValue}
          />

          <div className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5">
            {isSending ? (
              <Button
                className="h-8 w-8 rounded-xl border-border/30"
                onClick={onStop}
                size="icon"
                variant="outline"
              >
                <Icon className="h-3.5 w-3.5" icon={StopCircleIcon} />
                <span className="sr-only">{isEn ? "Stop" : "Detener"}</span>
              </Button>
            ) : null}
            <Button
              className="h-8 w-8 rounded-xl bg-casaora-gradient text-white shadow-casaora transition-all duration-200 hover:scale-105 hover:brightness-110 disabled:opacity-30 disabled:shadow-none"
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

        {/* Quick actions */}
        {isHero && !hasMessages ? (
          <div className="flex items-center justify-center gap-1.5">
            {actions.map((action) => (
              <button
                className={cn(
                  "glass-liquid flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] text-muted-foreground/60",
                  "transition-all duration-200 ease-out",
                  "hover:border-[var(--sidebar-primary)]/20 hover:bg-[var(--sidebar-primary)]/[0.04] hover:text-foreground/70",
                  "active:scale-[0.97]",
                  "disabled:pointer-events-none disabled:opacity-40"
                )}
                disabled={isSending}
                key={action.label}
                onClick={() => onSend(action.prompt)}
                type="button"
              >
                <Icon
                  className="h-3 w-3 shrink-0"
                  icon={action.icon}
                  strokeWidth={1.8}
                />
                {action.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="text-center">
          <span className="text-[11px] text-muted-foreground/50">
            {isEn
              ? "AI can make mistakes. Verify important information."
              : "La IA puede cometer errores. Verifica la información importante."}
          </span>
        </div>
      </div>
    </div>
  );
}
