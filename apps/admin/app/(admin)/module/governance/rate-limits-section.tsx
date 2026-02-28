"use client";

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { authedFetch } from "@/lib/api-client";

type RateLimitConfig = {
  id: string;
  agent_slug: string;
  max_requests_per_minute: number;
  max_requests_per_hour: number;
};

type RateLimitsSectionProps = {
  orgId: string;
  isEn: boolean;
};

export function RateLimitsSection({ orgId, isEn }: RateLimitsSectionProps) {
  const queryClient = useQueryClient();
  const [savingRateLimit, setSavingRateLimit] = useState(false);
  const [rateLimitDraft, setRateLimitDraft] = useState<{
    max_requests_per_minute: string;
    max_requests_per_hour: string;
  } | null>(null);

  const { data: rateLimit, isPending: loadingRateLimit } =
    useQuery<RateLimitConfig | null>({
      queryKey: ["rate-limit-config", orgId],
      queryFn: async () => {
        try {
          const payload = await authedFetch<{ data?: RateLimitConfig }>(
            `/agent/rate-limit-config?org_id=${encodeURIComponent(orgId)}`
          );
          return payload.data ?? null;
        } catch {
          return null;
        }
      },
      staleTime: 60_000,
    });

  const saveRateLimit = useCallback(async () => {
    if (!rateLimitDraft) return;
    setSavingRateLimit(true);
    try {
      await authedFetch(
        `/agent/rate-limit-config?org_id=${encodeURIComponent(orgId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            max_requests_per_minute: Number(
              rateLimitDraft.max_requests_per_minute
            ),
            max_requests_per_hour: Number(rateLimitDraft.max_requests_per_hour),
          }),
        }
      );

      queryClient.setQueryData(
        ["rate-limit-config", orgId],
        (prev: RateLimitConfig | null | undefined) => ({
          ...(prev ?? { id: "default", agent_slug: "*" }),
          max_requests_per_minute: Number(
            rateLimitDraft.max_requests_per_minute
          ),
          max_requests_per_hour: Number(rateLimitDraft.max_requests_per_hour),
        })
      );
      setRateLimitDraft(null);
    } finally {
      setSavingRateLimit(false);
    }
  }, [orgId, rateLimitDraft, queryClient]);

  return (
    <Card>
      <CardHeader className="space-y-1 border-b border-border/70 pb-4">
        <CardTitle className="text-base">
          {isEn ? "Rate Limits" : "Limites de Frecuencia"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Configure maximum request rates per agent to prevent runaway automation"
            : "Configura las tasas maximas de solicitudes por agente para prevenir automatizacion descontrolada"}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {loadingRateLimit ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : (
          <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  {isEn
                    ? "Max requests / minute"
                    : "Max solicitudes / minuto"}
                </label>
                <Input
                  className="h-9 font-mono text-sm"
                  min={1}
                  onChange={(e) =>
                    setRateLimitDraft((prev) => ({
                      max_requests_per_minute: e.target.value,
                      max_requests_per_hour:
                        prev?.max_requests_per_hour ??
                        String(rateLimit?.max_requests_per_hour ?? 600),
                    }))
                  }
                  placeholder="60"
                  type="number"
                  value={
                    rateLimitDraft?.max_requests_per_minute ??
                    String(rateLimit?.max_requests_per_minute ?? 60)
                  }
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  {isEn ? "Max requests / hour" : "Max solicitudes / hora"}
                </label>
                <Input
                  className="h-9 font-mono text-sm"
                  min={1}
                  onChange={(e) =>
                    setRateLimitDraft((prev) => ({
                      max_requests_per_minute:
                        prev?.max_requests_per_minute ??
                        String(rateLimit?.max_requests_per_minute ?? 60),
                      max_requests_per_hour: e.target.value,
                    }))
                  }
                  placeholder="600"
                  type="number"
                  value={
                    rateLimitDraft?.max_requests_per_hour ??
                    String(rateLimit?.max_requests_per_hour ?? 600)
                  }
                />
              </div>
            </div>
            {rateLimitDraft ? (
              <div className="mt-3 flex items-center gap-2">
                <Button
                  disabled={savingRateLimit}
                  onClick={() => {
                    saveRateLimit().catch(() => undefined);
                  }}
                  size="sm"
                  variant="outline"
                >
                  {savingRateLimit ? "..." : isEn ? "Save" : "Guardar"}
                </Button>
                <Button
                  disabled={savingRateLimit}
                  onClick={() => setRateLimitDraft(null)}
                  size="sm"
                  variant="ghost"
                >
                  {isEn ? "Cancel" : "Cancelar"}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
