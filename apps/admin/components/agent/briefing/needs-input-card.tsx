"use client";

import { FlashIcon, Wrench01Icon } from "@hugeicons/core-free-icons";
import { motion } from "motion/react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { CARD, EASING, fmtPyg, SectionLabel, type Stats } from "./helpers";

type ActionItem = {
  id: string;
  icon: typeof FlashIcon;
  title: string;
  description: string;
  primaryLabel: string;
  primaryPrompt: string;
  secondaryLabel?: string;
  secondaryPrompt?: string;
};

/* Inline SVG icons for items that don't have hugeicon equivalents */
function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-label="Document"
      className={className}
      fill="none"
      role="img"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" x2="8" y1="13" y2="13" />
      <line x1="16" x2="8" y1="17" y2="17" />
    </svg>
  );
}

function ChartBarIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-label="Chart"
      className={className}
      fill="none"
      role="img"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <line x1="18" x2="18" y1="20" y2="10" />
      <line x1="12" x2="12" y1="20" y2="4" />
      <line x1="6" x2="6" y1="20" y2="14" />
    </svg>
  );
}

export function NeedsInputCard({
  stats,
  isEn,
  onSend,
  disabled,
}: {
  stats: Stats;
  isEn: boolean;
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  const items = useMemo(() => {
    const result: ActionItem[] = [];

    // 1. Maintenance items (real data)
    for (const m of (stats.maintenance_items ?? []).slice(0, 3)) {
      const loc = [m.property_name, m.unit_code].filter(Boolean).join(" · ");
      result.push({
        id: `maint-${m.title}`,
        icon: Wrench01Icon,
        title: `${m.title} needs approval`,
        description: loc
          ? `${loc} — ${m.category}, ${m.urgency}`
          : `${m.category}, ${m.urgency}`,
        primaryLabel: isEn ? "Approve" : "Aprobar",
        primaryPrompt: `Approve the ${m.title} maintenance request`,
        secondaryLabel: isEn ? "Get another quote" : "Pedir otra cotización",
        secondaryPrompt: `Get another quote for ${m.title}`,
      });
    }

    // 2. Lease renewals (real data)
    for (const lr of (stats.lease_renewals ?? []).slice(0, 3)) {
      const loc = [lr.unit_code, lr.property_name].filter(Boolean).join(", ");
      result.push({
        id: `lease-${lr.tenant_name}-${lr.ends_on}`,
        icon: FlashIcon, // placeholder — we override rendering below
        title: `Lease renewal due — ${loc}`,
        description: `${lr.tenant_name} — lease expires ${lr.ends_on}`,
        primaryLabel: isEn
          ? "Send renewal offer"
          : "Enviar oferta de renovación",
        primaryPrompt: `Send a renewal offer to ${lr.tenant_name} at ${lr.unit_code}`,
        secondaryLabel: isEn ? "Remind me in 3 days" : "Recordarme en 3 días",
        secondaryPrompt: `Remind me about ${lr.tenant_name}'s lease renewal in 3 days`,
      });
    }

    // 3. Owner statements ready
    const stmts = stats.statements_ready;
    if (stmts && stmts.count > 0) {
      result.push({
        id: "statements-ready",
        icon: FlashIcon, // placeholder
        title: `${stmts.count} owner statement${stmts.count !== 1 ? "s" : ""} ready to send`,
        description: `Total payout: ${fmtPyg(stmts.total_payout)}`,
        primaryLabel: isEn ? "Review & send" : "Revisar y enviar",
        primaryPrompt: "Review and send the pending owner statements",
        secondaryLabel: isEn ? "I'll review later" : "Revisaré después",
      });
    }

    // 4. Pending approvals fallback
    const pending = (stats.recent_activity ?? []).filter(
      (a) => a.status === "pending"
    );
    for (const item of pending.slice(0, Math.max(0, 3 - result.length))) {
      const toolName = item.tool_name.replace(/_/g, " ");
      result.push({
        id: `approval-${item.tool_name}-${item.created_at}`,
        icon: FlashIcon,
        title: toolName,
        description:
          item.reasoning ||
          (isEn
            ? `Agent wants to execute: ${toolName}`
            : `El agente quiere ejecutar: ${toolName}`),
        primaryLabel: isEn ? "Review" : "Revisar",
        primaryPrompt: isEn
          ? `Review the pending ${toolName} action`
          : `Revisar la acción pendiente de ${toolName}`,
        secondaryLabel: isEn ? "Details" : "Detalles",
        secondaryPrompt: isEn
          ? `Tell me more about the pending ${toolName}`
          : `Cuéntame más sobre la acción pendiente de ${toolName}`,
      });
    }

    return result;
  }, [stats, isEn]);

  if (items.length === 0) return null;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(CARD, "space-y-4 p-5")}
      initial={{ opacity: 0, y: 12 }}
      transition={{ delay: 0.1, duration: 0.4, ease: EASING }}
    >
      <div className="flex items-center gap-2.5">
        <SectionLabel>
          {isEn ? "Needs Your Attention" : "Requiere Tu Atención"}
        </SectionLabel>
        <Badge
          className="font-medium text-[10px] tabular-nums"
          variant="secondary"
        >
          {items.length}
        </Badge>
      </div>

      <div className="space-y-3">
        {items.map((item, i) => {
          const isLease = item.id.startsWith("lease-");
          const isStatement = item.id === "statements-ready";

          return (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="glass-inner flex items-start gap-3 rounded-xl p-4"
              initial={{ opacity: 0, y: 8 }}
              key={item.id}
              transition={{
                delay: 0.15 + i * 0.08,
                duration: 0.3,
                ease: EASING,
              }}
            >
              <div className="glass-inner mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                {isLease ? (
                  <DocumentIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
                ) : isStatement ? (
                  <ChartBarIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
                ) : (
                  <Icon
                    className="text-muted-foreground/60"
                    icon={item.icon}
                    size={14}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="font-medium text-foreground/90 text-sm">
                    {item.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-muted-foreground/60 text-xs">
                    {item.description}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    className="h-7 rounded-lg bg-foreground px-3 text-[12px] text-background hover:bg-foreground/90"
                    disabled={disabled}
                    onClick={() => onSend(item.primaryPrompt)}
                    size="sm"
                  >
                    {item.primaryLabel}
                  </Button>
                  {item.secondaryLabel && (
                    <Button
                      className="h-7 rounded-lg px-3 text-[12px]"
                      disabled={disabled}
                      onClick={() =>
                        item.secondaryPrompt
                          ? onSend(item.secondaryPrompt)
                          : undefined
                      }
                      size="sm"
                      variant="outline"
                    >
                      {item.secondaryLabel}
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
