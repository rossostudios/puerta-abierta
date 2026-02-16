// ============================================================
// ROSSO STOA — Tailwind Config + Next.js Setup
// ============================================================

import type { Config } from "tailwindcss";

const config: Config = {
  theme: {
    extend: {
      colors: {
        stoa: {
          50: "hsl(349 100% 97%)",
          100: "hsl(349 100% 94%)",
          200: "hsl(349 96% 86%)",
          300: "hsl(349 92% 74%)",
          400: "hsl(349 82% 60%)",   // Scarlet Rush
          500: "hsl(349 79% 49%)",   // Classic Crimson ← PRIMARY
          600: "hsl(349 74% 39%)",   // Intense Cherry
          700: "hsl(349 68% 30%)",   // Ruby Red
          800: "hsl(349 68% 19%)",   // Burgundy II
          900: "hsl(349 68% 14%)",   // Burgundy
          950: "hsl(349 68% 12%)",   // Night Bordeaux
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "slide-up": "slide-up 0.2s ease-out",
        "fade-in": "fade-in 0.15s ease-out",
      },
    },
  },
};

export default config;


// ============================================================
// layout.tsx
// ============================================================
//
// import { GeistSans } from "geist/font/sans";
// import { GeistMono } from "geist/font/mono";
// import "./globals.css";
//
// export default function RootLayout({
//   children,
// }: {
//   children: React.ReactNode;
// }) {
//   return (
//     <html
//       lang="en"
//       className={`${GeistSans.variable} ${GeistMono.variable}`}
//     >
//       <body className="font-sans antialiased">{children}</body>
//     </html>
//   );
// }


// ============================================================
// Colonnade Logo SVG Component
// ============================================================
//
// export function StoaLogo({
//   size = 24,
//   color = "currentColor",
//   className,
// }: {
//   size?: number;
//   color?: string;
//   className?: string;
// }) {
//   return (
//     <svg
//       width={size}
//       height={size}
//       viewBox="0 0 32 32"
//       fill="none"
//       className={className}
//     >
//       <line x1="5" y1="5.5" x2="27" y2="5.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
//       <line x1="5" y1="26.5" x2="27" y2="26.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
//       <rect x="7.5" y="5.5" width="3.5" height="21" rx="0.75" fill={color} opacity="0.9" />
//       <rect x="14.25" y="5.5" width="3.5" height="21" rx="0.75" fill={color} opacity="0.55" />
//       <rect x="21" y="5.5" width="3.5" height="21" rx="0.75" fill={color} opacity="0.3" />
//     </svg>
//   );
// }
//
//
// ============================================================
// Usage Cheat Sheet
// ============================================================
//
// LOGO IN SIDEBAR
// <div className="flex items-center gap-2">
//   <StoaLogo size={20} color="hsl(349 79% 49%)" />
//   <span className="text-sm font-semibold tracking-tight">Rosso Stoa</span>
// </div>
//
// LOGO ON BRAND GRADIENT
// <div className="bg-stoa-gradient p-8 rounded-xl">
//   <div className="flex items-center gap-2">
//     <StoaLogo size={24} color="white" />
//     <span className="text-base font-bold text-white tracking-tight">Rosso Stoa</span>
//   </div>
// </div>
//
// PRIMARY BUTTON
// <Button>Add Property</Button>
//
// STAT CARD
// <Card>
//   <CardHeader className="pb-2">
//     <CardDescription className="text-xs font-medium uppercase tracking-wider">Revenue</CardDescription>
//   </CardHeader>
//   <CardContent>
//     <p className="text-2xl font-semibold tracking-tight tabular-nums">$48,250</p>
//   </CardContent>
// </Card>
//
// PROPERTY CARD HEADER
// <div className="bg-stoa-gradient-warm h-28 rounded-t-lg flex items-center justify-center">
//   <StoaLogo size={32} color="rgba(255,255,255,0.2)" />
// </div>
//
// SIDEBAR (light mode: Night Bordeaux, dark mode: near-black)
// <aside className="bg-sidebar text-sidebar-foreground w-56">
//   <StoaLogo size={20} color="rgba(255,255,255,0.8)" />
// </aside>
//
// STATUS BADGES
// <Badge className="bg-stoa-500/10 text-stoa-500">Overdue</Badge>
// <Badge className="bg-green-500/10 text-green-500">Paid</Badge>
// <Badge className="bg-yellow-500/10 text-yellow-600">Pending</Badge>
//
// TABULAR DATA
// <td className="font-mono tabular-nums text-sm">$2,400.00</td>
// <td className="font-mono tabular-nums text-sm">₲3,200,000</td>
//
// BRAND TINT SECTION
// <section className="bg-stoa-gradient-subtle rounded-lg p-6">
//   <Badge className="bg-stoa-500/10 text-stoa-500">Active</Badge>
// </section>
//
// GLOW EFFECT ON CARDS
// <Card className="shadow-stoa">...</Card>
