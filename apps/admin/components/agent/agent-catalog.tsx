"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AgentDefinition } from "@/lib/api";
import type { Locale } from "@/lib/i18n";

function normalizeAgents(payload: unknown): AgentDefinition[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((item): item is AgentDefinition =>
      Boolean(item && typeof item === "object")
    )
    .map((item) => ({
      id: String(item.id ?? ""),
      slug: String(item.slug ?? ""),
      name: String(item.name ?? ""),
      description: String(item.description ?? ""),
      icon_key: typeof item.icon_key === "string" ? item.icon_key : undefined,
      is_active: Boolean(item.is_active ?? true),
    }))
    .filter((item) => item.id && item.slug && item.name);
}

export function AgentCatalog({
  orgId,
  locale,
}: {
  orgId: string;
  locale: Locale;
}) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const autoStartTriggered = useRef<boolean>(false);
  // Default to Guest Concierge for the unified experience
  const targetAgentSlug = "guest-concierge";

  const agentsQuery = useQuery({
    queryKey: ["agents", orgId],
    queryFn: async () => {
      const fallbackMsg = isEn
        ? "Could not load agents."
        : "No se pudieron cargar los agentes.";

      const response = await fetch(
        `/api/agent/agents?org_id=${encodeURIComponent(orgId)}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        }
      );

      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        let message = fallbackMsg;
        if (
          payload != null &&
          typeof payload === "object" &&
          "error" in payload
        ) {
          message = String((payload as { error?: unknown }).error);
        }
        throw new Error(message);
      }

      return normalizeAgents(payload);
    },
  });

  const agents = agentsQuery.data ?? [];
  const loading = agentsQuery.isLoading;

  const createChatMutation = useMutation({
    mutationFn: async (agentSlug: string) => {
      const fallbackMsg = isEn
        ? "Could not create chat."
        : "No se pudo crear el chat.";

      const response = await fetch("/api/agent/chats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          org_id: orgId,
          agent_slug: agentSlug,
        }),
      });

      const payload = (await response.json()) as {
        id?: string;
        error?: string;
      };

      if (!(response.ok && payload.id)) {
        throw new Error(payload.error || fallbackMsg);
      }

      return payload.id;
    },
    onSuccess: (chatId) => {
      router.push(`/app/chats/${encodeURIComponent(chatId)}`);
      router.refresh();
    },
  });

  const error =
    agentsQuery.error?.message ?? createChatMutation.error?.message ?? null;
  const _creatingSlug = createChatMutation.isPending
    ? (createChatMutation.variables ?? null)
    : null;

  useEffect(() => {
    if (loading || autoStartTriggered.current) {
      return;
    }

    if (!agents.length) {
      return;
    }

    const target =
      agents.find((agent) => agent.slug === targetAgentSlug) || agents[0];

    if (!target) {
      return;
    }

    autoStartTriggered.current = true;
    createChatMutation.mutate(target.slug, {
      onError: () => {
        autoStartTriggered.current = false;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, agents, createChatMutation]);

  return (
    <div className="flex flex-col items-center justify-center space-y-4 p-12">
      {error ? (
        <Alert className="w-full max-w-md" variant="destructive">
          <AlertTitle>{isEn ? "Error" : "Error"}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {!error && (
        <div className="flex animate-pulse flex-col items-center space-y-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-sidebar-primary border-t-transparent" />
          <p className="font-medium text-muted-foreground text-sm">
            {isEn ? "Creating Chat..." : "Creando Chat..."}
          </p>
        </div>
      )}
    </div>
  );
}
