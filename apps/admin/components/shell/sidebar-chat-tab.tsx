"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CHAT_LINKS } from "./sidebar-constants";
import { ShortcutBlock } from "./sidebar-nav-link";
import type { ChatSummaryItem, MemberRole } from "./sidebar-types";
import { isRouteActive, normalizeChatItems } from "./sidebar-utils";

export function SidebarChatTab({
  locale,
  orgId,
  role,
}: {
  locale: Locale;
  orgId: string | null;
  role?: MemberRole | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const isEn = locale === "en-US";
  const queryClient = useQueryClient();

  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatBusyId, setChatBusyId] = useState<string | null>(null);
  const [chatDeleteArmedId, setChatDeleteArmedId] = useState<string | null>(
    null
  );

  const { data: chatData, isLoading: chatLoading } = useQuery({
    queryKey: ["sidebar-chat-data", orgId, showArchivedChats],
    queryFn: async () => {
      if (!orgId) return { chats: [] as ChatSummaryItem[] };

      const response = await fetch(
        `/api/agent/chats?org_id=${encodeURIComponent(orgId)}&archived=${showArchivedChats ? "true" : "false"}&limit=8`,
        {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
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

      return {
        chats: normalizeChatItems(payload),
      };
    },
    enabled: Boolean(orgId),
    retry: false,
  });

  const recentChats = chatData?.chats ?? [];

  const loadChatData = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ["sidebar-chat-data", orgId, showArchivedChats],
    });
  }, [queryClient, orgId, showArchivedChats]);

  const mutateRecentChat = useCallback(
    async (chatId: string, action: "archive" | "restore" | "delete") => {
      if (!orgId) return;
      setChatBusyId(chatId);
      setChatError(null);

      const fallbackErr = isEn
        ? "Chat update failed."
        : "La actualización del chat falló.";
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
          const errMsg = payload.error;
          let displayErr = fallbackErr;
          if (errMsg) {
            displayErr = errMsg;
          }
          setChatError(displayErr);
          setChatBusyId(null);
          return;
        }

        await loadChatData();
        setChatDeleteArmedId(null);
        setChatBusyId(null);
      } catch (err) {
        let errMsg = String(err);
        if (err instanceof Error) {
          errMsg = err.message;
        }
        setChatError(errMsg);
        setChatBusyId(null);
      }
    },
    [isEn, loadChatData, orgId]
  );

  const filteredLinks = CHAT_LINKS.filter(
    (link) => !link.roles || (role && link.roles.includes(role))
  );

  return (
    <div className="space-y-3">
      <ShortcutBlock
        label={{ "es-PY": "Agentes", "en-US": "Agents" }}
        links={filteredLinks}
        locale={locale}
        pathname={pathname}
        search={search}
      />

      <section className="space-y-1.5">
        <div className="flex items-center justify-between px-2">
          <h3 className="font-medium text-[10px] text-sidebar-foreground/40 uppercase tracking-[0.08em]">
            {isEn ? "Recent chats" : "Chats recientes"}
          </h3>
          <button
            className="text-[11px] text-sidebar-foreground/55 hover:text-sidebar-foreground"
            onClick={() => {
              setShowArchivedChats((value) => !value);
              setChatDeleteArmedId(null);
            }}
            type="button"
          >
            {showArchivedChats
              ? isEn
                ? "Active"
                : "Activos"
              : isEn
                ? "Archived"
                : "Archivados"}
          </button>
        </div>

        {chatError ? (
          <p className="px-2 py-1 text-[11px] text-red-400">{chatError}</p>
        ) : null}

        <div className="space-y-0.5">
          {recentChats.map((chat) => (
            <div
              className={cn(
                "group flex items-center gap-1 rounded-lg px-2 py-[5px] transition-all duration-200 ease-in-out",
                isRouteActive(pathname, search, `/app/chats/${chat.id}`)
                  ? "bg-sidebar-accent"
                  : "hover:bg-sidebar-accent/50"
              )}
              key={chat.id}
            >
              <Link
                className="min-w-0 flex-1 text-[12px] text-sidebar-foreground/90"
                href={`/app/chats/${encodeURIComponent(chat.id)}`}
              >
                <div className="truncate font-medium">{chat.title}</div>
                <div className="truncate text-[11px] text-sidebar-foreground/50">
                  {chat.latest_message_preview ||
                    (isEn ? "No messages yet." : "Todavía no hay mensajes.")}
                </div>
              </Link>

              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  className="rounded px-1.5 py-1 text-[10px] text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  disabled={chatBusyId !== null}
                  onClick={() => {
                    const action = chat.is_archived ? "restore" : "archive";
                    mutateRecentChat(chat.id, action).catch(() => undefined);
                  }}
                  type="button"
                >
                  {chat.is_archived
                    ? isEn
                      ? "Restore"
                      : "Rest."
                    : isEn
                      ? "Archive"
                      : "Arch."}
                </button>
                <button
                  className="rounded px-1.5 py-1 text-[10px] text-red-400/85 hover:bg-red-500/10 hover:text-red-400"
                  disabled={chatBusyId !== null}
                  onClick={() => {
                    if (chatDeleteArmedId !== chat.id) {
                      setChatDeleteArmedId(chat.id);
                      return;
                    }
                    mutateRecentChat(chat.id, "delete").catch(() => undefined);
                    setChatDeleteArmedId(null);
                  }}
                  type="button"
                >
                  {chatDeleteArmedId === chat.id
                    ? isEn
                      ? "Confirm"
                      : "Confirmar"
                    : isEn
                      ? "Delete"
                      : "Eliminar"}
                </button>
              </div>
            </div>
          ))}

          {!chatLoading && recentChats.length === 0 ? (
            <p className="px-2 py-1.5 text-[12px] text-sidebar-foreground/50">
              {showArchivedChats
                ? isEn
                  ? "No archived chats."
                  : "No hay chats archivados."
                : isEn
                  ? "No recent chats."
                  : "No hay chats recientes."}
            </p>
          ) : null}
        </div>

        <Link
          className="inline-flex w-full items-center justify-center rounded-lg border border-sidebar-border/50 px-2 py-1.5 text-[12px] text-sidebar-foreground/60 hover:text-sidebar-foreground"
          href={showArchivedChats ? "/app/chats?archived=1" : "/app/chats"}
        >
          {isEn ? "Open full history" : "Abrir historial completo"}
        </Link>
      </section>
    </div>
  );
}
