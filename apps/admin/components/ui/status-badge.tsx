import { Badge } from "@/components/ui/badge";
import { humanizeKey } from "@/lib/format";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

type StatusBadgeProps = {
  value?: string | null;
  label?: string | null;
  tone?: StatusTone;
  className?: string;
};

const TONE_CLASS: Record<StatusTone, string> = {
  success: "status-tone-success",
  warning: "status-tone-warning",
  danger: "status-tone-danger",
  info: "status-tone-info",
  neutral: "status-tone-neutral",
};

const VALUE_TONE: Record<string, StatusTone> = {
  active: "success",
  confirmed: "success",
  checked_in: "success",
  checked_out: "success",
  done: "success",
  finalized: "success",
  sent: "success",
  paid: "success",
  processed: "success",
  completed: "success",
  contract_signed: "success",
  qualified: "info",
  offer_sent: "info",
  visit_scheduled: "info",
  met: "success",
  strong: "success",

  inactive: "danger",
  cancelled: "danger",
  failed: "danger",
  no_show: "danger",
  ignored: "danger",
  rejected: "danger",
  lost: "danger",
  terminated: "danger",
  delinquent: "danger",
  breached: "danger",
  late: "danger",

  pending: "warning",
  draft: "warning",
  todo: "warning",
  in_progress: "warning",
  received: "warning",
  queued: "warning",
  new: "warning",
  screening: "warning",
  scheduled: "warning",
  moderate: "warning",
  watch: "warning",

  waived: "neutral",
};

function inferredTone(value: string): StatusTone {
  return VALUE_TONE[value.trim().toLowerCase()] ?? "neutral";
}

export function StatusBadge({
  value,
  label,
  tone,
  className,
}: StatusBadgeProps) {
  const rawValue = (value ?? "").trim();
  const display =
    (label ?? "").trim() || (rawValue ? humanizeKey(rawValue) : "");

  if (!display) {
    return <span className="text-muted-foreground">-</span>;
  }

  const resolvedTone = tone ?? inferredTone(rawValue || display);

  return (
    <Badge
      className={cn(
        "whitespace-nowrap border bg-transparent",
        TONE_CLASS[resolvedTone],
        className
      )}
      variant="outline"
    >
      {display}
    </Badge>
  );
}
