import { formatCurrency } from "@/lib/format";
import type { ApplicationRow, MessageTemplateOption } from "./types";

export function normalizePhoneForWhatsApp(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D+/g, "");
  return digits || null;
}

export function interpolateTemplate(
  templateText: string,
  context: Record<string, string>
): string {
  if (!templateText) return "";
  return templateText.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_full, key) => {
      const normalizedKey = String(key).trim().toLowerCase();
      return context[normalizedKey] ?? "";
    }
  );
}

export function selectTemplate(
  templates: MessageTemplateOption[],
  channel: "whatsapp" | "email",
  status: string
): MessageTemplateOption | null {
  const filtered = templates.filter(
    (template) =>
      template.is_active && template.channel.trim().toLowerCase() === channel
  );
  if (!filtered.length) return null;

  const normalizedStatus = status.trim().toLowerCase();

  const byExactKey = filtered.find((template) => {
    const templateKey = template.template_key.trim().toLowerCase();
    return (
      templateKey.includes("application") &&
      templateKey.includes(normalizedStatus)
    );
  });
  if (byExactKey) return byExactKey;

  const byGeneric = filtered.find((template) =>
    template.template_key.trim().toLowerCase().includes("application")
  );
  if (byGeneric) return byGeneric;

  return filtered[0];
}

export function buildMessageLinks(
  row: ApplicationRow,
  templates: MessageTemplateOption[],
  isEn: boolean,
  locale: "es-PY" | "en-US"
): {
  emailHref: string | null;
  whatsappHref: string | null;
} {
  const whatsappTemplate = selectTemplate(templates, "whatsapp", row.status);
  const emailTemplate = selectTemplate(templates, "email", row.status);

  const monthlyIncomeLabel =
    row.monthly_income > 0
      ? formatCurrency(row.monthly_income, "PYG", locale)
      : isEn
        ? "not provided"
        : "no declarado";

  const context = {
    full_name: row.full_name,
    listing_title: row.listing_title || (isEn ? "Property" : "Propiedad"),
    status: row.status_label,
    email: row.email,
    phone_e164: row.phone_e164 ?? "",
    monthly_income: monthlyIncomeLabel,
  };

  const whatsappBody = interpolateTemplate(
    whatsappTemplate?.body ||
      (isEn
        ? "Hi {{full_name}}, this is the leasing team for {{listing_title}}. We are reviewing your application and will contact you shortly."
        : "Hola {{full_name}}, te escribe el equipo de leasing de {{listing_title}}. Estamos revisando tu aplicación y te contactaremos pronto."),
    context
  );

  const phone = normalizePhoneForWhatsApp(row.phone_e164);
  const whatsappHref = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(whatsappBody)}`
    : null;

  const emailSubject = interpolateTemplate(
    emailTemplate?.subject ||
      (isEn
        ? "Application update - {{listing_title}}"
        : "Actualización de aplicación - {{listing_title}}"),
    context
  );

  const emailBody = interpolateTemplate(
    emailTemplate?.body ||
      (isEn
        ? "Hi {{full_name}},\n\nWe received your application for {{listing_title}}. Current status: {{status}}.\n\nBest regards,\nPuerta Abierta"
        : "Hola {{full_name}},\n\nRecibimos tu aplicación para {{listing_title}}. Estado actual: {{status}}.\n\nSaludos,\nPuerta Abierta"),
    context
  );

  const email = row.email.trim();
  const emailHref = email
    ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`
    : null;

  return { emailHref, whatsappHref };
}
