"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SectionLabel } from "@/components/agent/briefing/helpers";
import { Icon } from "@/components/ui/icon";
import { useActiveLocale } from "@/lib/i18n/client";
import { EASING, bold, daysRemaining, fmtPyg, initials } from "@/lib/module-helpers";
import { cn } from "@/lib/utils";
import {
  asNumber,
  asString,
  type LeaseRow,
  statusLabel,
} from "./lease-types";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  draft: "bg-muted text-muted-foreground",
  delinquent: "bg-red-500/15 text-red-700 dark:text-red-400",
  terminated: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  completed: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
};

function toRow(r: Record<string, unknown>, isEn: boolean): LeaseRow {
  const status = asString(r.lease_status).trim();
  return {
    id: asString(r.id).trim(),
    tenant_full_name: asString(r.tenant_full_name).trim(),
    tenant_email: asString(r.tenant_email).trim() || null,
    tenant_phone_e164: asString(r.tenant_phone_e164).trim() || null,
    lease_status: status,
    lease_status_label: statusLabel(status, isEn),
    renewal_status: asString(r.renewal_status).trim(),
    property_id: asString(r.property_id).trim() || null,
    unit_id: asString(r.unit_id).trim() || null,
    starts_on: asString(r.starts_on).trim(),
    ends_on: asString(r.ends_on).trim() || null,
    currency: asString(r.currency).trim().toUpperCase() || "PYG",
    monthly_rent: asNumber(r.monthly_rent),
    service_fee_flat: asNumber(r.service_fee_flat),
    security_deposit: asNumber(r.security_deposit),
    guarantee_option_fee: asNumber(r.guarantee_option_fee),
    tax_iva: asNumber(r.tax_iva),
    platform_fee: asNumber(r.platform_fee),
    notes: asString(r.notes).trim() || null,
  };
}

/* ------------------------------------------------------------------ */
/* LeasesManager                                                       */
/* ------------------------------------------------------------------ */

