"use client";

import { useEffect } from "react";
import { addRecentlyViewed } from "@/lib/features/marketplace/recently-viewed";

export function RecentlyViewedTracker({ slug }: { slug: string }) {
  useEffect(() => {
    addRecentlyViewed(slug);
  }, [slug]);

  return null;
}
