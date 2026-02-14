"use client";

import { Share01Icon } from "@hugeicons/core-free-icons";
import { useCallback, useState } from "react";

import { Icon } from "@/components/ui/icon";

type ListingShareButtonProps = {
  title: string;
  isEn: boolean;
};

export function ListingShareButton({ title, isEn }: ListingShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // User cancelled or share failed, fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [title]);

  return (
    <button
      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/70 bg-card/90 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
      onClick={handleShare}
      type="button"
    >
      <Icon icon={Share01Icon} size={14} />
      {copied
        ? isEn
          ? "Copied!"
          : "Copiado!"
        : isEn
          ? "Share"
          : "Compartir"}
    </button>
  );
}