export function LeasesManager({
  orgId,
  leases,
  properties,
  units,
  error: errorLabel,
  success: successMessage,
}: {
  orgId: string;
  leases: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  units: Record<string, unknown>[];
  error?: string;
  success?: string;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const fmtLocale = isEn ? "en-US" : "es-PY";

  const rows = useMemo<LeaseRow[]>(
    () => leases.map((r) => toRow(r, isEn)),
    [leases, isEn],
  );

  // Build property/unit lookup maps
  const propertyMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) {
      const id = asString(p.id).trim();
      if (id) m.set(id, asString(p.name).trim() || id);
    }
    return m;
  }, [properties]);

  const unitMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) {
      const id = asString(u.id).trim();
      if (id) m.set(id, asString(u.name).trim() || asString(u.code).trim() || id);
    }
    return m;
  }, [units]);

  // Computed stats
  const active = rows.filter((r) => r.lease_status === "active" || r.lease_status === "delinquent");
  const totalDue = active.reduce((s, r) => s + r.monthly_rent, 0);
  const delinquent = rows.filter((r) => r.lease_status === "delinquent");
  const expired = rows.filter((r) => {
    const d = daysRemaining(r.ends_on);
    return d !== null && d <= 0 && r.lease_status === "active";
  });
  const expiringSoon = rows.filter((r) => {
    const d = daysRemaining(r.ends_on);
    return d !== null && d > 0 && d <= 60 && r.lease_status === "active";
  });
  const totalUnits = units.length;
  const leasedUnitIds = new Set(active.map((r) => r.unit_id).filter(Boolean));
  const vacantCount = totalUnits - leasedUnitIds.size;

  // Attention items
  const attentionItems: { key: string; emoji: string; text: string; actions: { label: string; prompt: string }[] }[] = [];
  for (const lease of expired) {
    attentionItems.push({
      key: `expired-${lease.id}`,
      emoji: "⚠️",
      text: isEn
        ? `${lease.tenant_full_name}'s lease expired`
        : `El contrato de ${lease.tenant_full_name} venció`,
      actions: [
        {
          label: isEn ? "Send renewal" : "Enviar renovación",
          prompt: isEn
            ? `Send a renewal offer to ${lease.tenant_full_name}`
            : `Enviar oferta de renovación a ${lease.tenant_full_name}`,
        },
        {
          label: isEn ? "Convert to month-to-month" : "Convertir a mes a mes",
          prompt: isEn
            ? `Convert ${lease.tenant_full_name}'s lease to month-to-month`
            : `Convertir contrato de ${lease.tenant_full_name} a mes a mes`,
        },
      ],
    });
  }
  for (const lease of expiringSoon) {
    const d = daysRemaining(lease.ends_on);
    attentionItems.push({
      key: `expiring-${lease.id}`,
      emoji: "📅",
      text: isEn
        ? `${lease.tenant_full_name}'s lease expires in ${d} days`
        : `El contrato de ${lease.tenant_full_name} vence en ${d} días`,
      actions: [
        {
          label: isEn ? "Set reminder" : "Poner recordatorio",
          prompt: isEn
            ? `Set a renewal reminder for ${lease.tenant_full_name}'s lease`
            : `Poner recordatorio de renovación para ${lease.tenant_full_name}`,
        },
      ],
    });
  }
  for (const lease of delinquent) {
    attentionItems.push({
      key: `delinquent-${lease.id}`,
      emoji: "🔴",
      text: isEn
        ? `${lease.tenant_full_name} is behind on rent`
        : `${lease.tenant_full_name} está atrasado en el pago`,
      actions: [
        {
          label: isEn ? "Send reminder" : "Enviar recordatorio",
          prompt: isEn
            ? `Send a payment reminder to ${lease.tenant_full_name}`
            : `Enviar recordatorio de pago a ${lease.tenant_full_name}`,
        },
      ],
    });
  }
  if (vacantCount > 0) {
    attentionItems.push({
      key: "vacant",
      emoji: "🏠",
      text: isEn
        ? `${vacantCount} vacant ${vacantCount === 1 ? "unit" : "units"}`
        : `${vacantCount} ${vacantCount === 1 ? "unidad vacante" : "unidades vacantes"}`,
      actions: [
        {
          label: isEn ? "View listings" : "Ver listados",
          prompt: isEn ? "Show me my vacant units and listings" : "Muéstrame mis unidades vacantes y listados",
        },
      ],
    });
  }

  // Collection progress (simple estimate: active = paid, delinquent = overdue)
  const paidOnTime = active.length - delinquent.length;
  const paidAmount = paidOnTime > 0 ? active.filter((r) => r.lease_status === "active").reduce((s, r) => s + r.monthly_rent, 0) : 0;
  const progressPct = totalDue > 0 ? Math.round((paidAmount / totalDue) * 100) : 0;

  // Month name
  const monthName = new Date().toLocaleString(isEn ? "en-US" : "es-PY", { month: "long" }).toUpperCase();

  // Chips
  const firstTenant = rows[0]?.tenant_full_name;
  const chips = isEn
    ? [
        firstTenant ? `Send a renewal offer to ${firstTenant}` : "Send a renewal offer",
        "Draft a lease for a new tenant",
        "Show me rent collection history",
        "Which leases expire soon?",
      ]
    : [
        firstTenant ? `Enviar oferta de renovación a ${firstTenant}` : "Enviar oferta de renovación",
        "Redactar contrato para nuevo inquilino",
        "Mostrar historial de cobros de alquiler",
        "¿Qué contratos vencen pronto?",
      ];

  return (
    <div className="mx-auto flex min-h-[calc(100vh-7rem)] max-w-5xl flex-col px-4 py-8 sm:px-6">
      <div className="space-y-8">
        {/* Alex overview */}
        <AlexOverview
          activeCount={active.length}
          delinquentCount={delinquent.length}
          expiredLeases={expired}
          isEn={isEn}
          totalUnits={totalUnits}
        />

        {/* Rent Collection Metrics */}
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="glass-inner overflow-hidden rounded-2xl"
          initial={{ opacity: 0, y: 8 }}
          transition={{ delay: 0.1, duration: 0.35, ease: EASING }}
        >
          <div className="p-5">
            <p className="text-muted-foreground/70 text-xs font-medium tracking-wider uppercase">
              {monthName} {isEn ? "RENT COLLECTION" : "COBRO DE ALQUILER"}
            </p>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-semibold text-2xl tabular-nums tracking-tight text-foreground">
                {fmtPyg(paidAmount, fmtLocale)}
              </span>
              <span className="text-muted-foreground/60 text-sm">
                {isEn ? "of" : "de"} {fmtPyg(totalDue, fmtLocale)} {isEn ? "due" : "esperado"}
              </span>
            </div>
            {/* Progress bar */}
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted/60">
              <motion.div
                animate={{ width: `${progressPct}%` }}
                className={cn(
                  "h-full rounded-full",
                  progressPct >= 80 ? "bg-emerald-500" : progressPct >= 50 ? "bg-amber-500" : "bg-red-500",
                )}
                initial={{ width: 0 }}
                transition={{ delay: 0.3, duration: 0.6, ease: EASING }}
              />
            </div>
            {/* Stats row */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label={isEn ? "Paid on time" : "Pagados a tiempo"} value={String(paidOnTime)} tone="success" />
              <MiniStat label={isEn ? "Late" : "Atrasados"} value="0" />
              <MiniStat label={isEn ? "Overdue" : "Morosos"} value={String(delinquent.length)} tone={delinquent.length > 0 ? "danger" : undefined} />
              <MiniStat label={isEn ? "Vacant" : "Vacantes"} value={String(vacantCount)} tone={vacantCount > 0 ? "warning" : undefined} />
            </div>
          </div>
        </motion.div>

        {/* Feedback */}
        {errorLabel ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-red-600 text-sm dark:text-red-400">
            {errorLabel}
          </div>
        ) : null}
        {successMessage ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-emerald-600 text-sm dark:text-emerald-400">
            {successMessage}
          </div>
        ) : null}

        {/* Needs Attention */}
        {attentionItems.length > 0 && (
          <>
            <SectionLabel>{isEn ? "NEEDS ATTENTION" : "REQUIERE ATENCIÓN"}</SectionLabel>
            <div className="space-y-3">
              {attentionItems.map((item) => (
                <AttentionCard item={item} key={item.key} />
              ))}
            </div>
          </>
        )}

        {/* Active Leases */}
        <SectionLabel>{isEn ? "ACTIVE LEASES" : "CONTRATOS ACTIVOS"}</SectionLabel>

        {rows.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <LeaseCard
                fmtLocale={fmtLocale}
                isEn={isEn}
                key={row.id}
                propertyName={row.property_id ? propertyMap.get(row.property_id) : undefined}
                row={row}
                unitName={row.unit_id ? unitMap.get(row.unit_id) : undefined}
              />
            ))}
            <AddLeaseCard isEn={isEn} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AddLeaseCard isEn={isEn} />
          </div>
        )}
      </div>

      {/* Chat + chips pinned to bottom */}
      <div className="mt-auto space-y-4 pt-12">
        <ChatInput isEn={isEn} placeholder={isEn ? "Ask about your leases..." : "Pregunta sobre tus contratos..."} />
        <Chips chips={chips} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AlexOverview                                                        */
