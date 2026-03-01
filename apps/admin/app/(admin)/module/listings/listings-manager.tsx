"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SectionLabel } from "@/components/agent/briefing/helpers";
import { Icon } from "@/components/ui/icon";
import { useActiveLocale } from "@/lib/i18n/client";
import { bold, EASING } from "@/lib/module-helpers";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type ListingRow = {
  id: string;
  title: string;
  public_slug: string;
  city: string;
  neighborhood?: string | null;
  is_published: boolean;
  fee_breakdown_complete: boolean;
  total_move_in: number;
  monthly_recurring_total: number;
  currency: string;
  cover_image_url: string | null;
  gallery_image_urls: unknown[];
  bedrooms: number;
  bathrooms: number;
  square_meters: number;
  property_type: string | null;
  furnished: boolean;
  pet_policy: string | null;
  parking_spaces: number;
  minimum_lease_months: number;
  available_from: string | null;
  amenities: unknown[];
  maintenance_fee: number;
  missing_required_fee_lines: unknown[];
  unit_name: string | null;
  property_name: string | null;
  summary?: string | null;
  description?: string | null;
  property_id?: string | null;
  unit_id?: string | null;
  pricing_template_id?: string | null;
  application_count: number;
  active_lease_count: number;
  readiness_score: number;
  readiness_blocking: string[];
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function asStr(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}
function asNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toRow(r: Record<string, unknown>): ListingRow {
  return {
    id: asStr(r.id).trim(),
    title: asStr(r.title).trim(),
    public_slug: asStr(r.public_slug).trim(),
    city: asStr(r.city).trim() || "Asuncion",
    neighborhood: asStr(r.neighborhood).trim() || null,
    is_published: r.is_published === true,
    fee_breakdown_complete: r.fee_breakdown_complete === true,
    total_move_in: asNum(r.total_move_in),
    monthly_recurring_total: asNum(r.monthly_recurring_total),
    currency: asStr(r.currency).trim().toUpperCase() || "PYG",
    cover_image_url: asStr(r.cover_image_url).trim() || null,
    gallery_image_urls: Array.isArray(r.gallery_image_urls) ? r.gallery_image_urls : [],
    bedrooms: asNum(r.bedrooms),
    bathrooms: asNum(r.bathrooms),
    square_meters: asNum(r.square_meters),
    property_type: asStr(r.property_type).trim() || null,
    furnished: r.furnished === true,
    pet_policy: asStr(r.pet_policy).trim() || null,
    parking_spaces: asNum(r.parking_spaces),
    minimum_lease_months: asNum(r.minimum_lease_months),
    available_from: asStr(r.available_from).trim() || null,
    amenities: Array.isArray(r.amenities) ? r.amenities : [],
    maintenance_fee: asNum(r.maintenance_fee),
    missing_required_fee_lines: Array.isArray(r.missing_required_fee_lines) ? r.missing_required_fee_lines : [],
    unit_name: asStr(r.unit_name).trim() || null,
    property_name: asStr(r.property_name).trim() || null,
    summary: asStr(r.summary).trim() || null,
    description: asStr(r.description).trim() || null,
    property_id: asStr(r.property_id).trim() || null,
    unit_id: asStr(r.unit_id).trim() || null,
    pricing_template_id: asStr(r.pricing_template_id).trim() || null,
    application_count: asNum(r.application_count),
    active_lease_count: asNum(r.active_lease_count),
    readiness_score: asNum(r.readiness_score),
    readiness_blocking: Array.isArray(r.readiness_blocking) ? r.readiness_blocking.map(String) : [],
  };
}

/* Readiness: figure out completed vs missing sections */
const ALL_SECTIONS = [
  { key: "unit_details", en: "Unit details", es: "Detalles de unidad" },
  { key: "amenities", en: "Amenities", es: "Amenidades" },
  { key: "photos", en: "Photos", es: "Fotos" },
  { key: "description", en: "Description", es: "Descripci\u00F3n" },
  { key: "pricing", en: "Pricing", es: "Precios" },
  { key: "house_rules", en: "House rules", es: "Reglas de la casa" },
] as const;

function getReadiness(row: ListingRow): { completed: typeof ALL_SECTIONS[number][]; missing: typeof ALL_SECTIONS[number][] } {
  const blocking = new Set(row.readiness_blocking);
  const hasPhotos = row.gallery_image_urls.length > 0 || Boolean(row.cover_image_url);
  const hasDescription = Boolean(row.description || row.summary);
  const hasAmenities = row.amenities.length > 0;
  const hasUnitDetails = row.bedrooms > 0 || row.bathrooms > 0;

  const isComplete = (key: string): boolean => {
    if (blocking.has(key)) return false;
    switch (key) {
      case "unit_details": return hasUnitDetails;
      case "amenities": return hasAmenities;
      case "photos": return hasPhotos;
      case "description": return hasDescription;
      case "pricing": return !blocking.has("pricing") && !blocking.has("fee_breakdown");
      case "house_rules": return !blocking.has("house_rules");
      default: return true;
    }
  };

  const completed = ALL_SECTIONS.filter((s) => isComplete(s.key));
  const missing = ALL_SECTIONS.filter((s) => !isComplete(s.key));
  return { completed, missing };
}

/* Channels for distribution */
const DISTRIBUTION_CHANNELS = [
  { name: "Airbnb", icon: "\uD83C\uDFE1", commission: "3\u201315%", note: ["High in Paraguay", "Alta en Paraguay"], available: false },
  { name: "VRBO", icon: "\uD83C\uDFD6\uFE0F", commission: "5\u20138%", note: ["Medium", "Media"], available: false },
  { name: "Booking.com", icon: "\uD83C\uDF10", commission: "15%", note: ["High international", "Alta internacional"], available: false },
  { name: "Casaora Marketplace", icon: "\u2B50", commission: "0%", note: ["Growing", "Creciendo"], available: true },
] as const;

/* ------------------------------------------------------------------ */
/* ListingsManager                                                    */
/* ------------------------------------------------------------------ */

export function ListingsManager({
  orgId,
  listings,
  error: errorLabel,
  success: successMessage,
}: {
  orgId: string;
  listings: Record<string, unknown>[];
  error?: string;
  success?: string;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const rows = useMemo(() => listings.map(toRow), [listings]);
  const draftCount = rows.filter((r) => !r.is_published).length;
  const liveCount = rows.filter((r) => r.is_published).length;

  const overview = buildOverview(isEn, rows, draftCount, liveCount);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col px-4 py-8 sm:px-6">
      <div className="space-y-8">
        {/* Alex overview */}
        <div className="space-y-1">
          <p className="font-semibold text-foreground text-sm">Alex</p>
          <p className="text-muted-foreground text-sm leading-relaxed">{bold(overview)}</p>
        </div>

        {/* Feedback */}
        {errorLabel ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-red-600 text-sm dark:text-red-400">{errorLabel}</div>
        ) : null}
        {successMessage ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-emerald-600 text-sm dark:text-emerald-400">{successMessage}</div>
        ) : null}

        {/* Section label */}
        <SectionLabel>{isEn ? "YOUR LISTINGS" : "TUS LISTADOS"}</SectionLabel>

        {/* Listing cards */}
        <div className="space-y-4">
          {rows.map((row) => (
            <ListingCard isEn={isEn} key={row.id} row={row} />
          ))}
          <CreateCard isEn={isEn} />
        </div>
      </div>

      {/* Chat + chips pinned to bottom */}
      <div className="mt-auto space-y-4 pt-12">
        <ChatInput isEn={isEn} />
        <Chips isEn={isEn} rows={rows} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Alex overview builder                                              */
/* ------------------------------------------------------------------ */

function buildOverview(isEn: boolean, rows: ListingRow[], drafts: number, live: number): string {
  if (rows.length === 0) {
    return isEn
      ? "No listings yet. I can help you create your first listing \u2014 just tell me which unit you\u2019d like to list."
      : "Sin listados a\u00FAn. Puedo ayudarte a crear tu primer listado \u2014 solo dime qu\u00E9 unidad quieres publicar.";
  }

  const parts: string[] = [];
  if (isEn) {
    parts.push(`You have **${rows.length} ${rows.length === 1 ? "listing" : "listings"}**`);
    if (drafts > 0 && live > 0) parts.push(` \u2014 ${live} live, ${drafts} in draft`);
    else if (drafts > 0) parts.push(" in draft");
    else parts.push(" live");

    const first = rows[0];
    if (rows.length <= 3 && first) {
      const name = first.property_name && first.unit_name
        ? `${first.property_name} \u2014 ${first.unit_name}`
        : first.title;
      const score = first.readiness_score;
      parts.push(`. ${name} is **${score}% complete**`);
      const { missing } = getReadiness(first);
      if (missing.length > 0) {
        parts.push(` and needs ${missing.map((m) => m.en.toLowerCase()).join(", ")} before it can go live`);
      }
    }
    parts.push(". I can help you finish it, or you can create a new listing below.");
  } else {
    parts.push(`Tienes **${rows.length} ${rows.length === 1 ? "listado" : "listados"}**`);
    if (drafts > 0 && live > 0) parts.push(` \u2014 ${live} ${live === 1 ? "publicado" : "publicados"}, ${drafts} en borrador`);
    else if (drafts > 0) parts.push(" en borrador");
    else parts.push(` ${live === 1 ? "publicado" : "publicados"}`);

    const first = rows[0];
    if (rows.length <= 3 && first) {
      const name = first.property_name && first.unit_name
        ? `${first.property_name} \u2014 ${first.unit_name}`
        : first.title;
      const score = first.readiness_score;
      parts.push(`. ${name} est\u00E1 al **${score}% completo**`);
      const { missing } = getReadiness(first);
      if (missing.length > 0) {
        parts.push(` y necesita ${missing.map((m) => m.es.toLowerCase()).join(", ")} antes de poder publicarse`);
      }
    }
    parts.push(". Puedo ayudarte a terminarlo, o puedes crear un nuevo listado abajo.");
  }

  return parts.join("");
}

/* ------------------------------------------------------------------ */
/* ListingCard                                                        */
/* ------------------------------------------------------------------ */

function ListingCard({ row, isEn }: { row: ListingRow; isEn: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const l = isEn ? 0 : 1;

  const { completed, missing } = getReadiness(row);
  const score = row.readiness_score;
  const scoreColor = score >= 80 ? "text-emerald-500" : score >= 50 ? "text-amber-500" : "text-red-500";
  const barColor = score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500";

  const displayName = row.property_name && row.unit_name
    ? `${row.property_name} \u2014 ${row.unit_name}`
    : row.title || (isEn ? "Untitled listing" : "Listado sin t\u00EDtulo");

  const capacity = [
    row.bedrooms > 0 ? `${row.bedrooms} bed` : null,
    row.bathrooms > 0 ? `${row.bathrooms} bath` : null,
    row.square_meters > 0 ? `${row.square_meters} sqft` : null,
    row.property_type?.toUpperCase(),
  ].filter(Boolean).join(" \u00B7 ");

  const photoCount = row.gallery_image_urls.length + (row.cover_image_url ? 1 : 0);

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="glass-inner overflow-hidden rounded-2xl transition-shadow hover:shadow-[var(--shadow-soft)]"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.3, ease: EASING }}
    >
      {/* Main row */}
      <button
        className="flex w-full items-center gap-4 p-4 text-left sm:p-5"
        onClick={() => setExpanded((p) => !p)}
        type="button"
      >
        {/* Thumbnail */}
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-lg">
          {row.cover_image_url ? "\uD83D\uDCF7" : "\uD83D\uDCF8"}
        </span>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground text-sm tracking-tight">{displayName}</h3>
            <span className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 font-semibold text-[10px] uppercase tracking-wider",
              row.is_published
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-amber-500/20 text-amber-400",
            )}>
              {row.is_published ? (isEn ? "LIVE" : "ACTIVO") : "DRAFT"}
            </span>
          </div>
          {capacity && <p className="mt-0.5 text-muted-foreground/60 text-xs">{capacity}</p>}
          <p className="mt-0.5 text-muted-foreground/40 text-xs italic">
            {isEn ? "Not listed on any channels yet" : "A\u00FAn no publicado en ning\u00FAn canal"}
          </p>
        </div>

        {/* Readiness */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className={cn("font-semibold text-lg tabular-nums", scoreColor)}>{score}%</p>
            <p className="text-muted-foreground/50 text-[10px] uppercase tracking-wider">
              {isEn ? "COMPLETE" : "COMPLETO"}
            </p>
            <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-muted/40">
              <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${score}%` }} />
            </div>
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40 text-muted-foreground/50 text-sm">
            {expanded ? "\u2212" : "+"}
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASING }}
          >
            <div className="border-border/40 border-t px-4 py-5 sm:px-5">
              {/* Completed / Missing checklists */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <p className="mb-2 font-medium text-[11px] text-muted-foreground/60 uppercase tracking-[0.15em]">
                    {isEn ? "COMPLETED" : "COMPLETADO"}
                  </p>
                  <ul className="space-y-1.5">
                    {completed.map((s) => (
                      <li className="flex items-center gap-2 text-muted-foreground/70 text-xs" key={s.key}>
                        <span className="text-emerald-500">{"\u2713"}</span>
                        {s[isEn ? "en" : "es"]}
                      </li>
                    ))}
                    {completed.length === 0 && (
                      <li className="text-muted-foreground/40 text-xs">{isEn ? "Nothing yet" : "Nada a\u00FAn"}</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 font-medium text-[11px] text-muted-foreground/60 uppercase tracking-[0.15em]">
                    {isEn ? "MISSING" : "FALTANTE"}
                  </p>
                  <ul className="space-y-1.5">
                    {missing.map((s) => (
                      <li className="flex items-center gap-2 text-muted-foreground/70 text-xs" key={s.key}>
                        <span className="text-red-400">{"\u25CB"}</span>
                        {s[isEn ? "en" : "es"]}
                        {s.key === "photos" ? ` (${photoCount}/5 min)` : ""}
                      </li>
                    ))}
                    {missing.length === 0 && (
                      <li className="text-emerald-500 text-xs">{isEn ? "All complete!" : "\u00A1Todo completo!"}</li>
                    )}
                  </ul>
                </div>
              </div>

              {/* Distribute to channels */}
              <div className="mt-6">
                <p className="mb-3 font-medium text-[11px] text-muted-foreground/60 uppercase tracking-[0.15em]">
                  {isEn ? "DISTRIBUTE TO CHANNELS" : "DISTRIBUIR A CANALES"}
                </p>
                <div className="space-y-2">
                  {DISTRIBUTION_CHANNELS.map((ch) => (
                    <div
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5",
                        ch.available ? "glass-inner" : "",
                      )}
                      key={ch.name}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-sm">{ch.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground text-xs">{ch.name}</p>
                        <p className="text-muted-foreground/50 text-[11px]">{ch.commission} commission \u00B7 {ch.note[l]}</p>
                      </div>
                      {ch.available ? (
                        <button
                          className="shrink-0 rounded-full border border-border/70 px-3 py-1.5 font-medium text-foreground text-xs transition-colors hover:bg-muted/30"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/app/agents?prompt=${encodeURIComponent(isEn ? `Push ${displayName} to ${ch.name}` : `Publicar ${displayName} en ${ch.name}`)}`);
                          }}
                          type="button"
                        >
                          {isEn ? "Push listing" : "Publicar"}
                        </button>
                      ) : (
                        <span className="shrink-0 text-muted-foreground/40 text-xs">
                          {isEn ? "Connect first \u2192" : "Conectar primero \u2192"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-5 flex flex-wrap gap-2">
                <ActionBtn
                  label={isEn ? "Complete listing with AI" : "Completar con IA"}
                  prompt={isEn ? `Complete my listing for ${displayName}` : `Completa mi listado para ${displayName}`}
                  primary
                />
                <ActionBtn
                  label={isEn ? "Generate description" : "Generar descripci\u00F3n"}
                  prompt={isEn ? `Write a listing description for ${displayName}` : `Escribe una descripci\u00F3n para ${displayName}`}
                />
                <ActionBtn
                  label={isEn ? "Set pricing" : "Configurar precios"}
                  prompt={isEn ? `Set up pricing for ${displayName}` : `Configura precios para ${displayName}`}
                />
                <ActionBtn
                  label={isEn ? "Delete draft" : "Eliminar borrador"}
                  prompt={isEn ? `Delete the draft listing for ${displayName}` : `Eliminar el borrador de ${displayName}`}
                  danger
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* ActionBtn — routes to agents with a prompt                         */
/* ------------------------------------------------------------------ */

function ActionBtn({ label, prompt, primary, danger }: { label: string; prompt: string; primary?: boolean; danger?: boolean }) {
  const router = useRouter();
  return (
    <button
      className={cn(
        "rounded-full border px-4 py-2 font-medium text-xs transition-colors",
        danger
          ? "border-red-500/30 text-red-500 hover:bg-red-500/10"
          : primary
            ? "border-border/70 bg-foreground text-background hover:opacity-90"
            : "border-border/50 text-foreground hover:bg-muted/30",
      )}
      onClick={() => router.push(`/app/agents?prompt=${encodeURIComponent(prompt)}`)}
      type="button"
    >
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* CreateCard                                                         */
/* ------------------------------------------------------------------ */

function CreateCard({ isEn }: { isEn: boolean }) {
  const router = useRouter();
  return (
    <button
      className="group flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/40 p-6 transition-colors hover:border-border/70 hover:bg-muted/10"
      onClick={() =>
        router.push(`/app/agents?prompt=${encodeURIComponent(isEn ? "Create a new listing" : "Crear un nuevo listado")}`)
      }
      type="button"
    >
      <span className="font-medium text-muted-foreground/50 text-sm transition-colors group-hover:text-muted-foreground/70">
        + {isEn ? "Create a new listing" : "Crear un nuevo listado"}
      </span>
    </button>
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
        placeholder={isEn ? "Ask about your listings..." : "Pregunta sobre tus listados..."}
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
/* Chips — contextual to the user's listings                          */
/* ------------------------------------------------------------------ */

function Chips({ isEn, rows }: { isEn: boolean; rows: ListingRow[] }) {
  const first = rows[0];
  const unitName = first?.unit_name ?? (isEn ? "my unit" : "mi unidad");

  const chips = isEn
    ? [
        "Help me complete my listing",
        `Write a listing description for ${unitName}`,
        "What photos should I take?",
        "Set up pricing for my listing",
      ]
    : [
        "Ay\u00FAdame a completar mi listado",
        `Escribe una descripci\u00F3n para ${unitName}`,
        "\u00BFQu\u00E9 fotos deber\u00EDa tomar?",
        "Configura precios para mi listado",
      ];

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
