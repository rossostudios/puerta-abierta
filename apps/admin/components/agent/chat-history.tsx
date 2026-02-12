"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AgentChatSummary } from "@/lib/api";
import type { Locale } from "@/lib/i18n";

function normalizeChats(payload: unknown): AgentChatSummary[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((row): row is AgentChatSummary =>
      Boolean(row && typeof row === "object")
    )
    .map((row) => ({
      id: String(row.id ?? ""),
      org_id: String(row.org_id ?? ""),
      agent_id: String(row.agent_id ?? ""),
      agent_slug: String(row.agent_slug ?? ""),
      agent_name: String(row.agent_name ?? ""),
      agent_icon_key:
        typeof row.agent_icon_key === "string" ? row.agent_icon_key : undefined,
      title: String(row.title ?? ""),
      is_archived: Boolean(row.is_archived),
      last_message_at: String(row.last_message_at ?? ""),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      latest_message_preview:
        typeof row.latest_message_preview === "string"
          ? row.latest_message_preview
          : null,
    }))
    .filter((chat) => chat.id && chat.title);
}

function formatDate(value: string, locale: Locale): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const CHAT_SKELETON_KEYS = [
  "chat-skeleton-1",
  "chat-skeleton-2",
  "chat-skeleton-3",
  "chat-skeleton-4",
  "chat-skeleton-5",
  "chat-skeleton-6",
];

export function ChatHistory({
  orgId,
  locale,
  defaultArchived,
}: {
  orgId: string;
  locale: Locale;
  defaultArchived: boolean;
}) {
  const isEn = locale === "en-US";
  const router = useRouter();

  const [archived, setArchived] = useState(defaultArchived);
  const [chats, setChats] = useState<AgentChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyChatId, setBusyChatId] = useState<string | null>(null);
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);

  const loadChats = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/agent/chats?org_id=${encodeURIComponent(orgId)}&archived=${archived ? "true" : "false"}&limit=80`,
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
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error?: unknown }).error)
            : isEn
              ? "Could not load chats."
              : "No se pudieron cargar los chats.";
        throw new Error(message);
      }

      setChats(normalizeChats(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setChats([]);
    } finally {
      setLoading(false);
    }
  }, [archived, isEn, orgId]);

  useEffect(() => {
    loadChats().catch(() => undefined);
  }, [loadChats]);

  const mutateChat = useCallback(
    async (chatId: string, action: "archive" | "restore" | "delete") => {
      setBusyChatId(chatId);
      setError(null);

      try {
        let response: Response;
        if (action === "delete") {
          response = await fetch(
            `/api/agent/chats/${encodeURIComponent(chatId)}?org_id=${encodeURIComponent(orgId)}`,
            {
              method: "DELETE",
              headers: {
                Accept: "application/json",
              },
            }
          );
        } else {
          response = await fetch(
            `/api/agent/chats/${encodeURIComponent(chatId)}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                org_id: orgId,
                action,
              }),
            }
          );
        }

        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(
            payload.error ||
              (isEn
                ? "Chat update failed."
                : "La actualización del chat falló.")
          );
        }

        await loadChats();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyChatId(null);
      }
    },
    [isEn, loadChats, orgId, router]
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{isEn ? "Chats" : "Chats"}</CardTitle>
          <CardDescription>
            {isEn
              ? "Review all conversations by agent, archive old threads, or remove chats permanently."
              : "Revisa conversaciones por agente, archiva hilos anteriores o elimina chats definitivamente."}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setDeleteArmedId(null);
              setArchived((value) => !value);
            }}
            size="sm"
            variant="outline"
          >
            {archived
              ? isEn
                ? "Show active"
                : "Ver activos"
              : isEn
                ? "Show archived"
                : "Ver archivados"}
          </Button>
          <Button onClick={() => router.push("/app/agents?new=1")} size="sm">
            {isEn ? "New chat" : "Nuevo chat"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>
              {isEn ? "Request failed" : "Solicitud fallida"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div className="space-y-2">
            {CHAT_SKELETON_KEYS.map((key) => (
              <div className="rounded-xl border p-3" key={key}>
                <Skeleton className="mb-2 h-4 w-40" />
                <Skeleton className="h-3 w-72" />
              </div>
            ))}
          </div>
        ) : chats.length === 0 ? (
          <div className="rounded-xl border border-dashed p-5 text-muted-foreground text-sm">
            {archived
              ? isEn
                ? "No archived chats yet."
                : "Todavía no hay chats archivados."
              : isEn
                ? "No active chats yet. Start one from Agents."
                : "Todavía no hay chats activos. Inicia uno desde Agentes."}
          </div>
        ) : (
          <div className="space-y-2">
            {chats.map((chat) => (
              <div
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3"
                key={chat.id}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="truncate font-semibold text-sm hover:underline"
                      href={`/app/chats/${encodeURIComponent(chat.id)}`}
                    >
                      {chat.title}
                    </Link>
                    <Badge variant="outline">{chat.agent_name}</Badge>
                  </div>
                  <p className="line-clamp-2 text-muted-foreground text-xs">
                    {chat.latest_message_preview ||
                      (isEn ? "No messages yet." : "Todavía no hay mensajes.")}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {isEn ? "Updated" : "Actualizado"}:{" "}
                    {formatDate(chat.last_message_at, locale)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() =>
                      router.push(`/app/chats/${encodeURIComponent(chat.id)}`)
                    }
                    size="sm"
                    variant="outline"
                  >
                    {isEn ? "Open" : "Abrir"}
                  </Button>
                  <Button
                    disabled={busyChatId !== null}
                    onClick={() => {
                      const nextAction = chat.is_archived
                        ? "restore"
                        : "archive";
                      mutateChat(chat.id, nextAction).catch(() => undefined);
                    }}
                    size="sm"
                    variant="outline"
                  >
                    {busyChatId === chat.id
                      ? isEn
                        ? "Saving..."
                        : "Guardando..."
                      : chat.is_archived
                        ? isEn
                          ? "Restore"
                          : "Restaurar"
                        : isEn
                          ? "Archive"
                          : "Archivar"}
                  </Button>
                  {deleteArmedId === chat.id ? (
                    <Button
                      disabled={busyChatId !== null}
                      onClick={() => setDeleteArmedId(null)}
                      size="sm"
                      variant="outline"
                    >
                      {isEn ? "Cancel" : "Cancelar"}
                    </Button>
                  ) : null}
                  <Button
                    disabled={busyChatId !== null}
                    onClick={() => {
                      if (deleteArmedId !== chat.id) {
                        setDeleteArmedId(chat.id);
                        return;
                      }
                      mutateChat(chat.id, "delete").catch(() => undefined);
                      setDeleteArmedId(null);
                    }}
                    size="sm"
                    variant="destructive"
                  >
                    {deleteArmedId === chat.id
                      ? isEn
                        ? "Confirm"
                        : "Confirmar"
                      : isEn
                        ? "Delete"
                        : "Eliminar"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
