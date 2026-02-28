"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type AgentMemoryEntry = {
  id: string;
  agent_slug: string;
  memory_tier: string;
  content: string;
  score?: number;
  created_at: string;
};

type MemoryGovernanceProps = {
  orgId: string;
  isEn: boolean;
};

const TIER_STYLES: Record<string, string> = {
  core: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  working: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  episodic: "border-muted-foreground/30 bg-muted/30 text-muted-foreground",
};

const TIER_LABELS: Record<string, { en: string; es: string }> = {
  core: { en: "Key facts", es: "Datos clave" },
  working: { en: "Recent context", es: "Contexto reciente" },
  episodic: { en: "Past interactions", es: "Interacciones pasadas" },
};

export function MemoryGovernance({ orgId, isEn }: MemoryGovernanceProps) {
  const queryClient = useQueryClient();
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  const { data: memories = [], isPending: loading } = useQuery<
    AgentMemoryEntry[]
  >({
    queryKey: ["agent-memory", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/memory?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok) return [];
      const payload = (await res.json()) as { data?: AgentMemoryEntry[] };
      return payload.data ?? [];
    },
    staleTime: 60_000,
  });

  const deleteMemory = useCallback(
    async (memoryId: string) => {
      setDeletingIds((prev) => new Set([...prev, memoryId]));
      try {
        await fetch(
          `/api/agent/memory/${encodeURIComponent(memoryId)}?org_id=${encodeURIComponent(orgId)}`,
          { method: "DELETE", headers: { Accept: "application/json" } }
        );
        queryClient.setQueryData(
          ["agent-memory", orgId],
          (prev: AgentMemoryEntry[] | undefined) =>
            prev ? prev.filter((m) => m.id !== memoryId) : []
        );
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(memoryId);
          return next;
        });
      }
    },
    [orgId, queryClient]
  );

  const grouped = memories.reduce<Record<string, AgentMemoryEntry[]>>(
    (acc, m) => {
      const tier = m.memory_tier || "episodic";
      if (!acc[tier]) acc[tier] = [];
      acc[tier].push(m);
      return acc;
    },
    {}
  );

  return (
    <Card>
      <CardHeader className="space-y-1 border-b border-border/70 pb-4">
        <CardTitle className="text-base">
          {isEn ? "What the AI remembers" : "Lo que la IA recuerda"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "View and manage what the AI knows, organized by importance"
            : "Ver y gestionar lo que la IA sabe, organizado por importancia"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((k) => (
              <Skeleton className="h-14 w-full rounded-xl" key={k} />
            ))}
          </div>
        ) : memories.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground/60">
            {isEn
              ? "No agent memories stored yet."
              : "No hay memorias del agente almacenadas aún."}
          </p>
        ) : (
          Object.entries(grouped).map(([tier, items]) => (
            <div key={tier}>
              <div className="mb-2 flex items-center gap-2">
                <Badge
                  className={cn(
                    "text-[10px]",
                    TIER_STYLES[tier] ?? TIER_STYLES.episodic
                  )}
                  variant="outline"
                >
                  {TIER_LABELS[tier]
                    ? isEn
                      ? TIER_LABELS[tier].en
                      : TIER_LABELS[tier].es
                    : tier}
                </Badge>
                <span className="text-[11px] text-muted-foreground/50">
                  {items.length} {isEn ? "entries" : "entradas"}
                </span>
              </div>
              <div className="space-y-1.5">
                {items.map((memory) => (
                  <div
                    className="flex items-start justify-between gap-3 rounded-xl border border-border/30 bg-muted/10 px-3 py-2.5"
                    key={memory.id}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] text-foreground/80">
                        {memory.content}
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground/50">
                        {memory.agent_slug} &middot;{" "}
                        {new Date(memory.created_at).toLocaleDateString()}
                        {memory.score != null ? (
                          <> &middot; score: {memory.score.toFixed(2)}</>
                        ) : null}
                      </p>
                    </div>
                    <Button
                      className="shrink-0 text-destructive/70 hover:text-destructive"
                      disabled={deletingIds.has(memory.id)}
                      onClick={() => {
                        deleteMemory(memory.id).catch(() => undefined);
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      {isEn ? "Delete" : "Eliminar"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
