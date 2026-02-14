import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { isInputFocused } from "@/lib/hotkeys/is-input-focused";

const SEQUENCE_MAP: Record<string, string> = {
  h: "/app",
  i: "/module/messaging",
  c: "/app/agents",
  p: "/module/properties",
  u: "/module/units",
  r: "/module/reservations",
  t: "/module/tasks",
  e: "/module/expenses",
  l: "/module/leases",
  a: "/module/calendar",
  s: "/settings",
};

const TIMEOUT_MS = 800;

export function useNavigationHotkeys(): { gPressed: boolean } {
  const router = useRouter();
  const [gPressed, setGPressed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setGPressed(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isInputFocused()) return;

      const key = event.key.toLowerCase();

      if (!gPressed && key === "g") {
        setGPressed(true);
        timerRef.current = setTimeout(reset, TIMEOUT_MS);
        return;
      }

      if (gPressed) {
        reset();
        const href = SEQUENCE_MAP[key];
        if (href) {
          event.preventDefault();
          router.push(href);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [gPressed, reset, router]);

  return { gPressed };
}
