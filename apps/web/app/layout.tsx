import { GeistMono } from "geist/font/mono";
import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

import "./globals.css";

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

export const metadata: Metadata = {
  title: {
    default: "Casaora — The operating system for property management",
    template: "%s | Casaora",
  },
  description:
    "Casaora is the all-in-one platform for property owners, managers, guests, and tenants. Streamline operations, automate workflows, and grow your portfolio.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://casaora.co"
  ),
  openGraph: {
    type: "website",
    siteName: "Casaora",
    locale: "en_US",
  },
  icons: {
    icon: "/fav.svg",
    apple: "/fav.svg",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      className={`${diatype.variable} ${GeistMono.variable} ${playfair.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          disableTransitionOnChange
          enableSystem
        >
          {children}
          <Toaster closeButton position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
