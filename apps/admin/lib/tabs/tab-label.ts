import {
  File01Icon,
  Home01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { MODULE_ICONS } from "@/components/shell/sidebar-types";
import type { Locale } from "@/lib/i18n";
import { getModuleLabel, MODULE_BY_SLUG } from "@/lib/modules";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORD_START_RE = /\b\w/g;

function humanizeSegment(value: string): string {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(WORD_START_RE, (char) => char.toUpperCase());
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function extractModuleSlug(pathname: string): string | undefined {
  const parts = pathname.split("/").filter(Boolean);
  // handle /app/module/{slug} or /module/{slug}
  const moduleIdx = parts.indexOf("module");
  if (moduleIdx !== -1 && parts[moduleIdx + 1]) {
    return parts[moduleIdx + 1];
  }
  return undefined;
}

export function buildTabLabel(pathname: string, locale: Locale): string {
  const isEn = locale === "en-US";
  const rawParts = pathname.split("/").filter(Boolean);
  const parts = rawParts[0] === "app" ? rawParts.slice(1) : rawParts;

  if (parts.length === 0) {
    return isEn ? "Dashboard" : "Panel";
  }

  if (parts[0] === "setup") return "Onboarding";
  if (parts[0] === "settings") return isEn ? "Settings" : "Configuración";
  if (parts[0] === "account") return isEn ? "Account" : "Cuenta";
  if (parts[0] === "documentation") return isEn ? "Documentation" : "Documentación";

  if (parts[0] === "module") {
    const slug = parts[1] ?? "";
    const id = parts[2] ?? null;
    const moduleDef = MODULE_BY_SLUG.get(slug);
    const moduleLabel = moduleDef
      ? getModuleLabel(moduleDef, locale)
      : humanizeSegment(slug || (isEn ? "Module" : "Módulo"));

    if (id) {
      const idLabel = UUID_RE.test(id) ? shortId(id) : humanizeSegment(id);
      return `${moduleLabel} · ${idLabel}`;
    }
    return moduleLabel;
  }

  // Fallback: humanize last segment
  const last = parts[parts.length - 1];
  return humanizeSegment(last);
}

export function getTabIcon(pathname: string): IconSvgElement {
  const parts = pathname.split("/").filter(Boolean);
  const adjusted = parts[0] === "app" ? parts.slice(1) : parts;

  if (adjusted.length === 0) return Home01Icon;
  if (adjusted[0] === "settings") return Settings02Icon;

  if (adjusted[0] === "module" && adjusted[1]) {
    const slug = adjusted[1];
    return MODULE_ICONS[slug] ?? File01Icon;
  }

  return File01Icon;
}
