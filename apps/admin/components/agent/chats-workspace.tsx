"use client";

import { SparklesIcon } from "@hugeicons/core-free-icons";
import { useCallback, useState } from "react";
import { ChatHistoryPanel } from "@/components/agent/chat-history-panel";
import { ChatThread } from "@/components/agent/chat-thread";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Empty right-panel placeholder
// ---------------------------------------------------------------------------

function ChatsEmptyPanel({ isEn }: { isEn: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-casaora-gradient">
        <Icon className="h-6 w-6 text-white" icon={SparklesIcon} strokeWidth={2} />
      </div>
      <div className="space-y-1 text-center">
        <p className="text-[14px] font-medium text-foreground/70">
          {isEn
            ? "Select a conversation or start a new one"
            : "Selecciona una conversación o inicia una nueva"}
        </p>
        <p className="text-[12px] text-muted-foreground/50">
          {isEn
            ? "Your chat history is on the left"
            : "Tu historial de chats está a la izquierda"}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatsWorkspace — split-pane host
// ---------------------------------------------------------------------------

export function ChatsWorkspace({
  orgId,
  locale,
  firstName,
}: {
  orgId: string;
  locale: Locale;
  firstName?: string;
}) {
  const isEn = locale === "en-US";

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState("");

  const handleSelectChat = useCallback((chatId: string | null) => {
    setSelectedChatId(chatId);
    setFreshKey(Date.now().toString());
  }, []);

  return (
    <div className="-m-3 flex h-[calc(100vh-3.5rem)] sm:-m-4 lg:-m-5 xl:-m-7">
      {/* Left panel — chat list */}
      <div
        className={cn(
          "shrink-0 border-r border-border/30 bg-background",
          // Desktop: fixed width, always visible
          "lg:block lg:w-[400px]",
          // Mobile: full-width when no selection, hidden when viewing a thread
          selectedChatId ? "hidden" : "w-full"
        )}
      >
        <ChatHistoryPanel
          locale={locale}
          onSelectChat={handleSelectChat}
          orgId={orgId}
          selectedChatId={selectedChatId}
        />
      </div>

      {/* Right panel — thread or empty */}
      <div
        className={cn(
          "min-w-0 flex-1 bg-background",
          // Mobile: full-width when selected, hidden when not
          selectedChatId ? "block" : "hidden lg:block"
        )}
      >
        {selectedChatId ? (
          <div className="relative h-full">
            {/* Mobile back button */}
            <div className="absolute top-3 left-3 z-10 lg:hidden">
              <button
                className="flex h-8 items-center gap-1.5 rounded-lg bg-background/80 px-2.5 text-[13px] font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground"
                onClick={() => setSelectedChatId(null)}
                type="button"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                {isEn ? "Back" : "Volver"}
              </button>
            </div>
            <ChatThread
              chatId={selectedChatId}
              firstName={firstName}
              key={selectedChatId + freshKey}
              locale={locale}
              mode="embedded"
              orgId={orgId}
            />
          </div>
        ) : (
          <ChatsEmptyPanel isEn={isEn} />
        )}
      </div>
    </div>
  );
}
