"use client";

import { HeartAddIcon, HeartCheckIcon } from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/ui/icon";
import {
  FAVORITES_CHANGE_EVENT,
  isFavorite,
  toggleFavorite,
} from "@/lib/features/marketplace/favorites";
import { cn } from "@/lib/utils";

type FavoriteButtonProps = {
  slug: string;
  className?: string;
};

export function FavoriteButton({ slug, className }: FavoriteButtonProps) {
  const [active, setActive] = useState(false);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    setActive(isFavorite(slug));

    function sync() {
      setActive(isFavorite(slug));
    }
    window.addEventListener(FAVORITES_CHANGE_EVENT, sync);
    return () => window.removeEventListener(FAVORITES_CHANGE_EVENT, sync);
  }, [slug]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const nowActive = toggleFavorite(slug);
      setActive(nowActive);
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
        "inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/80 shadow-sm backdrop-blur-sm transition-all hover:bg-background/95",
        animate && "scale-125",
        className
      )}
      onClick={handleClick}
      type="button"
    >
      <Icon
        className={cn(
          "transition-colors",
          active ? "text-red-500" : "text-muted-foreground"
        )}
        icon={active ? HeartCheckIcon : HeartAddIcon}
        size={16}
      />
    </button>
  );
}
