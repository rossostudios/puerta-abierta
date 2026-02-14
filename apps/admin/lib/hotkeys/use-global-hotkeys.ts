import { useEffect } from "react";
import { isInputFocused } from "@/lib/hotkeys/is-input-focused";

type GlobalHotkeyHandlers = {
  onCommandPalette: () => void;
  onShowHelp: () => void;
  onEscape: () => void;
};

export function useGlobalHotkeys({
  onCommandPalette,
  onShowHelp,
  onEscape,
}: GlobalHotkeyHandlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Mod+K — always fires, even in inputs
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onCommandPalette();
        return;
      }

      // ? — only outside inputs
      if (event.key === "?" && !isInputFocused() && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        onShowHelp();
        return;
      }

      // Global Escape fallback (lowest priority — overlays handle their own)
      if (event.key === "Escape") {
        onEscape();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCommandPalette, onShowHelp, onEscape]);
}
