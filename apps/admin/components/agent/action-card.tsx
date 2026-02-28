"use client";

import {
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type ActionCardAction = {
  label: string;
  key: string;
  variant?: "approve" | "reject" | "alternative";
};

export type StructuredContent = {
  type: "action_card" | "quick_replies";
  prompt?: string;
  parameters?: Record<string, string | number>;
  actions?: ActionCardAction[];
  suggestions?: string[];
};

type ActionCardProps = {
  content: StructuredContent;
  isEn: boolean;
  onAction?: (actionKey: string) => void;
  disabled?: boolean;
};

const VARIANT_STYLES: Record<string, string> = {
  approve:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400",
  reject:
    "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
  alternative:
    "border-border/50 bg-muted/40 text-foreground/80 hover:bg-muted/60",
};

export function ActionCard({
  content,
  isEn: _isEn,
  onAction,
  disabled,
}: ActionCardProps) {
  const handleAction = useCallback(
    (key: string) => {
      onAction?.(key);
    },
    [onAction]
  );

  if (content.type !== "action_card") return null;

  const params = content.parameters;
  const actions = content.actions ?? [];

  return (
    <div className="glass-inner mt-3 overflow-hidden rounded-xl border border-border/40">
      {content.prompt ? (
        <div className="border-border/30 border-b px-4 py-3">
          <p className="font-medium text-[13px] text-foreground/90 leading-relaxed">
            {content.prompt}
          </p>
        </div>
      ) : null}

      {params && Object.keys(params).length > 0 ? (
        <div className="space-y-1.5 px-4 py-3">
          {Object.entries(params).map(([key, value]) => (
            <div className="flex items-center justify-between gap-3" key={key}>
              <span className="text-[11.5px] text-muted-foreground/70 capitalize">
                {key.replace(/_/g, " ")}
              </span>
              <span className="font-medium text-[12px] text-foreground/80">
                {String(value)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {actions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-border/30 border-t px-4 py-3">
          {actions.map((action) => {
            const variant = action.variant ?? "alternative";
            return (
              <Button
                className={cn(
                  "h-8 gap-1.5 rounded-lg border px-3 font-medium text-[12px] transition-all",
                  VARIANT_STYLES[variant] ?? VARIANT_STYLES.alternative,
                  disabled && "pointer-events-none opacity-40"
                )}
                disabled={disabled}
                key={action.key}
                onClick={() => handleAction(action.key)}
                size="sm"
                variant="ghost"
              >
                {variant === "approve" ? (
                  <Icon className="h-3 w-3" icon={CheckmarkCircle02Icon} />
                ) : variant === "reject" ? (
                  <Icon className="h-3 w-3" icon={Cancel01Icon} />
                ) : (
                  <Icon className="h-3 w-3" icon={ArrowRight01Icon} />
                )}
                {action.label}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
