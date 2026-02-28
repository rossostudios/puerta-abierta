"use client";

import {
  AiBrain01Icon,
  AlertDiamondIcon,
  ArrowLeft01Icon,
  Audit01Icon,
  DashboardSquare01Icon,
  Settings02Icon,
  TaskEdit01Icon,
} from "@hugeicons/core-free-icons";
import { useState } from "react";
import { ApprovalQueue } from "@/components/agent/approval-queue";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AgentConfigManager } from "./agent-config-manager";
import { ApprovalPolicies } from "./approval-policies";
import { EscalationThresholds } from "./escalation-thresholds";
import { FailSafeBoundaries } from "./fail-safe-boundaries";
import { GuardrailConfig } from "./guardrail-config";
import { MemoryGovernance } from "./memory-governance";
import { PermissionsTab } from "./permissions-tab";
import { PiiAuditLog } from "./pii-audit-log";
import { RateLimitsSection } from "./rate-limits-section";
import { SecurityAudit } from "./security-audit";
import { StatusDashboard } from "./status-dashboard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GovernanceManagerProps = {
  orgId: string;
  locale: Locale;
};

type SectionKey =
  | "overview"
  | "agents"
  | "approvals"
  | "guardrails"
  | "boundaries"
  | "privacy"
  | "advanced";

type SectionDef = {
  key: SectionKey;
  labelEn: string;
  labelEs: string;
  icon: typeof DashboardSquare01Icon;
  dividerBefore?: boolean;
};

// ---------------------------------------------------------------------------
// Nav sections
// ---------------------------------------------------------------------------

