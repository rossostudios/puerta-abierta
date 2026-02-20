"use client";

import {
  Cancel01Icon,
  File01Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import Image from "next/image";
import type { ChatAttachment } from "@/components/agent/use-chat-attachments";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function ChatAttachmentPreview({
  attachments,
  onRemove,
}: {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto px-1 pb-1">
      {attachments.map((att) => (
        <div
          className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-muted/30"
          key={att.id}
        >
          {att.previewUrl ? (
            <Image
              alt={att.file.name}
              className="h-full w-full object-cover"
              height={64}
              src={att.previewUrl}
              unoptimized
              width={64}
            />
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <Icon
                className="h-5 w-5 text-muted-foreground"
                icon={File01Icon}
              />
              <span className="max-w-[56px] truncate text-[8px] text-muted-foreground">
                {att.file.name.split(".").pop()?.toUpperCase()}
              </span>
            </div>
          )}

          {att.status === "uploading" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Icon
                className="h-4 w-4 animate-spin text-muted-foreground"
                icon={Loading03Icon}
              />
            </div>
          ) : null}

          {att.status === "error" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-destructive/10">
              <span className="font-medium text-[9px] text-destructive">!</span>
            </div>
          ) : null}

          <Button
            className="absolute -top-1 -right-1 h-5 w-5 rounded-full border border-border bg-background p-0 shadow-sm"
            onClick={() => onRemove(att.id)}
            size="icon"
            variant="ghost"
          >
            <Icon className="h-3 w-3" icon={Cancel01Icon} />
          </Button>
        </div>
      ))}
    </div>
  );
}
