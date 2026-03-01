"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SectionLabel } from "@/components/agent/briefing/helpers";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n";
import { bold, EASING } from "@/lib/module-helpers";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Data                                                               */
/* ------------------------------------------------------------------ */

type Channel = {
  name: string;
  icon: string;
  badge: string;
  badgeColor: string;
  description: [string, string]; // [en, es]
  features: [string[], string[]];
  cta: [string, string];
  setup: [string, string];
  available: boolean;
};

const CHANNELS: Channel[] = [
  {
    name: "Airbnb",
    icon: "\uD83C\uDFE1",
    badge: "POPULAR",
    badgeColor: "bg-amber-500/20 text-amber-400",
    description: [
      "Sync listings, manage reservations, and auto-respond to guest inquiries",
      "Sincroniza listados, gestiona reservas y responde autom\u00E1ticamente a hu\u00E9spedes",
    ],
    features: [
      ["Auto-sync listings", "Guest messaging", "Review management", "Dynamic pricing sync", "Calendar sync"],
      ["Sincronizaci\u00F3n autom\u00E1tica", "Mensajer\u00EDa con hu\u00E9spedes", "Gesti\u00F3n de rese\u00F1as", "Precios din\u00E1micos", "Sincronizaci\u00F3n de calendario"],
    ],
    cta: ["Connect Airbnb", "Conectar Airbnb"],
    setup: ["Setup: ~2 minutes", "Config: ~2 minutos"],
    available: false,
  },
  {
    name: "VRBO",
    icon: "\uD83C\uDFD6\uFE0F",
    badge: "POPULAR",
    badgeColor: "bg-amber-500/20 text-amber-400",
    description: [
      "Connect your VRBO listings for unified calendar and booking management",
      "Conecta tus listados de VRBO para una gesti\u00F3n unificada de calendario y reservas",
    ],
    features: [
      ["Listing sync", "Reservation management", "Calendar sync", "Rate management"],
      ["Sincronizaci\u00F3n de listados", "Gesti\u00F3n de reservas", "Sincronizaci\u00F3n de calendario", "Gesti\u00F3n de tarifas"],
    ],
    cta: ["Connect VRBO", "Conectar VRBO"],
    setup: ["Setup: ~2 minutes", "Config: ~2 minutos"],
    available: false,
  },
  {
    name: "Booking.com",
    icon: "\uD83C\uDF10",
    badge: "POPULAR",
    badgeColor: "bg-amber-500/20 text-amber-400",
    description: [
      "Manage Booking.com properties with automated guest communication",
      "Gestiona propiedades en Booking.com con comunicaci\u00F3n automatizada",
    ],
    features: [
      ["Property sync", "Reservation management", "Guest messaging", "Rate plans"],
      ["Sincronizaci\u00F3n de propiedades", "Gesti\u00F3n de reservas", "Mensajer\u00EDa con hu\u00E9spedes", "Planes de tarifas"],
    ],
    cta: ["Connect Booking.com", "Conectar Booking.com"],
    setup: ["Setup: ~3 minutes", "Config: ~3 minutos"],
    available: false,
  },
  {
    name: "Casaora Marketplace",
    icon: "\u2B50",
    badge: "0% COMMISSION",
    badgeColor: "bg-emerald-500/20 text-emerald-400",
    description: [
      "List on Casaora\u2019s direct booking marketplace \u2014 zero commission, full control",
      "Publica en el marketplace de Casaora \u2014 sin comisi\u00F3n, control total",
    ],
    features: [
      ["0% commission", "Direct bookings", "Custom branding", "Built-in payments", "AI-powered listing optimization"],
      ["0% comisi\u00F3n", "Reservas directas", "Marca personalizada", "Pagos integrados", "Optimizaci\u00F3n con IA"],
    ],
    cta: ["Connect Casaora Marketplace", "Conectar Casaora Marketplace"],
    setup: ["Setup: ~1 minute", "Config: ~1 minuto"],
    available: true,
  },
];

