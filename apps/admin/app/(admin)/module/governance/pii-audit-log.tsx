"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type PiiIntercept = {
  id: string;
  agent_slug: string;
  pii_type: string;
  action_taken: string;
  detected_at: string;
};

type PiiAuditLogProps = {
  orgId: string;
  isEn: boolean;
};

const ACTION_STYLES: Record<string, string> = {
  redacted:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  blocked: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  allowed:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

export function PiiAuditLog({ orgId, isEn }: PiiAuditLogProps) {
  const { data: intercepts = [], isPending: loading } = useQuery<
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

  return (
    <Card>
      <CardHeader className="space-y-1 border-border/70 border-b pb-4">
        <CardTitle className="text-base">
          {isEn ? "Data Privacy" : "Privacidad de Datos"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Records of personal data detected and handled by the AI"
            : "Registros de datos personales detectados y manejados por la IA"}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {!loading && intercepts.length > 0 && (
          <div className="mb-4 rounded-xl border border-border/30 bg-muted/10 px-4 py-3">
            <p className="text-[13px] text-foreground/80">
              {(() => {
                const total = intercepts.length;
                const redacted = intercepts.filter(
                  (i) => i.action_taken === "redacted"
                ).length;
                const blocked = intercepts.filter(
                  (i) => i.action_taken === "blocked"
                ).length;
                return isEn
                  ? `Your AI has handled ${total} piece${total !== 1 ? "s" : ""} of personal data. ${redacted} redacted, ${blocked} blocked.`
                  : `Tu IA ha manejado ${total} dato${total !== 1 ? "s" : ""} personal${total !== 1 ? "es" : ""}. ${redacted} redactado${redacted !== 1 ? "s" : ""}, ${blocked} bloqueado${blocked !== 1 ? "s" : ""}.`;
              })()}
            </p>
          </div>
        )}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((k) => (
              <Skeleton className="h-12 w-full rounded-xl" key={k} />
            ))}
          </div>
        ) : intercepts.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground/60 text-sm">
            {isEn
              ? "No PII intercepts recorded yet."
              : "No se han registrado intercepciones de PII aún."}
          </p>
        ) : (
          <div className="space-y-2">
            {intercepts.map((item) => (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-border/30 bg-muted/10 px-3 py-2.5"
                key={item.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[13px] text-foreground/90 capitalize">
                      {item.pii_type.replace(/_/g, " ")}
                    </span>
                    <Badge
                      className={cn(
                        "text-[10px]",
                        ACTION_STYLES[item.action_taken] ??
                          ACTION_STYLES.blocked
                      )}
                      variant="outline"
                    >
                      {item.action_taken}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/60">
                    {item.agent_slug} &middot;{" "}
                    {new Date(item.detected_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
