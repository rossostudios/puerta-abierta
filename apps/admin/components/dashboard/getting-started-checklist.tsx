"use client";

import {
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Progress } from "@/components/ui/progress";
import type { ChecklistItem } from "@/lib/onboarding-checklist";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "pa-checklist-dismissed";
const DISMISS_VERSION_KEY = "pa-checklist-dismissed-count";

type GettingStartedChecklistProps = {
  items: ChecklistItem[];
  locale: string;
};

export function GettingStartedChecklist({
  items,
  locale,
}: GettingStartedChecklistProps) {
  const isEn = locale === "en-US";

  const doneCount = items.filter((i) => i.isDone).length;
  const totalCount = items.length;
  const progressPercent =
    totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const allDone = doneCount === totalCount;

  const emptySubscribe = useCallback(() => () => undefined, []);
  const getDismissedSnapshot = useCallback(() => {
    const savedDismissedCount = Number(
      localStorage.getItem(DISMISS_VERSION_KEY) ?? "0"
    );
    const isDismissed = localStorage.getItem(DISMISS_KEY) === "true";
    if (isDismissed && savedDismissedCount >= doneCount) {
      return true;
    }
    if (isDismissed) {
      // New items became actionable, clear dismiss
      localStorage.removeItem(DISMISS_KEY);
    }
    return false;
  }, [doneCount]);
  const getServerDismissed = useCallback(() => true, []);
  const dismissed = useSyncExternalStore(
    emptySubscribe,
    getDismissedSnapshot,
    getServerDismissed
  );
  const [, forceUpdate] = useState(0);

  const onDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    localStorage.setItem(DISMISS_VERSION_KEY, String(doneCount));
    forceUpdate((c) => c + 1);
  };

  if (dismissed || totalCount === 0) return null;

  return (
    <Card className="relative overflow-hidden">
      <Button
        className="absolute top-4 right-4 h-8 w-8 text-muted-foreground hover:bg-muted/50"
        onClick={onDismiss}
        size="icon"
        variant="ghost"
      >
        <Icon icon={Cancel01Icon} size={16} />
      </Button>
      <CardHeader className="border-border/70 border-b pb-4">
        <CardTitle className="text-xl">
          {allDone
            ? isEn
              ? "All set!"
              : "¡Todo listo!"
            : isEn
              ? "Getting started"
              : "Primeros pasos"}
        </CardTitle>
        <CardDescription className="max-w-md">
          {allDone
            ? isEn
              ? "You've completed all getting started steps. You can dismiss this card."
              : "Completaste todos los pasos iniciales. Puedes ocultar esta tarjeta."
            : isEn
              ? "Complete these steps to unlock your full operations workflow."
              : "Completa estos pasos para activar tu flujo de operaciones."}
        </CardDescription>
        <div className="mt-3 flex items-center gap-3">
          <Progress
            className="h-2 flex-1"
            indicatorClassName={allDone ? "bg-primary" : undefined}
            value={progressPercent}
          />
          <span className="shrink-0 font-medium text-muted-foreground text-xs tabular-nums">
            {doneCount}/{totalCount}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-1.5">
          {items.map((item) => (
            <div
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
                item.isDone ? "opacity-60" : "bg-muted/30 hover:bg-muted/50"
              )}
              key={item.id}
            >
              <Icon
                className={cn(
                  "shrink-0",
                  item.isDone ? "text-primary" : "text-muted-foreground/40"
                )}
                icon={item.isDone ? CheckmarkCircle02Icon : CircleIcon}
                size={18}
              />
              <span
                className={cn(
                  "flex-1 text-sm",
                  item.isDone
                    ? "text-muted-foreground line-through"
                    : "font-medium text-foreground"
                )}
              >
                {isEn ? item.labelEn : item.labelEs}
              </span>
              {item.isDone ? null : (
                <Link
                  className="inline-flex items-center gap-1 font-medium text-foreground text-xs hover:underline"
                  href={item.href}
                >
                  {isEn ? "Go" : "Ir"}
                  <Icon icon={ArrowRight01Icon} size={12} />
                </Link>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
