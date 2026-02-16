import type { Locale } from "@/lib/i18n";

export type ShortcutCategory = "navigation" | "global" | "table" | "detail";

export type ShortcutEntry = {
  id: string;
  keys: string[];
  label: { en: string; es: string };
  category: ShortcutCategory;
};

export const SHORTCUTS: ShortcutEntry[] = [
  // Navigation (G-prefix sequences)
  { id: "go-dashboard", keys: ["G", "H"], label: { en: "Go to Dashboard", es: "Ir al Panel" }, category: "navigation" },
  { id: "go-inbox", keys: ["G", "I"], label: { en: "Go to Inbox", es: "Ir a Mensajes" }, category: "navigation" },
  { id: "go-chat", keys: ["G", "C"], label: { en: "Go to Chat", es: "Ir al Chat" }, category: "navigation" },
  { id: "go-properties", keys: ["G", "P"], label: { en: "Go to Properties", es: "Ir a Propiedades" }, category: "navigation" },
  { id: "go-units", keys: ["G", "U"], label: { en: "Go to Units", es: "Ir a Unidades" }, category: "navigation" },
  { id: "go-reservations", keys: ["G", "R"], label: { en: "Go to Reservations", es: "Ir a Reservas" }, category: "navigation" },
  { id: "go-tasks", keys: ["G", "T"], label: { en: "Go to Tasks", es: "Ir a Tareas" }, category: "navigation" },
  { id: "go-expenses", keys: ["G", "E"], label: { en: "Go to Expenses", es: "Ir a Gastos" }, category: "navigation" },
  { id: "go-leases", keys: ["G", "L"], label: { en: "Go to Leases", es: "Ir a Contratos" }, category: "navigation" },
  { id: "go-calendar", keys: ["G", "A"], label: { en: "Go to Calendar View", es: "Ir a Vista Calendario" }, category: "navigation" },
  { id: "go-settings", keys: ["G", "S"], label: { en: "Go to Settings", es: "Ir a Configuración" }, category: "navigation" },

  // Global
  { id: "command-palette", keys: ["Mod", "K"], label: { en: "Command palette", es: "Paleta de comandos" }, category: "global" },
  { id: "show-help", keys: ["?"], label: { en: "Show shortcuts help", es: "Mostrar atajos" }, category: "global" },
  { id: "escape", keys: ["Escape"], label: { en: "Close overlay / go back", es: "Cerrar overlay / volver" }, category: "global" },

  // Table
  { id: "table-next", keys: ["J", "↓"], label: { en: "Next row", es: "Siguiente fila" }, category: "table" },
  { id: "table-prev", keys: ["K", "↑"], label: { en: "Previous row", es: "Fila anterior" }, category: "table" },
  { id: "table-open", keys: ["Enter"], label: { en: "Open row detail", es: "Abrir detalle" }, category: "table" },
  { id: "table-deselect", keys: ["Escape"], label: { en: "Deselect / close detail", es: "Deseleccionar / cerrar" }, category: "table" },
  { id: "table-select", keys: ["X"], label: { en: "Toggle row selection", es: "Seleccionar fila" }, category: "table" },

  // Detail
  { id: "detail-close", keys: ["Escape"], label: { en: "Close sheet", es: "Cerrar panel" }, category: "detail" },
  { id: "detail-prev", keys: ["["], label: { en: "Previous item", es: "Elemento anterior" }, category: "detail" },
  { id: "detail-next", keys: ["]"], label: { en: "Next item", es: "Siguiente elemento" }, category: "detail" },
];

/**
 * Reverse map: href → shortcut keys (e.g. "/app" → ["G", "H"]).
 * Used by sidebar nav items to show tooltip hints.
 */
export const SHORTCUT_BY_HREF: Record<string, string[]> = {
  "/app": ["G", "H"],
  "/module/messaging": ["G", "I"],
  "/app/agents": ["G", "C"],
  "/module/properties": ["G", "P"],
  "/module/units": ["G", "U"],
  "/module/reservations": ["G", "R"],
  "/module/tasks": ["G", "T"],
  "/module/expenses": ["G", "E"],
  "/module/leases": ["G", "L"],
  "/module/reservations?view=calendar": ["G", "A"],
  "/settings": ["G", "S"],
};

const CATEGORY_LABELS: Record<ShortcutCategory, { en: string; es: string }> = {
  navigation: { en: "Navigation", es: "Navegación" },
  global: { en: "Global", es: "Global" },
  table: { en: "Table", es: "Tabla" },
  detail: { en: "Detail", es: "Detalle" },
};

function getCategoryLabel(category: ShortcutCategory, locale: Locale): string {
  const labels = CATEGORY_LABELS[category];
  return locale === "en-US" ? labels.en : labels.es;
}

export function getShortcutsByCategory(locale: Locale) {
  const categories: ShortcutCategory[] = ["navigation", "global", "table", "detail"];
  return categories.map((category) => ({
    category,
    label: getCategoryLabel(category, locale),
    shortcuts: SHORTCUTS.filter((s) => s.category === category).map((s) => ({
      ...s,
      localizedLabel: locale === "en-US" ? s.label.en : s.label.es,
    })),
  }));
}