/* ------------------------------------------------------------------ */

function AlexOverview({
  activeCount,
  delinquentCount,
  expiredLeases,
  totalUnits,
  isEn,
}: {
  activeCount: number;
  delinquentCount: number;
  expiredLeases: LeaseRow[];
  totalUnits: number;
  isEn: boolean;
}) {
  let text: string;
  if (activeCount === 0 && totalUnits === 0) {
    text = isEn
      ? "No leases yet. Tell me about a tenant and I\u2019ll help you draft a lease."
      : "Sin contratos a\u00FAn. Cu\u00E9ntame sobre un inquilino y te ayudo a redactar un contrato.";
  } else if (activeCount === 0) {
    text = isEn
      ? `You have **${totalUnits} ${totalUnits === 1 ? "unit" : "units"}** but no active leases. Let me help you draft one.`
      : `Tienes **${totalUnits} ${totalUnits === 1 ? "unidad" : "unidades"}** pero sin contratos activos. Te ayudo a crear uno.`;
  } else {
    const parts: string[] = [];
    if (isEn) {
      parts.push(`You have **${activeCount} active ${activeCount === 1 ? "lease" : "leases"}**`);
      if (delinquentCount === 0) {
        parts.push(" \u2014 all tenants are current on rent.");
      } else {
        parts.push(`. **${delinquentCount} ${delinquentCount === 1 ? "tenant is" : "tenants are"} behind** on payments.`);
      }
      if (expiredLeases.length > 0) {
        const name = expiredLeases[0].tenant_full_name;
        parts.push(` ${name}\u2019s lease has expired \u2014 consider sending a renewal.`);
      }
    } else {
      parts.push(`Tienes **${activeCount} ${activeCount === 1 ? "contrato activo" : "contratos activos"}**`);
      if (delinquentCount === 0) {
        parts.push(" \u2014 todos los inquilinos est\u00E1n al d\u00EDa.");
      } else {
        parts.push(`. **${delinquentCount} ${delinquentCount === 1 ? "inquilino est\u00E1 atrasado" : "inquilinos est\u00E1n atrasados"}** en pagos.`);
      }
      if (expiredLeases.length > 0) {
        const name = expiredLeases[0].tenant_full_name;
        parts.push(` El contrato de ${name} ha vencido \u2014 considera enviar una renovaci\u00F3n.`);
      }
    }
    text = parts.join("");
  }

  return (
    <div className="space-y-1">
      <p className="font-semibold text-foreground text-sm">Alex</p>
      <p className="text-muted-foreground text-sm leading-relaxed">{bold(text)}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MiniStat                                                            */
/* ------------------------------------------------------------------ */

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div>
      <p
        className={cn(
          "font-semibold text-lg tabular-nums",
          tone === "success" && "text-emerald-600 dark:text-emerald-400",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-red-600 dark:text-red-400",
          !tone && "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="text-muted-foreground/60 text-xs">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AttentionCard                                                       */
/* ------------------------------------------------------------------ */

function AttentionCard({
  item,
}: {
  item: { emoji: string; text: string; actions: { label: string; prompt: string }[] };
}) {
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="glass-inner flex items-start gap-3 rounded-xl p-4"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.3, ease: EASING }}
    >
      <span className="mt-0.5 text-base">{item.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm">{item.text}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {item.actions.map((a) => (
            <Link
              className="rounded-full border border-border/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
              href={`/app/agents?prompt=${encodeURIComponent(a.prompt)}`}
              key={a.label}
            >
              {a.label}
            </Link>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* LeaseCard                                                           */
/* ------------------------------------------------------------------ */

function LeaseCard({
  row,
  isEn,
  fmtLocale,
  propertyName,
  unitName,
}: {
  row: LeaseRow;
  isEn: boolean;
  fmtLocale: string;
  propertyName?: string;
  unitName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const days = daysRemaining(row.ends_on);
  const status = row.lease_status.toLowerCase();
  const colorClass = STATUS_COLORS[status] ?? STATUS_COLORS.draft;

  const location = [propertyName, unitName].filter(Boolean).join(" · ");

  let daysLabel: string;
  if (days === null) {
    daysLabel = isEn ? "No end date" : "Sin fecha de fin";
  } else if (days < 0) {
    daysLabel = isEn ? `Expired ${Math.abs(days)}d ago` : `Venció hace ${Math.abs(days)}d`;
  } else if (days === 0) {
    daysLabel = isEn ? "Expires today" : "Vence hoy";
  } else {
    daysLabel = isEn ? `${days}d remaining` : `${days}d restantes`;
  }

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="glass-inner overflow-hidden rounded-2xl transition-shadow hover:shadow-[var(--shadow-soft)]"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.3, ease: EASING }}
    >
      <button
        className="flex w-full items-start gap-3 p-4 text-left sm:p-5"
        onClick={() => setExpanded((p) => !p)}
        type="button"
      >
        {/* Initials avatar */}
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/60 font-medium text-foreground/70 text-xs">
          {initials(row.tenant_full_name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground text-sm tracking-tight">
              {row.tenant_full_name}
            </h3>
            <span className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", colorClass)}>
              {row.lease_status_label}
            </span>
          </div>

          <p className="mt-0.5 truncate text-muted-foreground/60 text-xs">
            {location || (isEn ? "No unit assigned" : "Sin unidad asignada")}
          </p>

          <div className="mt-2.5 flex items-center gap-3 text-xs">
            <span className="font-medium tabular-nums text-foreground">
              {fmtPyg(row.monthly_rent, fmtLocale)}<span className="text-muted-foreground/50">/mo</span>
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span className={cn(
              "tabular-nums",
              days !== null && days <= 0 ? "text-red-600 dark:text-red-400" : days !== null && days <= 30 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
            )}>
              {daysLabel}
            </span>
          </div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASING }}
          >
            <div className="border-border/40 border-t px-4 py-4 sm:px-5">
              {/* Lease terms grid */}
              <p className="mb-2 text-muted-foreground/50 text-[10px] font-medium tracking-wider uppercase">
                {isEn ? "LEASE TERMS" : "TÉRMINOS DEL CONTRATO"}
              </p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Stat label={isEn ? "Start" : "Inicio"} value={row.starts_on || "—"} />
                <Stat label={isEn ? "End" : "Fin"} value={row.ends_on || "—"} />
                <Stat label={isEn ? "Monthly rent" : "Alquiler mensual"} value={fmtPyg(row.monthly_rent, fmtLocale)} />
                <Stat label={isEn ? "Security deposit" : "Depósito"} value={fmtPyg(row.security_deposit, fmtLocale)} />
                <Stat label={isEn ? "IVA" : "IVA"} value={fmtPyg(row.tax_iva, fmtLocale)} />
                <Stat label={isEn ? "Service fee" : "Tarifa de servicio"} value={fmtPyg(row.service_fee_flat, fmtLocale)} />
              </div>

              {/* Tenant contact */}
              {(row.tenant_email || row.tenant_phone_e164) && (
                <div className="mt-4">
                  <p className="mb-2 text-muted-foreground/50 text-[10px] font-medium tracking-wider uppercase">
                    {isEn ? "TENANT CONTACT" : "CONTACTO DEL INQUILINO"}
                  </p>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {row.tenant_email && <p>{row.tenant_email}</p>}
                    {row.tenant_phone_e164 && <p>{row.tenant_phone_e164}</p>}
                  </div>
                </div>
              )}

              {/* Notes */}
              {row.notes && (
                <div className="mt-4">
                  <p className="mb-2 text-muted-foreground/50 text-[10px] font-medium tracking-wider uppercase">
                    {isEn ? "NOTES" : "NOTAS"}
                  </p>
                  <p className="text-muted-foreground text-xs leading-relaxed">{row.notes}</p>
                </div>
              )}

              {/* Action buttons */}
              <div className="mt-4 flex flex-wrap gap-2">
                <ActionChip
                  label={isEn ? "Send renewal offer" : "Enviar renovación"}
                  prompt={isEn ? `Send a renewal offer to ${row.tenant_full_name}` : `Enviar oferta de renovación a ${row.tenant_full_name}`}
                />
                <ActionChip
                  label={isEn ? "Message tenant" : "Enviar mensaje"}
                  prompt={isEn ? `Send a message to ${row.tenant_full_name}` : `Enviar mensaje a ${row.tenant_full_name}`}
                />
                <ActionChip
                  label={isEn ? "Record payment" : "Registrar pago"}
                  prompt={isEn ? `Record a rent payment for ${row.tenant_full_name}` : `Registrar pago de alquiler de ${row.tenant_full_name}`}
                />
                <ActionChip
                  label={isEn ? "Generate document" : "Generar documento"}
                  prompt={isEn ? `Generate a lease document for ${row.tenant_full_name}` : `Generar documento de contrato para ${row.tenant_full_name}`}
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
/* Stat                                                                */
/* ------------------------------------------------------------------ */

function Stat({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div>
      <p className="text-muted-foreground/60">{label}</p>
      <p
        className={cn(
          "font-medium tabular-nums",
          tone === "success" && "text-emerald-600 dark:text-emerald-400",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-red-600 dark:text-red-400",
          !tone && "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ActionChip                                                          */
/* ------------------------------------------------------------------ */

function ActionChip({ label, prompt }: { label: string; prompt: string }) {
  return (
    <Link
      className="rounded-full border border-border/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
      href={`/app/agents?prompt=${encodeURIComponent(prompt)}`}
    >
      {label}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* AddLeaseCard                                                        */
/* ------------------------------------------------------------------ */

function AddLeaseCard({ isEn }: { isEn: boolean }) {
  const router = useRouter();

  return (
    <button
      className="group flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/40 p-6 transition-colors hover:border-border/70 hover:bg-muted/10"
      onClick={() =>
        router.push(
          `/app/agents?prompt=${encodeURIComponent(isEn ? "Draft a lease for a new tenant" : "Redactar un contrato para nuevo inquilino")}`,
        )
      }
      type="button"
    >
      <span className="text-muted-foreground/40 text-xl transition-colors group-hover:text-muted-foreground/60">+</span>
      <span className="font-medium text-muted-foreground/50 text-sm transition-colors group-hover:text-muted-foreground/70">
        {isEn ? "Create a new lease" : "Crear un nuevo contrato"}
      </span>
      <span className="text-muted-foreground/30 text-xs transition-colors group-hover:text-muted-foreground/50">
        {isEn ? "Tell Alex about your tenant" : "Cuéntale a Alex sobre tu inquilino"}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* ChatInput                                                           */
/* ------------------------------------------------------------------ */

function ChatInput({ isEn, placeholder }: { isEn: boolean; placeholder: string }) {
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
        placeholder={placeholder}
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
/* Chips                                                               */
/* ------------------------------------------------------------------ */

function Chips({ chips }: { chips: string[] }) {
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
