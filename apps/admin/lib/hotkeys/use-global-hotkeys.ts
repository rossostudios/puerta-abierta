import { useHotkey } from "@tanstack/react-hotkeys";
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
  useHotkey("Mod+K", (e) => {
    e.preventDefault();
    onCommandPalette();
  });

  useHotkey({ key: "?" }, (e) => {
    if (!isInputFocused()) {
      e.preventDefault();
      onShowHelp();
    }
  });

  useHotkey("Escape", (_e) => {
    // Only invoke global escape if we aren't in a focused input that might need it
    if (!isInputFocused()) {
      onEscape();
    }
  });
}
