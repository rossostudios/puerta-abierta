import type { StatusTone } from "@/components/ui/status-badge";
import { RESPONSE_SLA_TARGET_MINUTES } from "./constants";
import type { ApplicationRow } from "./types";

export function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

export function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function asBoolean(value: unknown): boolean {
  return value === true;
}

export function statusLabel(value: string, isEn: boolean): string {
  const normalized = value.trim().toLowerCase();
  if (isEn) return normalized || "unknown";

  if (normalized === "new") return "Nuevo";
  if (normalized === "screening") return "Evaluación";
  if (normalized === "qualified") return "Calificado";
  if (normalized === "visit_scheduled") return "Visita agendada";
  if (normalized === "offer_sent") return "Oferta enviada";
  if (normalized === "contract_signed") return "Contrato firmado";
  if (normalized === "rejected") return "Rechazado";
  if (normalized === "lost") return "Perdido";
  return normalized || "desconocido";
}

export function canConvert(status: string): boolean {
  return ["qualified", "visit_scheduled", "offer_sent"].includes(
    status.trim().toLowerCase()
  );
}

export function canMoveToScreening(status: string): boolean {
  return status.trim().toLowerCase() === "new";
}

export function canMoveToQualified(status: string): boolean {
  return ["screening", "visit_scheduled"].includes(status.trim().toLowerCase());
}

export function normalizeSlaStatus(
  row: ApplicationRow
): "pending" | "met" | "breached" {
  const normalized = asString(row.response_sla_status).trim().toLowerCase();
  if (normalized === "pending") return "pending";
  if (normalized === "met") return "met";
  if (normalized === "breached") return "breached";

  if (row.first_response_minutes > 0) {
    return row.first_response_minutes <= RESPONSE_SLA_TARGET_MINUTES
      ? "met"
      : "breached";
  }

  const created = new Date(row.created_at);
  if (Number.isNaN(created.valueOf())) return "pending";

  const dueAtMs = created.valueOf() + RESPONSE_SLA_TARGET_MINUTES * 60_000;
  return Date.now() > dueAtMs ? "breached" : "pending";
}

export function slaBadgeLabel(
  status: "pending" | "met" | "breached",
  isEn: boolean
): string {
  if (status === "met") {
    return isEn ? "SLA met" : "SLA cumplido";
  }
  if (status === "breached") {
    return isEn ? "SLA breached" : "SLA vencido";
  }
  return isEn ? "Pending response" : "Pendiente de respuesta";
}

export function formatDateTimeLabel(
  value: string,
  locale: "es-PY" | "en-US"
): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "-";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function statusBadgeClass(status: string): StatusTone {
  const normalized = status.trim().toLowerCase();
  if (normalized === "contract_signed") return "success";
  if (normalized === "qualified" || normalized === "offer_sent") return "info";
  if (normalized === "visit_scheduled") return "info";
  if (normalized === "screening" || normalized === "new") return "warning";
  if (normalized === "rejected" || normalized === "lost") return "danger";
  return "neutral";
}

export function slaBadgeClass(
  status: "pending" | "met" | "breached",
  alertLevel: string
): StatusTone {
  const normalizedLevel = alertLevel.trim().toLowerCase();
  if (status === "breached" || normalizedLevel === "critical") return "danger";
  if (normalizedLevel === "warning") return "warning";
  if (status === "met") return "success";
  return "neutral";
}

export function qualificationBandLabel(band: string, isEn: boolean): string {
  const normalized = band.trim().toLowerCase();
  if (normalized === "strong") return isEn ? "Strong" : "Fuerte";
  if (normalized === "moderate") return isEn ? "Moderate" : "Moderado";
  if (normalized === "watch") return isEn ? "Watch" : "Revisar";
  return isEn ? "Unscored" : "Sin puntuar";
}

export function qualificationBandClass(band: string): StatusTone {
  const normalized = band.trim().toLowerCase();
  if (normalized === "strong") return "success";
  if (normalized === "moderate") return "info";
  if (normalized === "watch") return "warning";
  return "neutral";
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}
