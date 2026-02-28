"use client";

import {
  ArrowLeft02Icon,
  Delete02Icon,
  InboxIcon,
  Message01Icon,
  MoreVerticalIcon,
  Search01Icon,
  UndoIcon,
} from "@hugeicons/core-free-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentChatSummary } from "@/lib/api";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function fetchChats(
  orgId: string,
  archived: boolean
): Promise<AgentChatSummary[]> {
  const archivedParam = archived ? "true" : "false";
  const response = await fetch(
    `/api/agent/chats?org_id=${encodeURIComponent(orgId)}&archived=${archivedParam}&limit=80`,
    {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }
  );
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    let message = "Could not load chats.";
    if (payload != null && typeof payload === "object" && "error" in payload) {
      message = String((payload as { error?: unknown }).error);
    }
    throw new Error(message);
  }

  return normalizeChats(payload);
}

function relativeTime(dateStr: string, isEn: boolean): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return isEn ? "Just now" : "Ahora";
  if (mins < 60) return isEn ? `${mins}m ago` : `hace ${mins}m`;
  const hrs = Math.floor(diffMs / 3_600_000);
  if (hrs < 24) return isEn ? `${hrs}h ago` : `hace ${hrs}h`;
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 1) return isEn ? "Yesterday" : "Ayer";
  if (days < 7) return isEn ? `${days}d ago` : `hace ${days}d`;
  return new Intl.DateTimeFormat(isEn ? "en-US" : "es-PY", {
    month: "short",
    day: "numeric",
  }).format(new Date(dateStr));
}

// ---------------------------------------------------------------------------
// Skeleton keys
// ---------------------------------------------------------------------------

const SKELETON_KEYS = [
  "skel-1",
  "skel-2",
  "skel-3",
  "skel-4",
  "skel-5",
  "skel-6",
  "skel-7",
  "skel-8",
];

// ---------------------------------------------------------------------------
// ChatListItem
// ---------------------------------------------------------------------------

