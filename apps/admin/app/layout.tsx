import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel";
import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import localFont from "next/font/local";
import Script from "next/script";

const diatype = localFont({
  src: [
    { path: "../public/Diatype/ABCDiatype-Thin-Trial.woff2", weight: "100", style: "normal" },
    { path: "../public/Diatype/ABCDiatype-ThinItalic-Trial.woff2", weight: "100", style: "italic" },
    { path: "../public/Diatype/ABCDiatype-Light-Trial.woff2", weight: "300", style: "normal" },
    { path: "../public/Diatype/ABCDiatype-LightItalic-Trial.woff2", weight: "300", style: "italic" },
    { path: "../public/Diatype/ABCDiatype-Regular-Trial.woff2", weight: "400", style: "normal" },
    { path: "../public/Diatype/ABCDiatype-RegularItalic-Trial.woff2", weight: "400", style: "italic" },
    { path: "../public/Diatype/ABCDiatype-Medium-Trial.woff2", weight: "500", style: "normal" },
    { path: "../public/Diatype/ABCDiatype-MediumItalic-Trial.woff2", weight: "500", style: "italic" },
    { path: "../public/Diatype/ABCDiatype-Bold-Trial.woff2", weight: "700", style: "normal" },
    { path: "../public/Diatype/ABCDiatype-BoldItalic-Trial.woff2", weight: "700", style: "italic" },
    { path: "../public/Diatype/ABCDiatype-Heavy-Trial.woff2", weight: "800", style: "normal" },
    { path: "../public/Diatype/ABCDiatype-HeavyItalic-Trial.woff2", weight: "800", style: "italic" },
    { path: "../public/Diatype/ABCDiatype-Black-Trial.woff2", weight: "900", style: "normal" },
    { path: "../public/Diatype/ABCDiatype-BlackItalic-Trial.woff2", weight: "900", style: "italic" },
    { path: "../public/Diatype/ABCDiatype-Ultra-Trial.woff2", weight: "950", style: "normal" },
    { path: "../public/Diatype/ABCDiatype-UltraItalic-Trial.woff2", weight: "950", style: "italic" },
  ],
  variable: "--font-diatype",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});

import { AppHotkeysProvider } from "@/components/providers/hotkeys-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { ApiErrorToaster } from "@/components/shell/api-error-toaster";
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
  title: {
    default: "Casaora",
    template: "%s | Casaora",
  },
  description:
    "Marketplace y sistema operativo para alquileres de largo plazo en Paraguay. Property management for long-term rentals in Paraguay.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://casaora.co"
  ),
  openGraph: {
    type: "website",
    siteName: "Casaora",
    locale: "es_PY",
    alternateLocale: "en_US",
  },
  icons: {
    icon: "/fav.svg",
    apple: "/fav.svg",
  },
  twitter: {
    card: "summary",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getActiveLocale();
  return (
    <html
      className={`${diatype.variable} ${GeistMono.variable} ${GeistPixelSquare.variable} ${playfair.variable}`}
      lang={locale}
      suppressHydrationWarning
    >
      <body
        className="font-sans antialiased"
        data-base-ui-root
        suppressHydrationWarning
      >
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <LocaleProvider initialLocale={locale}>
          <QueryProvider>
            <AppHotkeysProvider>{children}</AppHotkeysProvider>
          </QueryProvider>
        </LocaleProvider>
        <Toaster />
        <ApiErrorToaster />
      </body>
    </html>
  );
}
