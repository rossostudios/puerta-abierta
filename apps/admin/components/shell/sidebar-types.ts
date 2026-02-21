import {
  ArtificialIntelligence02Icon,
  AuditIcon,
  Building01Icon,
  Calendar03Icon,
  CalendarCheckIn01Icon,
  ChartIcon,
  CreditCardIcon,
  Door01Icon,
  File01Icon,
  FolderAttachmentIcon,
  GridViewIcon,
  Home01Icon,
  Invoice01Icon,
  Link01Icon,
  Message01Icon,
  Notification03Icon,
  RepeatIcon,
  Settings02Icon,
  SparklesIcon,
  StarIcon,
  Task01Icon,
  UserGroupIcon,
  WebhookIcon,
  WorkflowSquare03Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import type { Locale } from "@/lib/i18n";

export const MODULE_ICONS: Record<string, IconSvgElement> = {
  organizations: Building01Icon,
  properties: Home01Icon,
  units: Door01Icon,
  integrations: Link01Icon,
  guests: UserGroupIcon,
  reservations: CalendarCheckIn01Icon,
  calendar: Calendar03Icon,
  maintenance: Wrench01Icon,
  tasks: Task01Icon,
  expenses: Invoice01Icon,
  "owner-statements": File01Icon,
  pricing: SparklesIcon,
  listings: Home01Icon,
  applications: UserGroupIcon,
  leases: File01Icon,
  collections: Invoice01Icon,
  "transparency-summary": ChartIcon,
  messaging: Message01Icon,
  notifications: Notification03Icon,
  "integration-events": WebhookIcon,
  "audit-logs": AuditIcon,
  reports: ChartIcon,
  documents: FolderAttachmentIcon,
  sequences: RepeatIcon,
  "workflow-rules": WorkflowSquare03Icon,
  billing: CreditCardIcon,
  "notification-rules": GridViewIcon,
  knowledge: SparklesIcon,
  "agent-dashboard": ArtificialIntelligence02Icon,
  "agent-config": Settings02Icon,
  reviews: StarIcon,
};

export type ViewportMode = "desktop" | "tablet" | "mobile";

export type SectionKey =
  | "workspace"
  | "rentals"
  | "operations"
  | "portfolio"
  | "finance"
  | "other";

export type PrimaryTabKey = "home" | "chat" | "inbox";

export type RouteLinkDef = {
  href: string;
  icon: IconSvgElement;
  label: {
    "es-PY": string;
    "en-US": string;
  };
  roles?: MemberRole[];
};

export type MemberRole =
  | "owner_admin"
  | "operator"
  | "cleaner"
  | "accountant"
  | "viewer";

export type SectionDef = {
  key: SectionKey;
  label: {
    "es-PY": string;
    "en-US": string;
  };
  routeLinks?: RouteLinkDef[];
  moduleSlugs: string[];
  roles?: MemberRole[];
};

export type ResolvedLink = {
  href: string;
  label: string;
  iconElement: IconSvgElement;
  count?: number | null;
  badge?: string | null;
};

export type ResolvedSection = {
  key: SectionKey;
  label: string;
  links: ResolvedLink[];
};

export type OnboardingProgress = {
  completedSteps: number;
  totalSteps: number;
  percent: number;
};

export type ChatAgentItem = {
  id: string;
  slug: string;
  name: string;
};

export type ChatSummaryItem = {
  id: string;
  title: string;
  is_archived: boolean;
  latest_message_preview?: string | null;
};

export type SidebarContentProps = {
  locale: Locale;
  orgId: string | null;
  onboardingProgress?: OnboardingProgress;
  role?: MemberRole | null;
};
