import type { Metadata } from "next";

import { Toaster } from "@/components/ui/sonner";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { getActiveLocale } from "@/lib/i18n/server";

import "./globals.css";

const THEME_V2_ENABLED = process.env.NEXT_PUBLIC_THEME_V2 !== "0";

const THEME_INIT_SCRIPT = `
(() => {
  try {
    const themeV2Enabled = ${THEME_V2_ENABLED ? "true" : "false"};
    const key = "pa-theme";
    const stored = localStorage.getItem(key);
    const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (themeV2Enabled) {
      const preference = stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "system";
      const resolvedTheme = preference === "system" ? (systemDark ? "dark" : "light") : preference;
      document.documentElement.dataset.themePreference = preference;
      document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    } else {
      const theme = stored === "light" || stored === "dark"
        ? stored
        : (systemDark ? "dark" : "light");
      document.documentElement.dataset.themePreference = theme;
      document.documentElement.classList.toggle("dark", theme === "dark");
    }
  } catch {}

  try {
    const key = "pa-locale";
    const fromHtml = document.documentElement.lang;
    const stored = localStorage.getItem(key);
    const locale =
      fromHtml === "en-US" || fromHtml === "es-PY"
        ? fromHtml
        : stored === "en-US" || stored === "es-PY"
          ? stored
          : "es-PY";
    document.documentElement.lang = locale;
    localStorage.setItem(key, locale);
  } catch {}
})();
`;

export const metadata: Metadata = {
  title: "Puerta Abierta",
  description:
    "Marketplace y sistema operativo para alquileres de largo plazo en Paraguay.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getActiveLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className="font-sans antialiased"
        data-base-ui-root
        suppressHydrationWarning
      >
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: needed to prevent theme flash before hydration */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
        <Toaster />
      </body>
    </html>
  );
}
