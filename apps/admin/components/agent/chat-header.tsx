"use client";

import {
  ArrowLeft02Icon,
  Clock02Icon,
  Delete01Icon,
  PlusSignIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { AgentModelOption } from "@/lib/api";
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
}) {
  return (
    <div
      className={cn(
        "glass-chrome sticky top-0 z-10 flex shrink-0 items-center justify-between px-4 py-2.5",
        isEmbedded && "bg-card/95"
      )}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {loading ? (
            <Skeleton className="h-6 w-36" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-[var(--sidebar-primary)] to-[var(--sidebar-primary)]/70 text-white">
                  <Icon className="h-3 w-3" icon={SparklesIcon} />
                </div>
                <h2 className="truncate font-semibold text-sm">
                  {chatTitle || "Zoey"}
                </h2>
              </div>

              {!isChatDetailRoute && modelOptions.length > 0 ? (
                <PopoverRoot>
                  <PopoverTrigger
                    className="flex items-center"
                    disabled={isSending || modelBusy}
                  >
                    <Badge
                      className="cursor-pointer font-mono font-normal text-[10px] transition-colors hover:bg-muted"
                      variant="outline"
                    >
                      {selectedModel ||
                        primaryModel ||
                        (isEn ? "Model" : "Modelo")}
                    </Badge>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-52 p-1.5">
                    <div className="px-2 py-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                      {isEn ? "Model" : "Modelo"}
                    </div>
                    {modelOptions.map((model) => (
                      <button
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted/60",
                          model.model === (selectedModel || primaryModel) &&
                            "bg-[var(--sidebar-primary)]/8 text-[var(--sidebar-primary)]"
                        )}
                        key={model.model}
                        onClick={() => onModelChange(model.model)}
                        type="button"
                      >
                        <span className="truncate font-mono text-xs">
                          {model.model}
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
                  </PopoverContent>
                </PopoverRoot>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isChatDetailRoute ? null : (
            <>
              <Button
                className="h-7 w-7"
                disabled={isSending}
                onClick={onNewThread}
                size="icon"
                variant="ghost"
              >
                <Icon className="h-4 w-4" icon={PlusSignIcon} />
                <span className="sr-only">
                  {isEn ? "New thread" : "Nuevo hilo"}
                </span>
              </Button>

              <Button
                className="h-7 w-7"
                onClick={onHistoryClick}
                size="icon"
                variant="ghost"
              >
                <Icon className="h-4 w-4" icon={Clock02Icon} />
                <span className="sr-only">
                  {isEn ? "History" : "Historial"}
                </span>
              </Button>
            </>
          )}

          {isChatDetailRoute ? (
            <>
              <Button
                className="h-7 gap-1.5 px-2.5 text-[11px]"
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
                  className="h-7 px-2.5 text-[11px]"
                  disabled={loading || busy}
                  onClick={onDeleteCancel}
                  size="sm"
                  variant="outline"
                >
                  {isEn ? "Cancel" : "Cancelar"}
                </Button>
              ) : null}
              <Button
                className="h-7 gap-1.5 px-2.5 text-[11px]"
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