const COMING_SOON: Channel[] = [
  {
    name: "Google Vacation Rentals",
    icon: "\uD83D\uDD0D",
    badge: "COMING SOON",
    badgeColor: "bg-muted-foreground/20 text-muted-foreground/70",
    description: [
      "Appear in Google Search and Maps vacation rental results",
      "Aparece en los resultados de alquileres vacacionales de Google Search y Maps",
    ],
    features: [
      ["Google Search visibility", "Maps integration", "Direct booking links"],
      ["Visibilidad en Google Search", "Integraci\u00F3n con Maps", "Enlaces de reserva directa"],
    ],
    cta: ["Notify me when available", "Notificarme cuando est\u00E9 disponible"],
    setup: ["Coming Q2 2026", "Disponible Q2 2026"],
    available: false,
  },
  {
    name: "Expedia",
    icon: "\u2708\uFE0F",
    badge: "COMING SOON",
    badgeColor: "bg-muted-foreground/20 text-muted-foreground/70",
    description: [
      "Reach business and leisure travelers through the Expedia network",
      "Llega a viajeros de negocios y ocio a trav\u00E9s de la red de Expedia",
    ],
    features: [
      ["Listing distribution", "Corporate travel bookings", "Rate management"],
      ["Distribuci\u00F3n de listados", "Reservas corporativas", "Gesti\u00F3n de tarifas"],
    ],
    cta: ["Notify me when available", "Notificarme cuando est\u00E9 disponible"],
    setup: ["Coming Q2 2026", "Disponible Q2 2026"],
    available: false,
  },
  {
    name: "Tripadvisor Rentals",
    icon: "\uD83E\uDDED",
    badge: "COMING SOON",
    badgeColor: "bg-muted-foreground/20 text-muted-foreground/70",
    description: [
      "List on Tripadvisor\u2019s vacation rental platform for global reach",
      "Publica en la plataforma de alquileres vacacionales de Tripadvisor",
    ],
    features: [
      ["Global distribution", "Review aggregation", "Instant booking"],
      ["Distribuci\u00F3n global", "Agregaci\u00F3n de rese\u00F1as", "Reserva instant\u00E1nea"],
    ],
    cta: ["Notify me when available", "Notificarme cuando est\u00E9 disponible"],
    setup: ["Coming Q3 2026", "Disponible Q3 2026"],
    available: false,
  },
  {
    name: "Direct Booking Website",
    icon: "\uD83C\uDF10",
    badge: "COMING SOON",
    badgeColor: "bg-muted-foreground/20 text-muted-foreground/70",
    description: [
      "Create a branded direct booking website \u2014 keep 100% of your revenue",
      "Crea un sitio de reservas directas con tu marca \u2014 conserva el 100% de tus ingresos",
    ],
    features: [
      ["Custom domain", "Branded design", "Built-in payments", "SEO optimized"],
      ["Dominio personalizado", "Dise\u00F1o con marca", "Pagos integrados", "Optimizado para SEO"],
    ],
    cta: ["Notify me when available", "Notificarme cuando est\u00E9 disponible"],
    setup: ["Coming Q3 2026", "Disponible Q3 2026"],
    available: false,
  },
];

const CHIPS_EN = [
  "Which channels should I connect first?",
  "How does the Casaora Marketplace work?",
  "Can you connect my Airbnb for me?",
  "What\u2019s the best multi-channel strategy?",
];
const CHIPS_ES = [
  "\u00BFQu\u00E9 canales debo conectar primero?",
  "\u00BFC\u00F3mo funciona el Marketplace de Casaora?",
  "\u00BFPuedes conectar mi Airbnb?",
  "\u00BFCu\u00E1l es la mejor estrategia multicanal?",
];

/* ------------------------------------------------------------------ */
/* ChannelsManager                                                    */
/* ------------------------------------------------------------------ */

