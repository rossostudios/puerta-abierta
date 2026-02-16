import type { Locale } from "@/lib/i18n";

export type ModuleDef = {
  slug: string;
  label: string;
  label_en?: string;
  endpoint: string;
  description: string;
  description_en?: string;
  kind?: "list" | "report";
};

export const MODULES: ModuleDef[] = [
  {
    slug: "organizations",
    label: "Organizaciones",
    label_en: "Organizations",
    endpoint: "/organizations",
    description:
      "Administra organizaciones de propietarios, membresías y configuración.",
    description_en:
      "Manage owner organizations, memberships, and workspace settings.",
  },
  {
    slug: "properties",
    label: "Propiedades",
    label_en: "Properties",
    endpoint: "/properties",
    description: "Controla propiedades dentro de cada organización.",
    description_en: "Track properties within each organization.",
  },
  {
    slug: "units",
    label: "Unidades",
    label_en: "Units",
    endpoint: "/units",
    description: "Configura unidades rentables, capacidades y valores base.",
    description_en: "Configure rentable units, capacity, and base defaults.",
  },
  {
    slug: "integrations",
    label: "Integraciones",
    label_en: "Integrations",
    endpoint: "/integrations",
    description: "Conecta unidades a OTAs y canales de venta directa con sync iCal.",
    description_en: "Connect units to OTAs and direct-sales channels with iCal sync.",
  },
  {
    slug: "guests",
    label: "Huéspedes",
    label_en: "Guests",
    endpoint: "/guests",
    description: "Perfiles centralizados de huéspedes e historial de contacto.",
    description_en: "Centralized guest profiles and contact history.",
  },
  {
    slug: "reservations",
    label: "Reservas",
    label_en: "Reservations",
    endpoint: "/reservations",
    description: "Ciclo de vida de la reserva y datos listos para liquidación.",
    description_en: "Reservation lifecycle and payout-ready data.",
  },
  {
    slug: "tasks",
    label: "Tareas",
    label_en: "Tasks",
    endpoint: "/tasks",
    description: "Flujos operativos de limpieza y mantenimiento.",
    description_en: "Operations workflows for cleaning and maintenance.",
  },
  {
    slug: "expenses",
    label: "Gastos",
    label_en: "Expenses",
    endpoint: "/expenses",
    description: "Seguimiento de gastos por reserva, unidad y propiedad.",
    description_en: "Track expenses by reservation, unit, and property.",
  },
  {
    slug: "owner-statements",
    label: "Estados del propietario",
    label_en: "Owner statements",
    endpoint: "/owner-statements",
    description: "Borrador, cierre y conciliación de pagos mensuales.",
    description_en: "Draft, close, and reconcile monthly payouts.",
  },
  {
    slug: "pricing",
    label: "Plantillas de precios",
    label_en: "Pricing templates",
    endpoint: "/pricing/templates",
    description:
      "Modela el desglose transparente de ingreso con líneas obligatorias.",
    description_en:
      "Model transparent move-in breakdown templates with mandatory fee lines.",
  },
  {
    slug: "listings",
    label: "Anuncios del marketplace",
    label_en: "Listings",
    endpoint: "/listings",
    description:
      "Publica anuncios de renta de largo plazo con validación de transparencia.",
    description_en:
      "Publish long-term rental listings with transparency validation.",
  },
  {
    slug: "applications",
    label: "Aplicaciones",
    label_en: "Applications",
    endpoint: "/applications",
    description: "Gestiona el funnel de calificación y conversión a contrato.",
    description_en:
      "Manage the qualification funnel and lease conversion workflow.",
  },
  {
    slug: "leases",
    label: "Contratos",
    label_en: "Leases",
    endpoint: "/leases",
    description:
      "Administra contratos, cargos y estado de cobranza de alquileres.",
    description_en:
      "Manage lease records, charges, and rent collection status.",
  },
  {
    slug: "collections",
    label: "Cobros",
    label_en: "Collections",
    endpoint: "/collections",
    description:
      "Orquesta cobranza mensual sin custodia de fondos dentro de la plataforma.",
    description_en:
      "Orchestrate monthly collections without in-platform fund custody.",
  },
  {
    slug: "messaging",
    label: "Mensajería",
    label_en: "Messaging",
    endpoint: "/message-templates",
    description: "Mensajes por plantillas para WhatsApp, email y SMS.",
    description_en: "Template messaging for WhatsApp, email, and SMS.",
  },
  {
    slug: "integration-events",
    label: "Eventos de integración",
    label_en: "Integration events",
    endpoint: "/integration-events",
    description: "Payloads entrantes de webhooks y estado de procesamiento.",
    description_en: "Incoming webhook payloads and processing status.",
  },
  {
    slug: "audit-logs",
    label: "Registros de auditoría",
    label_en: "Audit logs",
    endpoint: "/audit-logs",
    description:
      "Historial inmutable de cambios críticos y transiciones de estado.",
    description_en:
      "Immutable history of critical changes and state transitions.",
  },
  {
    slug: "transparency-summary",
    label: "Resumen de transparencia",
    label_en: "Transparency summary",
    endpoint: "/reports/transparency-summary",
    description:
      "KPIs semanales de transparencia de precios, funnel de aplicaciones y cobros.",
    description_en:
      "Weekly KPIs for pricing transparency, applications funnel, and collections.",
    kind: "report",
  },
  {
    slug: "reports",
    label: "Reportes",
    label_en: "Reports",
    endpoint: "/reports",
    description:
      "Hub centralizado para resumen del propietario, estados y transparencia.",
    description_en:
      "Centralized hub for owner summary, statements, and transparency reports.",
  },
  {
    slug: "documents",
    label: "Documentos",
    label_en: "Documents",
    endpoint: "/documents",
    description:
      "Gestiona contratos, recibos, fotos e inspecciones adjuntos a propiedades y contratos.",
    description_en:
      "Manage contracts, receipts, photos, and inspections attached to properties and leases.",
  },
  {
    slug: "workflow-rules",
    label: "Automatizaciones",
    label_en: "Automations",
    endpoint: "/workflow-rules",
    description:
      "Reglas automáticas: cuando ocurre un evento, ejecutar una acción.",
    description_en:
      "Automation rules: when an event occurs, execute an action.",
  },
  {
    slug: "billing",
    label: "Facturación",
    label_en: "Billing",
    endpoint: "/billing/current",
    description:
      "Plan de suscripción, uso y configuración de facturación.",
    description_en:
      "Subscription plan, usage, and billing configuration.",
  },
];

export const MODULE_BY_SLUG = new Map(
  MODULES.map((module) => [module.slug, module])
);

export function getModuleLabel(module: ModuleDef, locale: Locale): string {
  return locale === "en-US" ? (module.label_en ?? module.label) : module.label;
}

export function getModuleDescription(
  module: ModuleDef,
  locale: Locale
): string {
  return locale === "en-US"
    ? (module.description_en ?? module.description)
    : module.description;
}

export function findModuleByLabel(
  value: string,
  locale: Locale
): ModuleDef | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  for (const module of MODULES) {
    const candidates = new Set([
      module.label,
      module.label_en ?? "",
      getModuleLabel(module, locale),
    ]);
    for (const candidate of candidates) {
      if (candidate && candidate.toLowerCase() === normalized) return module;
    }
  }
  return null;
}
