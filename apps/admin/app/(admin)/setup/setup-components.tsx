import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  LockKeyIcon,
  Rocket01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { UseOrgButton } from "@/components/shell/use-org-button";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types & helpers                                                    */
/* ------------------------------------------------------------------ */

export type Row = Record<string, unknown>;

export type OrganizationProfileType = "owner_operator" | "management_company";

export type RentalMode = "str" | "ltr" | "both";

export function isRentalMode(value: unknown): value is RentalMode {
  return value === "str" || value === "ltr" || value === "both";
}

export function rentalModeLabel(value: RentalMode, isEn: boolean): string {
  if (value === "str")
    return isEn ? "Short-term rentals" : "Alquileres temporarios";
  if (value === "ltr")
    return isEn ? "Long-term rentals" : "Alquileres a largo plazo";
  return isEn ? "Both" : "Ambos";
}

export type StepDef = {
  number: number;
  label: string;
  done: boolean;
  active: boolean;
};

export function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

export function isOrganizationProfileType(
  value: unknown
): value is OrganizationProfileType {
  return value === "owner_operator" || value === "management_company";
}

export function profileTypeLabel(
  value: OrganizationProfileType,
  isEn: boolean
): string {
  if (value === "owner_operator") {
    return isEn ? "Owner-operator" : "Propietario-operador";
  }
  return isEn ? "Management company" : "Empresa administradora";
}

/* ------------------------------------------------------------------ */
/*  Stepper                                                           */
/* ------------------------------------------------------------------ */