export function ChannelsManager({ locale }: { locale: Locale }) {
  const isEn = locale === "en-US";
  const l = isEn ? 0 : 1;

  const availableCount = CHANNELS.length;
  const comingSoonCount = COMING_SOON.length;

  const overview = isEn
    ? `Channels let me distribute your listings and manage bookings across multiple platforms from one place. You have **${availableCount} channels available** to connect and **${comingSoonCount} more coming soon**. I\u2019d recommend starting with Airbnb \u2014 it\u2019s the strongest platform for STRs in Paraguay.`
    : `Los canales me permiten distribuir tus listados y gestionar reservas en m\u00FAltiples plataformas desde un solo lugar. Tienes **${availableCount} canales disponibles** para conectar y **${comingSoonCount} m\u00E1s pr\u00F3ximamente**. Te recomiendo empezar con Airbnb \u2014 es la plataforma m\u00E1s fuerte para STRs en Paraguay.`;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col px-4 py-8 sm:px-6">
      <div className="space-y-8">
        {/* Alex overview */}
        <div className="space-y-1">
          <p className="font-semibold text-foreground text-sm">Alex</p>
          <p className="text-muted-foreground text-sm leading-relaxed">{bold(overview)}</p>
        </div>

        {/* Available channels */}
        <SectionLabel>{isEn ? "AVAILABLE CHANNELS" : "CANALES DISPONIBLES"}</SectionLabel>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {CHANNELS.map((ch, i) => (
            <ChannelCard channel={ch} delay={i * 0.06} isEn={isEn} key={ch.name} l={l} />
          ))}
        </div>

        {/* Coming soon */}
        <SectionLabel>{isEn ? "COMING SOON" : "PR\u00D3XIMAMENTE"}</SectionLabel>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {COMING_SOON.map((ch, i) => (
            <ChannelCard channel={ch} comingSoon delay={0.2 + i * 0.06} isEn={isEn} key={ch.name} l={l} />
          ))}
        </div>
      </div>

      {/* Chat + chips pinned to bottom */}
      <div className="mt-auto space-y-4 pt-12">
        <ChatInput isEn={isEn} />
        <Chips isEn={isEn} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ChannelCard                                                        */
/* ------------------------------------------------------------------ */

function ChannelCard({
  channel: ch,
  l,
  isEn,
  comingSoon,
  delay = 0,
}: {
  channel: Channel;
  l: number;
  isEn: boolean;
  comingSoon?: boolean;
  delay?: number;
}) {
  const router = useRouter();

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "glass-inner flex flex-col rounded-2xl p-5",
        comingSoon && "opacity-60",
      )}
      initial={{ opacity: 0, y: 8 }}
      transition={{ delay, duration: 0.35, ease: EASING }}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-lg">
          {ch.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground text-sm tracking-tight">{ch.name}</h3>
            <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 font-semibold text-[10px] uppercase tracking-wider", ch.badgeColor)}>
              {ch.badge}
            </span>
          </div>
          <p className="mt-0.5 text-muted-foreground/60 text-xs leading-relaxed">{ch.description[l]}</p>
        </div>
      </div>

      {/* Features */}
      <ul className="mt-4 flex-1 space-y-1.5">
        {ch.features[l].map((f) => (
          <li className="flex items-center gap-2 text-muted-foreground/70 text-xs" key={f}>
            <span className={comingSoon ? "text-muted-foreground/30" : "text-emerald-500"}>
              {comingSoon ? "\u25CB" : "\u2713"}
            </span>
            {f}
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-5 flex items-center gap-3">
        <button
          className={cn(
            "rounded-full border px-4 py-2 font-medium text-xs transition-colors",
            comingSoon
              ? "border-border/50 text-muted-foreground/60 hover:border-border hover:text-muted-foreground"
              : "border-border/70 text-foreground hover:bg-muted/30",
          )}
          onClick={() => {
            const prompt = comingSoon
              ? `${isEn ? "Notify me when" : "Notif\u00EDcame cuando"} ${ch.name} ${isEn ? "is available" : "est\u00E9 disponible"}`
              : `${ch.cta[l]}`;
            router.push(`/app/agents?prompt=${encodeURIComponent(prompt)}`);
          }}
          type="button"
        >
          {ch.cta[l]}
        </button>
        <span className="text-muted-foreground/40 text-xs">{ch.setup[l]}</span>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* ChatInput                                                          */
/* ------------------------------------------------------------------ */

function ChatInput({ isEn }: { isEn: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    router.push(`/app/agents?prompt=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form className="relative" onSubmit={handleSubmit}>
      <input
        className={cn(
          "h-12 w-full rounded-full border border-border/50 bg-background pr-12 pl-5 text-sm",
          "placeholder:text-muted-foreground/40",
          "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20",
          "transition-colors",
        )}
        onChange={(e) => setValue(e.target.value)}
        placeholder={isEn ? "Ask about channels..." : "Pregunta sobre canales..."}
        type="text"
        value={value}
      />
      <button
        className={cn(
          "absolute top-1/2 right-1.5 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
          "bg-foreground text-background transition-opacity",
          value.trim() ? "opacity-100" : "opacity-30",
        )}
        disabled={!value.trim()}
        type="submit"
      >
        <Icon icon={ArrowRight01Icon} size={16} />
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Chips                                                              */
/* ------------------------------------------------------------------ */

function Chips({ isEn }: { isEn: boolean }) {
  const chips = isEn ? CHIPS_EN : CHIPS_ES;
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap gap-2"
      initial={{ opacity: 0, y: 8 }}
      transition={{ delay: 0.3, duration: 0.4, ease: EASING }}
    >
      {chips.map((chip, i) => (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          initial={{ opacity: 0, scale: 0.95 }}
          key={chip}
          transition={{ delay: 0.35 + i * 0.04, duration: 0.25, ease: EASING }}
        >
          <Link
            className="glass-inner inline-block rounded-full px-3.5 py-2 text-[12.5px] text-muted-foreground/70 transition-all hover:text-foreground hover:shadow-sm"
            href={`/app/agents?prompt=${encodeURIComponent(chip)}`}
          >
            {chip}
          </Link>
        </motion.div>
      ))}
    </motion.div>
  );
}
