"use client";

import { HeartAddIcon, HeartCheckIcon } from "@hugeicons/core-free-icons";
import { useCallback, useSyncExternalStore, useState } from "react";

import { Icon } from "@/components/ui/icon";
import {
  FAVORITES_CHANGE_EVENT,
  isFavorite,
  toggleFavorite,
} from "@/lib/features/marketplace/favorites";
import { cn } from "@/lib/utils";

function subscribeFavorites(onStoreChange: () => void) {
  window.addEventListener(FAVORITES_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(FAVORITES_CHANGE_EVENT, onStoreChange);
}

type FavoriteButtonProps = {
  slug: string;
  className?: string;
};

export function FavoriteButton({ slug, className }: FavoriteButtonProps) {
  const getSnapshot = useCallback(() => isFavorite(slug), [slug]);
  const getServerSnapshot = useCallback(() => false, []);
  const active = useSyncExternalStore(subscribeFavorites, getSnapshot, getServerSnapshot);
  const [animate, setAnimate] = useState(false);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const nowActive = toggleFavorite(slug);
      if (nowActive) {
        setAnimate(true);
        setTimeout(() => setAnimate(false), 300);
      }
    },
    [slug]
  );

  return (
    <button
      aria-label={active ? "Remove from favorites" : "Add to favorites"}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur-sm transition-all hover:bg-white",
        animate && "scale-110",
        className
      )}
      onClick={handleClick}
      type="button"
    >
      <Icon
        className={cn(
          "transition-colors",
          active ? "text-red-500" : "text-[var(--marketplace-text-muted)]"
        )}
        icon={active ? HeartCheckIcon : HeartAddIcon}
        size={18}
      />
    </button>
  );
}
