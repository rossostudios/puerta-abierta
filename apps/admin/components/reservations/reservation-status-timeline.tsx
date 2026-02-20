"use client";

import { transitionReservationStatusAction } from "@/app/(admin)/module/reservations/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import type { ReservationDetail } from "@/lib/features/reservations/types";
import { cn } from "@/lib/utils";

type StatusTimelineProps = {
  reservation: ReservationDetail;
  isEn: boolean;
};

const LIFECYCLE_STEPS = [
  "pending",
  "confirmed",
  "checked_in",
  "checked_out",
] as const;

const STATUS_LABELS_EN: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  checked_in: "Checked In",
  checked_out: "Checked Out",
  cancelled: "Cancelled",
  no_show: "No Show",
};

const STATUS_LABELS_ES: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  checked_in: "Check-in",
  checked_out: "Check-out",
  cancelled: "Cancelada",
  no_show: "No show",
};

function statusActions(
  status: string
): { next: string; label_en: string; label_es: string }[] {
  const s = status.trim().toLowerCase();
  if (s === "pending") {
    return [
      { next: "confirmed", label_en: "Confirm", label_es: "Confirmar" },
      { next: "cancelled", label_en: "Cancel", label_es: "Cancelar" },
    ];
  }
  if (s === "confirmed") {
    return [
      { next: "checked_in", label_en: "Check-in", label_es: "Check-in" },
      { next: "no_show", label_en: "No-show", label_es: "No-show" },
      { next: "cancelled", label_en: "Cancel", label_es: "Cancelar" },
    ];
  }
  if (s === "checked_in") {
    return [
      { next: "checked_out", label_en: "Check-out", label_es: "Check-out" },
    ];
  }
  return [];
}

function stepIndex(status: string): number {
  return LIFECYCLE_STEPS.indexOf(
    status.trim().toLowerCase() as (typeof LIFECYCLE_STEPS)[number]
  );
}

export function ReservationStatusTimeline({
  reservation: r,
  isEn,
}: StatusTimelineProps) {
  const labels = isEn ? STATUS_LABELS_EN : STATUS_LABELS_ES;
  const currentStatus = r.status.trim().toLowerCase();
  const isCancelled =
    currentStatus === "cancelled" || currentStatus === "no_show";
  const currentIdx = isCancelled ? -1 : stepIndex(currentStatus);
  const actions = statusActions(r.status);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {isEn ? "Status Timeline" : "Línea de estado"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          {LIFECYCLE_STEPS.map((step, idx) => {
            const isCompleted =
              !isCancelled && currentIdx >= 0 && idx <= currentIdx;
            const isCurrent = !isCancelled && idx === currentIdx;
            const isFuture = !isCancelled && idx > currentIdx;

            return (
              <div className="flex flex-1 items-center" key={step}>
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full border-2 font-semibold text-xs transition-all",
                      isCurrent &&
                        "border-primary bg-primary text-primary-foreground ring-4 ring-primary/20",
                      isCompleted &&
                        !isCurrent &&
                        "border-primary bg-primary/10 text-primary",
                      isFuture &&
                        "border-border bg-muted/50 text-muted-foreground",
                      isCancelled &&
                        "border-border bg-muted/50 text-muted-foreground"
                    )}
                  >
                    {isCompleted && !isCurrent ? (
                      <svg
                        aria-hidden="true"
                        className="h-4 w-4"
                        fill="none"
                        focusable="false"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        viewBox="0 0 24 24"
                      >
                        <title>
                          {isEn ? "Completed step" : "Paso completado"}
                        </title>
                        <path
                          d="M5 13l4 4L19 7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-center font-medium text-[10px] leading-tight",
                      isCurrent && "font-semibold text-primary",
                      (isFuture || isCancelled) && "text-muted-foreground"
                    )}
                  >
                    {labels[step] ?? step}
                  </span>
                </div>

                {idx < LIFECYCLE_STEPS.length - 1 ? (
                  <div
                    className={cn(
                      "mx-1 h-0.5 flex-1",
                      !isCancelled && currentIdx >= 0 && idx < currentIdx
                        ? "bg-primary"
                        : "bg-border"
                    )}
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        {isCancelled ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <p className="font-semibold text-destructive text-sm">
              {labels[currentStatus] ?? currentStatus}
            </p>
            {r.cancelled_at ? (
              <p className="text-muted-foreground text-xs">
                {new Date(r.cancelled_at).toLocaleDateString(
                  isEn ? "en-US" : "es-PY",
                  {
                    dateStyle: "medium",
                  }
                )}
              </p>
            ) : null}
            {r.cancel_reason ? (
              <p className="mt-1 text-muted-foreground text-xs">
                {isEn ? "Reason" : "Razón"}: {r.cancel_reason}
              </p>
            ) : null}
          </div>
        ) : null}

        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Form
                action={transitionReservationStatusAction}
                key={action.next}
              >
                <input name="reservation_id" type="hidden" value={r.id} />
                <input name="status" type="hidden" value={action.next} />
                <Button
                  size="sm"
                  type="submit"
                  variant={
                    action.next === "cancelled" || action.next === "no_show"
                      ? "outline"
                      : "secondary"
                  }
                >
                  {isEn ? action.label_en : action.label_es}
                </Button>
              </Form>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