const SECTIONS: SectionDef[] = [
  {
    key: "overview",
    labelEn: "Overview",
    labelEs: "Resumen",
    icon: DashboardSquare01Icon,
  },
  {
    key: "agents",
    labelEn: "Agent Config",
    labelEs: "Config. de Agentes",
    icon: Settings02Icon,
  },
  {
    key: "approvals",
    labelEn: "Task Approvals",
    labelEs: "Aprobaciones",
    icon: TaskEdit01Icon,
  },
  {
    key: "guardrails",
    labelEn: "Guardrails & Memory",
    labelEs: "Barreras y memoria",
    icon: AiBrain01Icon,
  },
  {
    key: "boundaries",
    labelEn: "Fail-Safe Boundaries",
    labelEs: "Límites de seguridad",
    icon: AlertDiamondIcon,
  },
  {
    key: "privacy",
    labelEn: "Privacy & Audits",
    labelEs: "Privacidad y auditorías",
    icon: Audit01Icon,
  },
  {
    key: "advanced",
    labelEn: "Advanced",
    labelEs: "Avanzado",
    icon: Settings02Icon,
    dividerBefore: true,
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GovernanceManager({
  orgId,
  locale,
}: GovernanceManagerProps) {
  const isEn = locale === "en-US";
  const [activeSection, setActiveSection] = useState<SectionKey>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex min-h-[calc(100vh-80px)]">
      {/* ── Secondary sidebar ────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex shrink-0 flex-col overflow-hidden border-sidebar-border/60 border-r bg-sidebar/50 transition-[width] duration-200 ease-in-out",
          sidebarOpen ? "w-[220px]" : "w-0 border-r-0"
        )}
      >
        {/* Header */}
        <div className="flex w-[220px] items-center gap-2 border-sidebar-border/40 border-b px-4 py-3.5">
          <button
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent transition-colors hover:bg-sidebar-primary/20"
            onClick={() => setSidebarOpen(false)}
            title={isEn ? "Collapse sidebar" : "Colapsar barra lateral"}
            type="button"
          >
            <Icon
              className="text-sidebar-foreground/60"
              icon={ArrowLeft01Icon}
              size={14}
            />
          </button>
          <h2 className="whitespace-nowrap font-semibold text-[13px] text-sidebar-foreground tracking-tight">
            {isEn ? "AI Settings" : "Config. IA"}
          </h2>
        </div>

        {/* Nav items */}
        <nav className="w-[220px] flex-1 overflow-y-auto px-2 py-2">
          {SECTIONS.map((section) => {
            const active = activeSection === section.key;
            return (
              <div key={section.key}>
                {section.dividerBefore && (
                  <div className="mx-2 my-2 border-sidebar-border/30 border-t" />
                )}
                <button
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left transition-all duration-150",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-casaora"
                      : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  )}
                  onClick={() => setActiveSection(section.key)}
                  type="button"
                >
                  <Icon
                    className={cn(
                      "shrink-0 transition-colors",
                      active
                        ? "text-sidebar-primary"
                        : "text-sidebar-foreground/40 group-hover:text-sidebar-foreground/60"
                    )}
                    icon={section.icon}
                    size={15}
                  />
                  <span className="truncate font-medium text-[12.5px]">
                    {isEn ? section.labelEn : section.labelEs}
                  </span>
                </button>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* ── Main content area ────────────────────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-5">
          {!sidebarOpen && (
            <button
              className="mb-4 flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-[12px] text-muted-foreground/60 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/80"
              onClick={() => setSidebarOpen(true)}
              type="button"
            >
              <Icon className="rotate-180" icon={ArrowLeft01Icon} size={13} />
              {isEn ? "Show sidebar" : "Mostrar barra lateral"}
            </button>
          )}
          <SectionContent
            activeSection={activeSection}
            isEn={isEn}
            locale={locale}
            orgId={orgId}
          />
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section content router
// ---------------------------------------------------------------------------

function SectionContent({
  activeSection,
  isEn,
  locale,
  orgId,
}: {
  activeSection: SectionKey;
  isEn: boolean;
  locale: Locale;
  orgId: string;
}) {
  switch (activeSection) {
    case "overview":
      return <OverviewSection isEn={isEn} orgId={orgId} />;
    case "agents":
      return <AgentsSection isEn={isEn} locale={locale} orgId={orgId} />;
    case "approvals":
      return <ApprovalsSection isEn={isEn} locale={locale} orgId={orgId} />;
    case "guardrails":
      return <GuardrailsSection isEn={isEn} orgId={orgId} />;
    case "boundaries":
      return <BoundariesSection isEn={isEn} orgId={orgId} />;
    case "privacy":
      return <PrivacySection isEn={isEn} orgId={orgId} />;
    case "advanced":
      return <AdvancedSection isEn={isEn} orgId={orgId} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewSection({ isEn, orgId }: { isEn: boolean; orgId: string }) {
  return (
    <div className="space-y-5">
      <SectionHeader
        descriptionEn="A snapshot of your AI's operating status and key metrics."
        descriptionEs="Un resumen del estado operativo de tu IA y métricas clave."
        isEn={isEn}
        titleEn="Overview"
        titleEs="Resumen"
      />
      <StatusDashboard isEn={isEn} orgId={orgId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function AgentsSection({
  isEn,
  locale,
  orgId,
}: {
  isEn: boolean;
  locale: Locale;
  orgId: string;
}) {
  return (
    <div className="space-y-5">
      <SectionHeader
        descriptionEn="Manage per-agent runtime overrides, activation status, and escalation thresholds."
        descriptionEs="Administra overrides de ejecución por agente, estado de activación y umbrales de escalamiento."
        isEn={isEn}
        titleEn="Agent Config"
        titleEs="Config. de Agentes"
      />
      <AgentConfigManager locale={locale} orgId={orgId} />
      <EscalationThresholds locale={locale} orgId={orgId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approvals (with search, bulk, filters)
// ---------------------------------------------------------------------------

function ApprovalsSection({
  isEn,
  locale,
  orgId,
}: {
  isEn: boolean;
  locale: Locale;
  orgId: string;
}) {
  return (
    <div className="space-y-5">
      <SectionHeader
        descriptionEn="Control what the AI can do and review pending actions."
        descriptionEs="Controla lo que la IA puede hacer y revisa acciones pendientes."
        isEn={isEn}
        titleEn="Task Approvals"
        titleEs="Aprobaciones"
      />
      <PermissionsTab isEn={isEn} orgId={orgId} />

      <div className="pt-2">
        <h3 className="mb-3 font-semibold text-foreground/80 text-sm">
          {isEn ? "Pending Approval Queue" : "Cola de aprobaciones pendientes"}
        </h3>
        <ApprovalQueue locale={locale} orgId={orgId} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guardrails & Memory
// ---------------------------------------------------------------------------

function GuardrailsSection({ isEn, orgId }: { isEn: boolean; orgId: string }) {
  return (
    <div className="space-y-5">
      <SectionHeader
        descriptionEn="Manage what the AI knows and its guardrail configuration."
        descriptionEs="Gestiona lo que la IA sabe y su configuración de barreras."
        isEn={isEn}
        titleEn="Guardrails & Memory"
        titleEs="Barreras y memoria"
      />
      <MemoryGovernance isEn={isEn} orgId={orgId} />
      <GuardrailConfig isEn={isEn} orgId={orgId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fail-Safe Boundaries
// ---------------------------------------------------------------------------

function BoundariesSection({ isEn, orgId }: { isEn: boolean; orgId: string }) {
  return (
    <div className="space-y-5">
      <SectionHeader
        descriptionEn="Define topics the AI should decline and custom rejection responses."
        descriptionEs="Define temas que la IA debe declinar y respuestas de rechazo personalizadas."
        isEn={isEn}
        titleEn="Fail-Safe Boundaries"
        titleEs="Límites de seguridad"
      />
      <FailSafeBoundaries isEn={isEn} orgId={orgId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Privacy & Audits
// ---------------------------------------------------------------------------

function PrivacySection({ isEn, orgId }: { isEn: boolean; orgId: string }) {
  return (
    <div className="space-y-5">
      <SectionHeader
        descriptionEn="Track how the AI handles personal data and review security audits."
        descriptionEs="Rastrea cómo la IA maneja datos personales y revisa auditorías de seguridad."
        isEn={isEn}
        titleEn="Privacy & Audits"
        titleEs="Privacidad y auditorías"
      />
      <PiiAuditLog isEn={isEn} orgId={orgId} />
      <SecurityAudit isEn={isEn} orgId={orgId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

function AdvancedSection({ isEn, orgId }: { isEn: boolean; orgId: string }) {
  return (
    <div className="space-y-5">
      <SectionHeader
        descriptionEn="Raw engineering controls for rate limits, approval policies, and guardrails."
        descriptionEs="Controles de ingeniería para límites de tasa, políticas de aprobación y barreras."
        isEn={isEn}
        titleEn="Advanced Configuration"
        titleEs="Configuración avanzada"
      />
      <RateLimitsSection isEn={isEn} orgId={orgId} />
      <ApprovalPolicies isEn={isEn} orgId={orgId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared section header
// ---------------------------------------------------------------------------

function SectionHeader({
  titleEn,
  titleEs,
  descriptionEn,
  descriptionEs,
  isEn,
}: {
  titleEn: string;
  titleEs: string;
  descriptionEn: string;
  descriptionEs: string;
  isEn: boolean;
}) {
  return (
    <header>
      <h1 className="font-semibold text-foreground/95 text-xl tracking-tight">
        {isEn ? titleEn : titleEs}
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground/70">
        {isEn ? descriptionEn : descriptionEs}
      </p>
    </header>
  );
}
