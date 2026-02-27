"use client";

import { SparklesIcon } from "@hugeicons/core-free-icons";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

function getGreeting(isEn: boolean, firstName: string): string {
  const hour = new Date().getHours();
  if (hour < 12)
    return isEn ? `Good morning, ${firstName}` : `Buenos días, ${firstName}`;
  if (hour < 17)
    return isEn
      ? `Good afternoon, ${firstName}`
      : `Buenas tardes, ${firstName}`;
  return isEn ? `Good evening, ${firstName}` : `Buenas noches, ${firstName}`;
}

export function ChatEmptyState({
  quickPrompts,
  contextualSuggestions,
  onSendPrompt,
  isEn,
  disabled,
  agentName,
  agentDescription,
  firstName,
}: {
  quickPrompts: string[];
  contextualSuggestions?: string[];
  onSendPrompt: (prompt: string) => void;
  isEn: boolean;
  disabled?: boolean;
  agentName?: string;
  agentDescription?: string;
  firstName?: string;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/2 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--sidebar-primary)]/[0.06] blur-[100px]" />
      </div>

      <div className="relative mb-10 flex flex-col items-center gap-5">
        {firstName ? (
          <h1 className="font-serif text-2xl text-foreground/80 tracking-tight">
            {getGreeting(isEn, firstName)}
          </h1>
        ) : null}
        {/* Avatar mark */}
        <div className="relative">
          <div className="absolute -inset-3 rounded-3xl bg-[var(--sidebar-primary)]/[0.08] blur-xl" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-casaora-gradient text-white shadow-casaora">
            <Icon className="h-6 w-6" icon={SparklesIcon} strokeWidth={1.5} />
          </div>
        </div>

        <div className="space-y-2.5 text-center">
          <h2 className="font-serif text-[1.75rem] text-foreground leading-tight tracking-tight">
            {agentName || (isEn ? "Concierge" : "Concierge")}
          </h2>
          <p className="mx-auto max-w-sm text-[13.5px] text-muted-foreground leading-relaxed">
            {agentDescription ||
              (isEn
                ? "Your AI-powered property operations assistant. Ask me anything."
                : "Tu asistente de operaciones impulsado por IA. Preguntame lo que necesites.")}
          </p>
        </div>
      </div>

      {/* Contextual suggestions (dynamic, portfolio-aware) */}
      {contextualSuggestions && contextualSuggestions.length > 0 ? (
        <div className="relative flex w-full max-w-xl flex-col items-center gap-2.5">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-[11px] text-muted-foreground/60 uppercase tracking-widest">
            <Icon
              className="h-3 w-3 text-[var(--sidebar-primary)]/60"
              icon={SparklesIcon}
            />
            {isEn ? "Suggested for you" : "Sugerido para ti"}
          </p>
          <div className="flex w-full flex-wrap justify-center gap-2">
            {contextualSuggestions.slice(0, 3).map((prompt, i) => (
              <button
                className={cn(
                  "glass-inner group relative cursor-pointer rounded-xl border border-[var(--sidebar-primary)]/10 px-4 py-3 text-left text-[13px] text-foreground/80 leading-snug",
                  "transition-all duration-200 ease-out",
                  "hover:border-[var(--sidebar-primary)]/20 hover:bg-[var(--sidebar-primary)]/[0.06] hover:text-foreground hover:shadow-sm",
                  "active:scale-[0.98]",
                  "disabled:pointer-events-none disabled:opacity-40",
                  "animate-[fadeInUp_0.4s_ease-out_both]"
                )}
                disabled={disabled}
                key={prompt}
                onClick={() => onSendPrompt(prompt)}
                style={{ animationDelay: `${i * 80 + 100}ms` }}
                type="button"
              >
                <span className="relative">{prompt}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {quickPrompts.length > 0 ? (
        <div className="relative flex w-full max-w-xl flex-col items-center gap-2.5">
          <p className="mb-1 font-medium text-[11px] text-muted-foreground/60 uppercase tracking-widest">
            {isEn ? "Try asking" : "Prueba preguntar"}
          </p>
          <div className="flex w-full flex-wrap justify-center gap-2">
            {quickPrompts.slice(0, 3).map((prompt, i) => (
              <button
                className={cn(
                  "glass-inner group relative cursor-pointer rounded-xl px-4 py-3 text-left text-[13px] text-foreground/80 leading-snug",
                  "transition-all duration-200 ease-out",
                  "hover:bg-[var(--sidebar-primary)]/[0.06] hover:text-foreground hover:shadow-sm",
                  "active:scale-[0.98]",
                  "disabled:pointer-events-none disabled:opacity-40",
                  "animate-[fadeInUp_0.4s_ease-out_both]"
                )}
                disabled={disabled}
                key={prompt}
                onClick={() => onSendPrompt(prompt)}
                style={{ animationDelay: `${i * 80 + 100}ms` }}
                type="button"
              >
                <span className="relative">{prompt}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
