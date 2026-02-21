"use client";

import {
  ArtificialIntelligence05Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export function ChatEmptyState({
  quickPrompts,
  onSendPrompt,
  isEn,
  disabled,
}: {
  quickPrompts: string[];
  onSendPrompt: (prompt: string) => void;
  isEn: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4">
      <div className="mb-8 flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--sidebar-primary)] to-[var(--sidebar-primary)]/70 text-white shadow-lg">
          <Icon className="h-8 w-8" icon={SparklesIcon} strokeWidth={1.5} />
        </div>

        <div className="space-y-2 text-center">
          <h2 className="font-semibold text-2xl tracking-tight">Zoey</h2>
          <p className="mx-auto max-w-md text-muted-foreground text-sm leading-relaxed">
            {isEn
              ? "Ask me anything about your property operations."
              : "Preguntame lo que necesites sobre tus operaciones."}
          </p>
        </div>
      </div>

      {quickPrompts.length > 0 ? (
        <div className="grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-1">
          {quickPrompts.slice(0, 3).map((prompt) => (
            <button
              className={cn(
                "glass-inner group relative w-full rounded-xl px-4 py-3 text-left text-sm transition-all",
                "hover:border-[var(--sidebar-primary)]/40 hover:bg-[var(--sidebar-primary)]/5 hover:shadow-sm",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
              disabled={disabled}
              key={prompt}
              onClick={() => onSendPrompt(prompt)}
              type="button"
            >
              <div className="flex items-center gap-3">
                <Icon
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--sidebar-primary)]"
                  icon={ArtificialIntelligence05Icon}
                />
                <span className="line-clamp-2 text-foreground/90">
                  {prompt}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
