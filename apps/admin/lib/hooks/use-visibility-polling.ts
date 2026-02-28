"use client";

import { useEffect, useState } from "react";

type UseVisibilityPollingIntervalOptions = {
  enabled?: boolean;
  foregroundMs: number;
  backgroundMs?: number;
};

export function useVisibilityPollingInterval({
  enabled = true,
  foregroundMs,
  backgroundMs = 60_000,
}: UseVisibilityPollingIntervalOptions): number | false {
  const [visible, setVisible] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.visibilityState === "visible";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisibilityChange = () => {
      setVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  if (!enabled) return false;
  return visible ? foregroundMs : backgroundMs;
}