export function ProgressStepper({ steps }: { steps: StepDef[] }) {
  return (
    <div className="flex items-start justify-center gap-0">
      {steps.map((step, i) => (
        <div className="flex items-start" key={step.number}>
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full border-2 font-semibold text-sm transition-colors",
                step.done
                  ? "border-primary bg-primary text-primary-foreground"
                  : step.active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground"
              )}
            >
              {step.done ? <Icon icon={Tick01Icon} size={16} /> : step.number}
            </div>
            <span
              className={cn(
                "max-w-[5rem] text-center font-medium text-xs",
                step.done || step.active
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {step.label}
            </span>
          </div>
          {i < steps.length - 1 ? (
            <div
              className={cn(
                "mt-4 h-0.5 w-12 shrink-0 sm:w-16 md:w-20",
                steps[i + 1].done || steps[i + 1].active
                  ? "bg-primary/40"
                  : "bg-border"
              )}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Completed step summary row                                        */
/* ------------------------------------------------------------------ */

export function CompletedStepRow({
  stepNumber,
  title,
  summary,
}: {
  stepNumber: number;
  title: string;
  summary: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/40 px-4 py-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Icon icon={Tick01Icon} size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground text-sm">{title}</p>
        <p className="truncate text-muted-foreground text-xs">{summary}</p>
      </div>
      <Badge className="shrink-0 text-[10px]" variant="secondary">
        {stepNumber}/3
      </Badge>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Locked step row                                                   */
/* ------------------------------------------------------------------ */

export function LockedStepRow({
  stepNumber,
  title,
  description,
}: {
  stepNumber: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/40 bg-background px-4 py-3 opacity-50">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
        <Icon icon={LockKeyIcon} size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-muted-foreground text-sm">
          {title}
        </p>
        <p className="truncate text-muted-foreground/70 text-xs">
          {description}
        </p>
      </div>
      <Badge className="shrink-0 text-[10px]" variant="outline">
        {stepNumber}/3
      </Badge>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Active step card                                                  */
/* ------------------------------------------------------------------ */

export function ActiveStepCard({
  stepNumber,
  title,
  description,
  children,
}: {
  stepNumber: number;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border-2 border-primary/25 bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary/10 font-bold text-primary text-sm">
            {stepNumber}
          </div>
          <div>
            <p className="font-semibold text-foreground">{title}</p>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
        </div>
        <Badge className="shrink-0" variant="outline">
          {stepNumber}/3
        </Badge>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Optional step card (softer variant for non-blocking steps)         */
/* ------------------------------------------------------------------ */

export function OptionalStepCard({
  stepNumber,
  title,
  description,
  children,
  isEn,
}: {
  stepNumber: number;
  title: string;
  description: string;
  children: ReactNode;
  isEn: boolean;
}) {
  return (
    <div className="rounded-2xl border-2 border-border/40 border-dashed bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-border border-dashed bg-muted/30 font-bold text-muted-foreground text-sm">
            {stepNumber}
          </div>
          <div>
            <p className="font-semibold text-foreground">{title}</p>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
        </div>
        <Badge
          className="shrink-0 text-[10px] text-muted-foreground"
          variant="outline"
        >
          {isEn ? "Optional" : "Opcional"}
        </Badge>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Form sub-components                                               */
/* ------------------------------------------------------------------ */

export function OrganizationProfileInputs({
  defaultValue,
  isEn,
}: {
  defaultValue: OrganizationProfileType;
  isEn: boolean;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-medium text-muted-foreground text-xs">
        {isEn ? "Organization profile" : "Perfil de organización"}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label
          aria-label="Owner-operator"
          className="group relative flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background px-4 py-3 text-sm transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
          htmlFor="profile_type_owner_operator"
        >
          <input
            className="mt-0.5 accent-[var(--primary)]"
            defaultChecked={defaultValue === "owner_operator"}
            id="profile_type_owner_operator"
            name="profile_type"
            required
            type="radio"
            value="owner_operator"
          />
          <div>
            <span className="font-medium text-foreground">
              {isEn ? "Owner-operator" : "Propietario-operador"}
            </span>
            <span className="mt-0.5 block text-muted-foreground text-xs">
              {isEn
                ? "You own and manage your properties."
                : "Eres dueño y administras tus propiedades."}
            </span>
          </div>
        </label>
        <label
          aria-label="Management company"
          className="group relative flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background px-4 py-3 text-sm transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
          htmlFor="profile_type_management_company"
        >
          <input
            className="mt-0.5 accent-[var(--primary)]"
            defaultChecked={defaultValue === "management_company"}
            id="profile_type_management_company"
            name="profile_type"
            required
            type="radio"
            value="management_company"
          />
          <div>
            <span className="font-medium text-foreground">
              {isEn ? "Management company" : "Empresa administradora"}
            </span>
            <span className="mt-0.5 block text-muted-foreground text-xs">
              {isEn
                ? "You manage properties on behalf of owners."
                : "Administras propiedades en nombre de propietarios."}
            </span>
          </div>
        </label>
      </div>
    </fieldset>
  );
}

export function RentalModeInputs({
  defaultValue,
  isEn,
}: {
  defaultValue: RentalMode;
  isEn: boolean;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-medium text-muted-foreground text-xs">
        {isEn ? "What do you manage?" : "¿Qué administras?"}
      </legend>
      <div className="grid gap-2 sm:grid-cols-3">
        <label
          aria-label="Short-term rentals"
          className="group relative flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background px-4 py-3 text-sm transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
          htmlFor="rental_mode_str"
        >
          <input
            className="mt-0.5 accent-[var(--primary)]"
            defaultChecked={defaultValue === "str"}
            id="rental_mode_str"
            name="rental_mode"
            required
            type="radio"
            value="str"
          />
          <div>
            <span className="font-medium text-foreground">
              {isEn ? "Short-term rentals" : "Alquileres temporarios"}
            </span>
            <span className="mt-0.5 block text-muted-foreground text-xs">
              {isEn
                ? "Airbnb, Booking.com, VRBO."
                : "Airbnb, Booking.com, VRBO."}
            </span>
          </div>
        </label>
        <label
          aria-label="Long-term rentals"
          className="group relative flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background px-4 py-3 text-sm transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
          htmlFor="rental_mode_ltr"
        >
          <input
            className="mt-0.5 accent-[var(--primary)]"
            defaultChecked={defaultValue === "ltr"}
            id="rental_mode_ltr"
            name="rental_mode"
            required
            type="radio"
            value="ltr"
          />
          <div>
            <span className="font-medium text-foreground">
              {isEn ? "Long-term rentals" : "Alquileres a largo plazo"}
            </span>
            <span className="mt-0.5 block text-muted-foreground text-xs">
              {isEn
                ? "Leases, contracts, collections."
                : "Contratos, arriendos, cobranzas."}
            </span>
          </div>
        </label>
        <label
          aria-label="Both rental types"
          className="group relative flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background px-4 py-3 text-sm transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
          htmlFor="rental_mode_both"
        >
          <input
            className="mt-0.5 accent-[var(--primary)]"
            defaultChecked={defaultValue === "both"}
            id="rental_mode_both"
            name="rental_mode"
            required
            type="radio"
            value="both"
          />
          <div>
            <span className="font-medium text-foreground">
              {isEn ? "Both" : "Ambos"}
            </span>
            <span className="mt-0.5 block text-muted-foreground text-xs">
              {isEn
                ? "Short-term and long-term."
                : "Temporarios y largo plazo."}
            </span>
          </div>
        </label>
      </div>
    </fieldset>
  );
}

export function OrganizationCoreFields({
  isEn,
  defaults,
}: {
  isEn: boolean;
  defaults?: {
    name?: string;
    legalName?: string;
    ruc?: string;
    defaultCurrency?: string;
    timezone?: string;
  };
}) {
  return (
    <>
      <label className="grid gap-1" htmlFor="setup-org-name">
        <span className="font-medium text-muted-foreground text-xs">
          {isEn ? "Name" : "Nombre"}
        </span>
        <Input
          defaultValue={defaults?.name ?? ""}
          id="setup-org-name"
          name="name"
          placeholder={isEn ? "My Property Company" : "Mi Empresa Inmobiliaria"}
          required
        />
      </label>
      <label className="grid gap-1" htmlFor="setup-org-legal-name">
        <span className="font-medium text-muted-foreground text-xs">
          {isEn ? "Legal name" : "Razón social"}
        </span>
        <Input
          defaultValue={defaults?.legalName ?? ""}
          id="setup-org-legal-name"
          name="legal_name"
          placeholder={isEn ? "Company S.A." : "Empresa S.A."}
        />
      </label>
      <label className="grid gap-1" htmlFor="setup-org-ruc">
        <span className="font-medium text-muted-foreground text-xs">
          {isEn ? "Tax ID (RUC)" : "RUC"}
        </span>
        <Input
          defaultValue={defaults?.ruc ?? ""}
          id="setup-org-ruc"
          name="ruc"
          placeholder="80012345-6"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1" htmlFor="setup-org-currency">
          <span className="font-medium text-muted-foreground text-xs">
            {isEn ? "Default currency" : "Moneda predeterminada"}
          </span>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            defaultValue={defaults?.defaultCurrency ?? "PYG"}
            id="setup-org-currency"
            name="default_currency"
          >
            <option value="PYG">PYG — Guaraní</option>
            <option value="USD">USD — US Dollar</option>
          </select>
        </label>
        <label className="grid gap-1" htmlFor="setup-org-timezone">
          <span className="font-medium text-muted-foreground text-xs">
            {isEn ? "Timezone" : "Zona horaria"}
          </span>
          <Input
            defaultValue={defaults?.timezone ?? "America/Asuncion"}
            id="setup-org-timezone"
            name="timezone"
          />
        </label>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Demo seed callout (controlled — no form action)                    */
/* ------------------------------------------------------------------ */

export function DemoSeedCallout({
  isEn,
  submitting,
  onSeed,
}: {
  isEn: boolean;
  submitting: boolean;
  onSeed: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-primary/5 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon icon={Rocket01Icon} size={22} />
          </div>
          <div>
            <p className="font-semibold text-foreground">
              {isEn
                ? "Quick start with demo data"
                : "Inicio rápido con datos demo"}
            </p>
            <p className="mt-0.5 text-muted-foreground text-sm">
              {isEn
                ? "Seed properties, units, reservations, tasks, and an owner statement to explore all modules instantly."
                : "Carga propiedades, unidades, reservas, tareas y un estado de propietario para explorar todos los módulos."}
            </p>
          </div>
        </div>
        <Button
          className="shrink-0 sm:min-w-[8rem]"
          disabled={submitting}
          onClick={onSeed}
          size="sm"
          type="button"
        >
          {submitting ? (
            <>
              <Spinner className="text-primary-foreground" size="sm" />
              {isEn ? "Loading..." : "Cargando..."}
            </>
          ) : isEn ? (
            "Seed demo data"
          ) : (
            "Cargar demo"
          )}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Completion card                                                   */
/* ------------------------------------------------------------------ */

export function CompletionCard({
  isEn,
  nextActionLinks,
  rentalMode,
}: {
  isEn: boolean;
  nextActionLinks: Array<{ href: string; label: string }>;
  rentalMode?: RentalMode;
}) {
  const description = (() => {
    if (rentalMode === "str") {
      return isEn
        ? "Your organization is ready. Connect your OTA channels and create listings to start managing reservations."
        : "Tu organización está lista. Conecta tus canales OTA y crea anuncios para empezar a gestionar reservas.";
    }
    if (rentalMode === "ltr") {
      return isEn
        ? "Your organization is ready. Publish marketplace listings and set up pricing to start receiving applications."
        : "Tu organización está lista. Publica anuncios en el marketplace y configura precios para recibir aplicaciones.";
    }
    return isEn
      ? "Your organization is ready to operate. Continue setting up channels, listings, and marketplace presence."
      : "Tu organización está lista para operar. Continúa configurando canales, anuncios y presencia en el marketplace.";
  })();

  return (
    <div className="rounded-2xl border-2 border-primary/20 bg-primary/5 p-6 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Icon icon={CheckmarkCircle02Icon} size={28} />
      </div>
      <h3 className="font-semibold text-foreground text-lg">
        {isEn ? "Onboarding complete!" : "¡Onboarding completado!"}
      </h3>
      <p className="mx-auto mt-1 max-w-md text-muted-foreground text-sm">
        {description}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Link
          className={cn(buttonVariants({ size: "default" }), "gap-2")}
          href="/app?onboarding=completed"
        >
          {isEn ? "Go to dashboard" : "Ir al panel"}
          <Icon icon={ArrowRight01Icon} size={14} />
        </Link>
        {nextActionLinks.map((item) => (
          <Link
            className={cn(
              buttonVariants({ size: "default", variant: "outline" })
            )}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Technical details (collapsible)                                   */
/* ------------------------------------------------------------------ */

export function TechnicalDetails({
  isEn,
  apiBaseUrl,
  orgId,
  profileType,
}: {
  isEn: boolean;
  apiBaseUrl: string;
  orgId?: string | null;
  profileType?: OrganizationProfileType;
}) {
  return (
    <Collapsible>
      <div className="flex items-center gap-2">
        <CollapsibleTrigger className="font-medium text-muted-foreground text-xs transition-colors hover:text-foreground">
          {isEn ? "Technical details" : "Detalles técnicos"}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-2 grid gap-2 text-muted-foreground text-sm md:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <span className="block text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              {isEn ? "API base URL" : "URL base de la API"}
            </span>
            <span className="font-mono text-foreground text-xs">
              {apiBaseUrl}
            </span>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <span className="block text-[10px] text-muted-foreground/70 uppercase tracking-wider">
              {isEn ? "Organization" : "Organización"}
            </span>
            <span className="font-mono text-foreground text-xs">
              {orgId ?? (isEn ? "Not selected" : "No seleccionada")}
            </span>
            {profileType ? (
              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                {profileTypeLabel(profileType, isEn)}
              </span>
            ) : null}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ------------------------------------------------------------------ */
/*  Existing organizations list                                       */
/* ------------------------------------------------------------------ */

export function ExistingOrganizations({
  organizations,
  locale,
  isEn,
}: {
  organizations: Row[];
  locale: Locale;
  isEn: boolean;
}) {
  if (!organizations.length) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <p className="font-medium text-foreground text-sm">
        {isEn ? "Existing organizations" : "Organizaciones existentes"}
      </p>
      <p className="text-muted-foreground text-xs">
        {isEn
          ? "Switch to one to skip step 1."
          : "Cámbiate a una para saltar el paso 1."}
      </p>
      <div className="mt-3 space-y-2">
        {organizations.map((org) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
            key={String(org.id)}
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground text-sm">
                {String(org.name ?? (isEn ? "Organization" : "Organización"))}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {String(org.id)}
              </p>
            </div>
            <UseOrgButton locale={locale} orgId={String(org.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
