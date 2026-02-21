import {
  ArtificialIntelligence02Icon,
  ChartIcon,
  CheckmarkCircle02Icon,
  Home01Icon,
  InboxIcon,
  MailOpen01Icon,
  MailReply01Icon,
  Message01Icon,
  Settings02Icon,
  SparklesIcon,
  StarIcon,
  Task01Icon,
  WorkflowSquare03Icon,
} from "@hugeicons/core-free-icons";
import type { PrimaryTabKey, RouteLinkDef, SectionDef } from "./sidebar-types";

export const PRIMARY_TABS: Array<{
  key: PrimaryTabKey;
  href: string;
  icon: typeof Home01Icon;
  label: { "es-PY": string; "en-US": string };
}> = [
    {
      key: "home",
      href: "/app",
      icon: Home01Icon,
      label: { "es-PY": "Inicio", "en-US": "Home" },
    },
    {
      key: "chat",
      href: "/app/agents",
      icon: Message01Icon,
      label: { "es-PY": "Agente", "en-US": "Agent" },
    },
    {
      key: "inbox",
      href: "/module/messaging",
      icon: InboxIcon,
      label: { "es-PY": "Inbox", "en-US": "Inbox" },
    },
  ];

export const CHAT_LINKS: RouteLinkDef[] = [
  {
    href: "/app/agents",
    icon: SparklesIcon,
    label: { "es-PY": "Agentes", "en-US": "Agents" },
  },
  {
    href: "/app/chats",
    icon: InboxIcon,
    label: { "es-PY": "Historial de chats", "en-US": "Chat history" },
  },
  {
    href: "/module/knowledge",
    icon: SparklesIcon,
    label: { "es-PY": "Base de conocimiento", "en-US": "Knowledge Base" },
  },
  {
    href: "/module/agent-dashboard",
    icon: ArtificialIntelligence02Icon,
    label: { "es-PY": "Panel de agentes", "en-US": "Agent Dashboard" },
  },
  {
    href: "/module/agent-config",
    icon: Settings02Icon,
    label: { "es-PY": "Configuración de agentes", "en-US": "Agent Config" },
  },
];

export const INBOX_STATUS_LINKS: RouteLinkDef[] = [
  {
    href: "/module/messaging",
    icon: InboxIcon,
    label: { "es-PY": "Todos los mensajes", "en-US": "All Messages" },
  },
  {
    href: "/module/messaging?status=unread",
    icon: MailOpen01Icon,
    label: { "es-PY": "No leídos", "en-US": "Unread Messages" },
  },
  {
    href: "/module/messaging?status=awaiting",
    icon: MailReply01Icon,
    label: { "es-PY": "Esperando respuesta", "en-US": "Awaiting Reply" },
  },
  {
    href: "/module/messaging?status=resolved",
    icon: CheckmarkCircle02Icon,
    label: { "es-PY": "Resueltos", "en-US": "Resolved" },
  },
  {
    href: "/module/messaging?status=starred",
    icon: StarIcon,
    label: { "es-PY": "Destacados", "en-US": "Starred" },
  },
];

export const INBOX_SEGMENT_LINKS: RouteLinkDef[] = [
  {
    href: "/module/messaging?segment=needs-engagement",
    icon: Message01Icon,
    label: { "es-PY": "Necesita atención", "en-US": "Needs engagement" },
  },
  {
    href: "/module/messaging?segment=lovable",
    icon: StarIcon,
    label: { "es-PY": "Encantadores", "en-US": "Lovable" },
  },
];

export const SECTIONS: SectionDef[] = [
  {
    key: "portfolio",
    label: {
      "es-PY": "Portafolio",
      "en-US": "Portfolio",
    },
    moduleSlugs: ["properties", "units", "integrations"],
    roles: ["owner_admin", "operator"],
  },
  {
    key: "rentals",
    label: {
      "es-PY": "Alquileres",
      "en-US": "Rentals",
    },
    moduleSlugs: ["listings", "leases", "reservations", "calendar", "reviews"],
    roles: ["owner_admin", "operator"],
  },
  {
    key: "operations",
    label: {
      "es-PY": "Operaciones",
      "en-US": "Operations",
    },
    routeLinks: [
      {
        href: "/module/operations?tab=tasks",
        icon: Task01Icon,
        label: { "es-PY": "Operaciones", "en-US": "Operations" },
      },
      {
        href: "/module/automations?tab=rules",
        icon: WorkflowSquare03Icon,
        label: { "es-PY": "Automatizaciones", "en-US": "Automations" },
        roles: ["owner_admin", "operator"],
      },
    ],
    moduleSlugs: ["guests"],
    roles: ["owner_admin", "operator", "cleaner"],
  },
  {
    key: "finance",
    label: {
      "es-PY": "Finanzas",
      "en-US": "Finance",
    },
    routeLinks: [
      {
        href: "/module/reports/finance",
        icon: ChartIcon,
        label: { "es-PY": "Ingresos", "en-US": "Income" },
      },
    ],
    moduleSlugs: ["expenses", "reports"],
    roles: ["owner_admin", "accountant"],
  },
  {
    key: "workspace",
    label: {
      "es-PY": "Espacio de trabajo",
      "en-US": "Workspace",
    },
    moduleSlugs: ["documents", "billing"],
    roles: ["owner_admin"],
  },
];

export const COLLAPSED_SECTIONS_KEY = "pa-sidebar-collapsed-sections";
export const APPLE_DEVICE_REGEX = /Mac|iPhone|iPad/i;

export const HOME_TAB_HIDDEN_MODULE_SLUGS = new Set([
  "applications",
  "collections",
  "maintenance",
  "messaging",
  "notification-rules",
  "notifications",
  "transparency-summary",
  "organizations",
  "integration-events",
  "audit-logs",
  "sequences",
  "tasks",
  "workflow-rules",
  "owner-statements",
  "pricing",
  "knowledge",
  "agent-dashboard",
  "agent-config",
]);
