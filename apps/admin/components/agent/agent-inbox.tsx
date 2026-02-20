"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/lib/i18n";

type AgentInboxItem = {
  id: string;
  kind: "approval" | "anomaly" | "task" | "lease" | "application";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  body: string;
  link_path: string | null;
  created_at: string;
};

type AgentInboxProps = {
  orgId: string;
  locale: Locale;
};

function normalizeItems(payload: unknown): AgentInboxItem[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];

  return data
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: String(item.id ?? ""),
      kind: String(item.kind ?? "task") as AgentInboxItem["kind"],
      priority: String(item.priority ?? "medium") as AgentInboxItem["priority"],
      title: String(item.title ?? ""),
      body: String(item.body ?? ""),
      link_path: typeof item.link_path === "string" ? item.link_path : null,
      created_at: String(item.created_at ?? ""),
    }))
    .filter((item) => item.id && item.title);
}

function priorityVariant(priority: AgentInboxItem["priority"]): "default" | "secondary" | "destructive" | "outline" {
  if (priority === "critical") return "destructive";
  if (priority === "high") return "default";
  if (priority === "medium") return "secondary";
  return "outline";
}

export function AgentInbox({ orgId, locale }: AgentInboxProps) {
  const isEn = locale === "en-US";

  const inboxQuery = useQuery<AgentInboxItem[], Error>({
    queryKey: ["agent-inbox", orgId],
    queryFn: async () => {
      const response = await fetch(
        `/api/agent/inbox?org_id=${encodeURIComponent(orgId)}&limit=50`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }
      );
      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const fallback = isEn ? "Could not load inbox." : "No se pudo cargar la bandeja.";
        const msg =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error)
            : fallback;
        throw new Error(msg);
      }
      return normalizeItems(payload);
    },
    refetchInterval: 30_000,
  });

  const items = inboxQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEn ? "Agent inbox" : "Bandeja de agente"}</CardTitle>
        <CardDescription>
          {isEn
            ? "Approvals, anomalies, and operational items prioritized for action."
            : "Aprobaciones, anomalias y elementos operativos priorizados para accion."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {inboxQuery.error ? (
          <Alert variant="destructive">
            <AlertTitle>{isEn ? "Request failed" : "Solicitud fallida"}</AlertTitle>
            <AlertDescription>{inboxQuery.error.message}</AlertDescription>
          </Alert>
        ) : null}

        {inboxQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
            {isEn ? "No inbox items right now." : "No hay elementos en la bandeja ahora."}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div className="rounded-xl border p-3" key={`${item.kind}-${item.id}`}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant={priorityVariant(item.priority)}>
                    {item.priority.toUpperCase()}
                  </Badge>
                  <Badge variant="outline">{item.kind}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(item.created_at).toLocaleString(locale)}
                  </span>
                </div>
                <p className="font-medium text-sm">{item.title}</p>
                <p className="mt-1 text-muted-foreground text-xs">{item.body}</p>
                {item.link_path ? (
                  <Link className="mt-2 inline-block text-primary text-xs hover:underline" href={item.link_path}>
                    {isEn ? "Open" : "Abrir"}
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
