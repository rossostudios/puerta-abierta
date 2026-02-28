"use client";

import {
  ArrowRight01Icon,
  Mic01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type DashboardQueryBarProps = {
  isEn: boolean;
};

export function DashboardQueryBar({ isEn }: DashboardQueryBarProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const suggestions = isEn
    ? [
        "Draft a message to guest in Unit 4",
        "Show me revenue forecast for next month",
      ]
    : [
        "Redacta un mensaje para el huésped de la Unidad 4",
        "Muéstrame el pronóstico de ingresos del próximo mes",
      ];

  const submitQuery = useCallback(
    (nextQuery: string) => {
      const trimmed = nextQuery.trim();
      if (!trimmed) return;
      router.push(`/app/agents?q=${encodeURIComponent(trimmed)}`);
    },
    [router]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      submitQuery(query);
    },
    [query, submitQuery]
  );

  return (
    <div className="relative space-y-3">
      <form
        className={cn(
          "glass-float relative flex items-center gap-2 rounded-3xl border border-border/40 p-2.5",
          "transition-all duration-200",
          "focus-within:border-[var(--sidebar-primary)]/25"
        )}
        onSubmit={handleSubmit}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border/50 bg-background/80 px-3 py-3 backdrop-blur-sm">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--sidebar-primary)]/8 text-[var(--sidebar-primary)]">
            <Icon className="h-4 w-4" icon={SparklesIcon} />
          </span>
          <input
            className="w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none md:text-[15px]"
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isEn
                ? "Ask about your portfolio..."
                : "Pregunta sobre tu portafolio..."
            }
            type="text"
            value={query}
          />
        </div>

        <button
          aria-label={isEn ? "Open voice chat" : "Abrir chat de voz"}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/50 bg-background/80 text-muted-foreground",
            "transition-colors hover:text-foreground"
          )}
          onClick={() => router.push("/app/agents")}
          type="button"
        >
          <Icon className="h-4 w-4" icon={Mic01Icon} />
        </button>

        <button
          aria-label={isEn ? "Send query" : "Enviar consulta"}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sidebar-primary)] text-white",
            "shadow-[0_10px_20px_-12px_var(--sidebar-primary)] transition-transform active:scale-95"
          )}
          type="submit"
        >
          <Icon className="h-4 w-4" icon={ArrowRight01Icon} />
        </button>
      </form>

      <div className="flex flex-wrap gap-2 px-1">
        {suggestions.map((suggestion) => (
          <button
            className={cn(
              "rounded-full glass-liquid px-3 py-1.5 text-xs text-muted-foreground",
              "transition-colors hover:border-[var(--sidebar-primary)]/25 hover:text-foreground"
            )}
            key={suggestion}
            onClick={() => submitQuery(suggestion)}
            type="button"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
