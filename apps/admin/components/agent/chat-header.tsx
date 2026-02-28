"use client";

import {
  ArrowLeft02Icon,
  Clock02Icon,
  Delete01Icon,
  PlusSignIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";

import { getModelDisplayName } from "@/components/agent/model-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { AgentDefinition, AgentModelOption } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ChatHeader({
  chatTitle,
  loading,
  isSending,
  isEn,
  isChatDetailRoute,
  isEmbedded,
  isArchived,
  busy,
  modelOptions,
  selectedModel,
  primaryModel,
  modelBusy,
  deleteArmed,
  onModelChange,
  onNewThread,
  onHistoryClick,
  onArchiveToggle,
  onDeleteArm,
  onDeleteConfirm,
  onDeleteCancel,
  agents,
  selectedAgentSlug,
  onAgentChange,
  selectedAgentName,
}: {
  chatTitle?: string;
  loading: boolean;
  isSending: boolean;
  isEn: boolean;
  isChatDetailRoute: boolean;
  isEmbedded: boolean;
  isArchived?: boolean;
  busy: boolean;
  modelOptions: AgentModelOption[];
  selectedModel: string;
  primaryModel: string;
  modelBusy: boolean;
  deleteArmed: boolean;
  onModelChange: (model: string) => void;
  onNewThread: () => void;
  onHistoryClick: () => void;
  onArchiveToggle: () => void;
  onDeleteArm: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  agents?: AgentDefinition[];
  selectedAgentSlug?: string;
  onAgentChange?: (slug: string) => void;
  selectedAgentName?: string;
}) {
  const activeAgents = agents?.filter((a) => a.is_active !== false) ?? [];

  return (
    <div
      className={cn(
        "glass-chrome sticky top-0 z-10 flex shrink-0 items-center justify-between px-4 py-2.5 sm:px-5",
        isEmbedded && "bg-card/95"
      )}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {loading ? (
            <Skeleton className="h-6 w-36 rounded-lg" />
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-[8px] bg-casaora-gradient text-white shadow-casaora">
                  <Icon className="h-3 w-3" icon={SparklesIcon} />
                </div>

                {/* Agent selector dropdown (only in non-detail routes with multiple agents) */}
                {!isChatDetailRoute &&
                activeAgents.length > 1 &&
                onAgentChange ? (
                  <PopoverRoot>
                    <PopoverTrigger
                      className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 transition-colors hover:bg-muted/40"
                      disabled={isSending}
                    >
                      <h2 className="truncate font-semibold text-[13.5px] tracking-tight">
                        {chatTitle ||
                          selectedAgentName ||
                          (isEn ? "New Chat" : "Nuevo Chat")}
                      </h2>
                      <svg
                        aria-label="Expand chevron"
                        className="h-3 w-3 text-muted-foreground/50 transition-transform"
                        fill="none"
                        role="img"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M6 9l6 6 6-6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-64 p-1.5">
                      <div className="px-2 py-1.5 font-medium text-[10px] text-muted-foreground/60 uppercase tracking-widest">
                        {isEn ? "Agent" : "Agente"}
                      </div>
                      {activeAgents.map((agent) => (
                        <button
                          className={cn(
                            "flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-2 text-left transition-all duration-150 hover:bg-muted/50",
                            agent.slug === selectedAgentSlug &&
                              "bg-[var(--sidebar-primary)]/[0.06] text-[var(--sidebar-primary)]"
                          )}
                          key={agent.slug}
                          onClick={() => onAgentChange(agent.slug)}
                          type="button"
                        >
                          <span className="truncate font-medium text-[13px]">
                            {agent.name}
                          </span>
                          {agent.description ? (
                            <span className="truncate text-[11px] text-muted-foreground">
                              {agent.description}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </PopoverContent>
                  </PopoverRoot>
                ) : (
                  <h2 className="truncate font-semibold text-[13.5px] tracking-tight">
                    {chatTitle ||
                      selectedAgentName ||
                      (isEn ? "New Chat" : "Nuevo Chat")}
                  </h2>
                )}
              </div>

              {!isChatDetailRoute && modelOptions.length > 0 ? (
                <PopoverRoot>
                  <PopoverTrigger
                    className="flex items-center"
                    disabled={isSending || modelBusy}
                  >
                    <Badge
                      className="cursor-pointer border-border/30 bg-transparent font-mono font-normal text-[10px] text-muted-foreground/70 transition-all hover:border-border/60 hover:bg-muted/30 hover:text-muted-foreground"
                      variant="outline"
                    >
                      {getModelDisplayName(selectedModel || primaryModel) ||
                        (isEn ? "Model" : "Modelo")}
                    </Badge>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-52 p-1.5">
                    <div className="px-2 py-1.5 font-medium text-[10px] text-muted-foreground/60 uppercase tracking-widest">
                      {isEn ? "Model" : "Modelo"}
                    </div>
                    {modelOptions.map((model) => (
                      <button
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm transition-all duration-150 hover:bg-muted/50",
                          model.model === (selectedModel || primaryModel) &&
                            "bg-[var(--sidebar-primary)]/[0.06] text-[var(--sidebar-primary)]"
                        )}
                        key={model.model}
                        onClick={() => onModelChange(model.model)}
                        type="button"
                      >
                        <span className="truncate font-mono text-[11px]">
                          {getModelDisplayName(model.model)}
                        </span>
                        {model.is_primary ? (
                          <Badge
                            className="ml-1.5 text-[9px]"
                            variant="secondary"
                          >
                            {isEn ? "primary" : "primario"}
                          </Badge>
                        ) : null}
                      </button>
                    ))}
                    <div className="mt-1 border-border/30 border-t px-2.5 py-2">
                      <span className="text-[10px] text-muted-foreground/50">
                        {isEn
                          ? "More models coming soon"
                          : "Más modelos próximamente"}
                      </span>
                    </div>
                  </PopoverContent>
                </PopoverRoot>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isChatDetailRoute ? null : (
            <>
              <Button
                className="h-7 w-7 rounded-lg text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground"
                disabled={isSending}
                onClick={onNewThread}
                size="icon"
                variant="ghost"
              >
                <Icon className="h-3.5 w-3.5" icon={PlusSignIcon} />
                <span className="sr-only">
                  {isEn ? "New thread" : "Nuevo hilo"}
                </span>
              </Button>

              <Button
                className="h-7 w-7 rounded-lg text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground"
                onClick={onHistoryClick}
                size="icon"
                variant="ghost"
              >
                <Icon className="h-3.5 w-3.5" icon={Clock02Icon} />
                <span className="sr-only">
                  {isEn ? "History" : "Historial"}
                </span>
              </Button>
            </>
          )}

          {isChatDetailRoute ? (
            <>
              <Button
                className="h-7 gap-1.5 rounded-lg border-border/30 px-2.5 text-[11px]"
                disabled={loading || busy}
                onClick={onArchiveToggle}
                size="sm"
                variant="outline"
              >
                <Icon className="h-3 w-3" icon={ArrowLeft02Icon} />
                {isArchived
                  ? isEn
                    ? "Restore"
                    : "Restaurar"
                  : isEn
                    ? "Archive"
                    : "Archivar"}
              </Button>
              {deleteArmed ? (
                <Button
                  className="h-7 rounded-lg border-border/30 px-2.5 text-[11px]"
                  disabled={loading || busy}
                  onClick={onDeleteCancel}
                  size="sm"
                  variant="outline"
                >
                  {isEn ? "Cancel" : "Cancelar"}
                </Button>
              ) : null}
              <Button
                className="h-7 gap-1.5 rounded-lg px-2.5 text-[11px]"
                disabled={loading || busy}
                onClick={deleteArmed ? onDeleteConfirm : onDeleteArm}
                size="sm"
                variant="destructive"
              >
                <Icon className="h-3 w-3" icon={Delete01Icon} />
                {deleteArmed
                  ? isEn
                    ? "Confirm"
                    : "Confirmar"
                  : isEn
                    ? "Delete"
                    : "Eliminar"}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
