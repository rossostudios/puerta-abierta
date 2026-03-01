import { ArrowDown01Icon, ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/* ── Types ── */

export type ApprovalActivity = {
  agent_slug?: string | null;
  tool_name: string;
  status: string;
  created_at: string;
  reasoning?: string | null;
  property_name?: string | null;
};

export type ArrivalDeparture = {
  guest_name: string;
  unit_code: string;
  check_in_time?: string;
  check_out_time?: string;
  property_name?: string;
};

export type AgentStatus = {
  slug: string;
  status: "active" | "idle" | "error";
  last_active_at?: string;
};

export type PropertyRevenue = {
  name: string;
  type: "ltr" | "str";
  revenue: number;
  units: number;
  occupied_units?: number;
  occupancy?: number;
};

export type MaintenanceItem = {
  title: string;
  category: string;
  urgency: string;
  property_name?: string;
  unit_code?: string;
};

export type LeaseRenewal = {
  tenant_name: string;
  ends_on: string;
  property_name?: string;
  unit_code?: string;
};

export type TaskItem = {
  title: string;
  type: string;
  status: string;
  due_at?: string;
  property_name?: string;
  unit_code?: string;
};

export type OnboardingStatus = {
  has_properties: boolean;
  has_integrations: boolean;
  has_tenants_or_guests: boolean;
  has_ai_config: boolean;
};

export type Stats = {
  agents?: { total?: number; active?: number };
  approvals_24h?: {
    total?: number;
    pending?: number;
    approved?: number;
    rejected?: number;
  };
  memory_count?: number;
  recent_activity?: ApprovalActivity[];
  agent_statuses?: AgentStatus[];
  planning?: { total?: number; completed?: number; failed?: number };
  total_properties?: number;
  total_units?: number;
  occupied_units?: number;
  blended_occupancy?: number;
  revenue_mtd?: number;
  prev_month_occupancy?: number;
  prev_month_revenue?: number;
  arrivals_today?: number;
  departures_today?: number;
  in_house?: number;
  todays_arrivals?: ArrivalDeparture[];
  todays_departures?: ArrivalDeparture[];
  open_tickets?: number;
  dispatched?: number;
  avg_resolution_hrs?: number;
  property_revenue?: PropertyRevenue[];
  maintenance_items?: MaintenanceItem[];
  lease_renewals?: LeaseRenewal[];
  statements_ready?: { count: number; total_payout: number };
  todays_tasks?: TaskItem[];
  onboarding?: OnboardingStatus;
};

/* ── Helpers ── */

export function statusTone(s: string) {
  if (s === "approved") return "status-tone-success";
  if (s === "rejected") return "status-tone-danger";
  if (s === "pending") return "status-tone-warning";
  return "status-tone-neutral";
}

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function getGreeting(isEn: boolean, firstName?: string): string {
  const hour = new Date().getHours();
  const name = firstName || "there";
  if (hour < 12) return isEn ? `Good morning, ${name}` : `Buenos días, ${name}`;
  if (hour < 17)
    return isEn ? `Good afternoon, ${name}` : `Buenas tardes, ${name}`;
  return isEn ? `Good evening, ${name}` : `Buenas noches, ${name}`;
}

export function fmtPyg(n: number): string {
  return n >= 1_000_000
    ? `₲${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `₲${(n / 1000).toFixed(0)}K`
      : `₲${n}`;
}

/* ── Constants ── */

export const CARD = "glass-liquid rounded-2xl";
export const EASING = [0.22, 1, 0.36, 1] as const;

/* ── Shared Components ── */

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-medium text-[11px] text-muted-foreground/70 uppercase tracking-[0.15em]">
      {children}
    </p>
  );
}

export function TrendBadge({
  current,
  previous,
  suffix = "%",
}: {
  current: number;
  previous: number | undefined;
  suffix?: string;
}) {
  if (previous === undefined || previous === 0) return null;
  const delta = current - previous;
  if (delta === 0) return null;
  const pct = Math.round((delta / previous) * 100);
  const up = delta > 0;
  return (
    <span
      className={cn(
        "ml-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium text-[10px] tabular-nums",
        up
          ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400"
          : "bg-destructive/10 text-destructive"
      )}
    >
      <Icon icon={up ? ArrowUp01Icon : ArrowDown01Icon} size={10} />
      {Math.abs(pct)}
      {suffix}
    </span>
  );
}