function ChatListItem({
  chat,
  isSelected,
  isEn,
  busyChatId,
  deleteArmedId,
  onSelect,
  onArchive,
  onRestore,
  onDeleteArm,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  chat: AgentChatSummary;
  isSelected: boolean;
  isEn: boolean;
  busyChatId: string | null;
  deleteArmedId: string | null;
  onSelect: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDeleteArm: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  const statusColor = chat.is_archived
    ? "bg-muted-foreground/30"
    : chat.latest_message_preview
      ? "bg-emerald-500"
      : "bg-blue-500";

  return (
    <button
      className={cn(
        "group/item relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        isSelected ? "glass-inner" : "hover:bg-muted/40"
      )}
      onClick={onSelect}
      type="button"
    >
      {/* Status dot */}
      <span
        className={cn("mt-[7px] h-2 w-2 shrink-0 rounded-full", statusColor)}
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-[13px] text-foreground/90">
            {chat.title}
          </span>
          <Badge
            className="shrink-0 text-[10px] leading-none"
            variant="outline"
          >
            {chat.agent_name}
          </Badge>
        </div>
        <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground/60">
          {chat.latest_message_preview ||
            (isEn ? "No messages yet" : "Sin mensajes aún")}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/40">
          {relativeTime(chat.last_message_at || chat.updated_at, isEn)}
        </p>
      </div>

      {/* Three-dot menu */}
      <div
        className={cn(
          "shrink-0 opacity-0 transition-opacity",
          isSelected ? "opacity-100" : "group-hover/item:opacity-100"
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon icon={MoreVerticalIcon} size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
            {chat.is_archived ? (
              <DropdownMenuItem
                disabled={busyChatId !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore();
                }}
              >
                <Icon className="mr-2 h-3.5 w-3.5" icon={UndoIcon} />
                {isEn ? "Restore" : "Restaurar"}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={busyChatId !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  onArchive();
                }}
              >
                <Icon className="mr-2 h-3.5 w-3.5" icon={InboxIcon} />
                {isEn ? "Archive" : "Archivar"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {deleteArmedId === chat.id ? (
              <>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={busyChatId !== null}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConfirm();
                  }}
                >
                  <Icon className="mr-2 h-3.5 w-3.5" icon={Delete02Icon} />
                  {isEn ? "Confirm delete" : "Confirmar"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteCancel();
                  }}
                >
                  {isEn ? "Cancel" : "Cancelar"}
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={busyChatId !== null}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteArm();
                }}
              >
                <Icon className="mr-2 h-3.5 w-3.5" icon={Delete02Icon} />
                {isEn ? "Delete" : "Eliminar"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// ChatHistoryPanel
// ---------------------------------------------------------------------------

export function ChatHistoryPanel({
  orgId,
  locale,
  selectedChatId,
  onSelectChat,
}: {
  orgId: string;
  locale: Locale;
  selectedChatId: string | null;
  onSelectChat: (chatId: string | null) => void;
}) {
  const isEn = locale === "en-US";
  const queryClient = useQueryClient();

  const [archived, setArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);

  // -- Data -----------------------------------------------------------------

  const chatsQuery = useQuery<AgentChatSummary[], Error>({
    queryKey: ["agent-chats", orgId, archived],
    queryFn: () => fetchChats(orgId, archived),
  });

  const chats = chatsQuery.data ?? [];
  const loading = chatsQuery.isLoading;
  const error = chatsQuery.error?.message ?? null;

  // -- Derived unique agents for filter ------------------------------------

  const uniqueAgents = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of chats) {
      if (!seen.has(c.agent_slug)) seen.set(c.agent_slug, c.agent_name);
    }
    return Array.from(seen.entries()).map(([slug, name]) => ({ slug, name }));
  }, [chats]);

  const [agentFilter, setAgentFilter] = useState("all");

  // -- Client-side filtering -----------------------------------------------

  const filteredChats = useMemo(() => {
    let result = chats;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.agent_name.toLowerCase().includes(q) ||
          (c.latest_message_preview?.toLowerCase().includes(q) ?? false)
      );
    }
    if (agentFilter !== "all") {
      result = result.filter((c) => c.agent_slug === agentFilter);
    }
    return result;
  }, [chats, searchQuery, agentFilter]);

  // -- Mutations ------------------------------------------------------------

  const mutateChatMutation = useMutation<
    void,
    Error,
    { chatId: string; action: "archive" | "restore" | "delete" }
  >({
    mutationFn: async ({ chatId, action }) => {
      let response: Response;
      if (action === "delete") {
        response = await fetch(
          `/api/agent/chats/${encodeURIComponent(chatId)}?org_id=${encodeURIComponent(orgId)}`,
          { method: "DELETE", headers: { Accept: "application/json" } }
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
            body: JSON.stringify({ org_id: orgId, action }),
          }
        );
      }
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(
          payload.error ||
            (isEn ? "Chat update failed." : "La actualización del chat falló.")
        );
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["agent-chats", orgId],
      });
      queryClient.invalidateQueries({
        queryKey: ["sidebar-chat-data", orgId],
      });
      if (variables.chatId === selectedChatId) {
        onSelectChat(null);
      }
    },
  });

  const busyChatId = mutateChatMutation.isPending
    ? (mutateChatMutation.variables?.chatId ?? null)
    : null;

  const mutationError = mutateChatMutation.error?.message ?? null;

  // -- Render ---------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      {/* Sticky header */}
      <div className="shrink-0 space-y-3 border-border/30 border-b p-4 pb-3">
        {/* Title row */}
        <div className="flex items-center">
          <h2 className="font-semibold text-base text-foreground/90">
            {isEn ? "Chats" : "Chats"}
          </h2>
        </div>

        {/* Search */}
        <div className="relative">
          <Icon
            className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50"
            icon={Search01Icon}
          />
          <Input
            className="h-8 pl-8 text-[13px]"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isEn ? "Search chats..." : "Buscar chats..."}
            value={searchQuery}
          />
        </div>

        {/* Active / Archived segment */}
        <Tabs
          onValueChange={(v) => {
            setArchived(v === "archived");
            setDeleteArmedId(null);
          }}
          value={archived ? "archived" : "active"}
        >
          <TabsList className="w-full" variant="default">
            <TabsTrigger value="active">
              {isEn ? "Active" : "Activos"}
            </TabsTrigger>
            <TabsTrigger value="archived">
              {isEn ? "Archived" : "Archivados"}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Agent filter (only when >1 agent) */}
        {uniqueAgents.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              className={cn(
                "rounded-full px-2.5 py-0.5 font-medium text-[11px] transition-colors",
                agentFilter === "all"
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground"
              )}
              onClick={() => setAgentFilter("all")}
              type="button"
            >
              {isEn ? "All" : "Todos"}
            </button>
            {uniqueAgents.map((a) => (
              <button
                className={cn(
                  "rounded-full px-2.5 py-0.5 font-medium text-[11px] transition-colors",
                  agentFilter === a.slug
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground/60 hover:text-foreground"
                )}
                key={a.slug}
                onClick={() =>
                  setAgentFilter(agentFilter === a.slug ? "all" : a.slug)
                }
                type="button"
              >
                {a.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Error banner */}
      {error || mutationError ? (
        <div className="shrink-0 px-4 pt-3">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-destructive/10 px-3 py-2">
            <p className="text-[12px] text-destructive">
              {mutationError
                ? isEn
                  ? "Something went wrong. Please try again."
                  : "Algo salió mal. Intenta de nuevo."
                : isEn
                  ? "Unable to load history."
                  : "No se pudo cargar el historial."}
            </p>
            {error ? (
              <button
                className="shrink-0 font-medium text-[12px] text-destructive underline underline-offset-2 transition-opacity hover:opacity-70"
                onClick={() => chatsQuery.refetch()}
                type="button"
              >
                {isEn ? "Retry" : "Reintentar"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-1.5 p-2">
            {SKELETON_KEYS.map((key) => (
              <div className="space-y-2 rounded-xl p-3" key={key}>
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-52" />
              </div>
            ))}
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50">
              <Icon
                className="h-5 w-5 text-muted-foreground/40"
                icon={Message01Icon}
              />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-[13px] text-muted-foreground/60">
                {searchQuery.trim()
                  ? isEn
                    ? "No matching chats"
                    : "Sin chats coincidentes"
                  : archived
                    ? isEn
                      ? "No archived chats"
                      : "Sin chats archivados"
                    : isEn
                      ? "No chats yet"
                      : "Sin chats aún"}
              </p>
              <p className="text-[12px] text-muted-foreground/40">
                {searchQuery.trim()
                  ? isEn
                    ? "Try a different search term"
                    : "Prueba otro término de búsqueda"
                  : isEn
                    ? "Start a conversation from the Agents page"
                    : "Inicia una conversación desde la página de Agentes"}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredChats.map((chat) => (
              <ChatListItem
                busyChatId={busyChatId}
                chat={chat}
                deleteArmedId={deleteArmedId}
                isEn={isEn}
                isSelected={selectedChatId === chat.id}
                key={chat.id}
                onArchive={() =>
                  mutateChatMutation.mutate({
                    chatId: chat.id,
                    action: "archive",
                  })
                }
                onDeleteArm={() => setDeleteArmedId(chat.id)}
                onDeleteCancel={() => setDeleteArmedId(null)}
                onDeleteConfirm={() => {
                  mutateChatMutation.mutate({
                    chatId: chat.id,
                    action: "delete",
                  });
                  setDeleteArmedId(null);
                }}
                onRestore={() =>
                  mutateChatMutation.mutate({
                    chatId: chat.id,
                    action: "restore",
                  })
                }
                onSelect={() => onSelectChat(chat.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Mobile back button (visible when a chat is selected on < lg) */}
      {selectedChatId ? (
        <div className="shrink-0 border-border/30 border-t p-3 lg:hidden">
          <Button
            className="w-full gap-2"
            onClick={() => onSelectChat(null)}
            size="sm"
            variant="ghost"
          >
            <Icon className="h-3.5 w-3.5" icon={ArrowLeft02Icon} />
            {isEn ? "Back to list" : "Volver a la lista"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
