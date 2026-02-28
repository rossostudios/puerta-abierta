"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type StatusDashboardProps = {
  orgId: string;
  isEn: boolean;
};

type SecurityMetrics = {
  boundary_violations: number;
  pii_intercepts: number;
};

type Approval = {
  id: string;
  status: string;
};

type PiiIntercept = {
  id: string;
};

export function StatusDashboard({ orgId, isEn }: StatusDashboardProps) {
  const { data: approvals = [], isPending: loadingApprovals } = useQuery<
    Approval[]
  >({
    queryKey: ["agent-approvals", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/approvals?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as { data?: Approval[] };
      return payload.data ?? [];
    },
    staleTime: 30_000,
  });

  const { data: securityMetrics, isPending: loadingSecurity } =
    useQuery<SecurityMetrics>({
      queryKey: ["security-audit", orgId],
      queryFn: async () => {
        const res = await fetch(
          `/api/agent/security-audit?org_id=${encodeURIComponent(orgId)}`,
          { cache: "no-store", headers: { Accept: "application/json" } }
        );
        if (!res.ok) return { boundary_violations: 0, pii_intercepts: 0 };
        return (await res.json()) as SecurityMetrics;
      },
      staleTime: 60_000,
    });

  const { data: piiIntercepts = [], isPending: loadingPii } = useQuery<
    PiiIntercept[]
  >({
    queryKey: ["pii-intercepts", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/pii-intercepts?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as { data?: PiiIntercept[] };
      return payload.data ?? [];
    },
    staleTime: 60_000,
  });

  const loading = loadingApprovals || loadingSecurity || loadingPii;

  if (loading) {
    return <Skeleton className="h-24 w-full rounded-2xl" />;
  }

  const pendingCount = approvals.filter((a) => a.status === "pending").length;
  const violations = securityMetrics?.boundary_violations ?? 0;
  const piiCount = piiIntercepts.length;

  const isGreen = pendingCount === 0 && violations === 0;

  const PILLS = [
    {
      labelEn: "Pending approvals",
      labelEs: "Aprobaciones pendientes",
      value: pendingCount,
      warn: pendingCount > 0,
    },
    {
      labelEn: "Boundary violations",
      labelEs: "Violaciones de limites",
      value: violations,
      warn: violations > 0,
    },
    {
      labelEn: "PII intercepts",
      labelEs: "Intercepciones PII",
      value: piiCount,
      warn: false,
    },
  ];

  return (
    <div
      className={cn(
        "rounded-2xl p-5 shadow-casaora",
        isGreen
          ? "border border-emerald-500/20 bg-emerald-500/5 dark:border-emerald-500/15 dark:bg-emerald-950/20"
          : "border border-amber-500/20 bg-amber-500/5 dark:border-amber-500/15 dark:bg-amber-950/20"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-3 w-3 shrink-0 rounded-full",
            isGreen
              ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
              : "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
          )}
        />
        <p className="font-semibold text-base text-foreground">
          {isGreen
            ? isEn
              ? "AI is operating within safe limits"
              : "La IA opera dentro de los limites seguros"
            : isEn
              ? `${pendingCount + violations} action${pendingCount + violations !== 1 ? "s" : ""} need${pendingCount + violations === 1 ? "s" : ""} your review`
              : `${pendingCount + violations} accion${pendingCount + violations !== 1 ? "es" : ""} necesita${pendingCount + violations !== 1 ? "n" : ""} tu revisión`}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {PILLS.map((pill) => (
          <div
            className={cn(
              "rounded-xl border px-3 py-2.5 text-center",
              pill.warn
                ? "border-amber-500/30 bg-amber-500/10 dark:border-amber-500/20 dark:bg-amber-950/30"
                : "border-border/30 bg-secondary/50 dark:border-border/20 dark:bg-secondary/30"
            )}
            key={pill.labelEn}
          >
            <p
              className={cn(
                "font-bold text-2xl tabular-nums",
                pill.warn
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-foreground"
              )}
            >
              {pill.value}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {isEn ? pill.labelEn : pill.labelEs}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
