"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import Link from "next/link";

import { DataImportSheet } from "@/components/import/data-import-sheet";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  wizardCreateIntegration,
  wizardCreateLease,
  wizardCreateOrganization,
  wizardCreateProperty,
  wizardCreateUnit,
  wizardSeedDemoData,
} from "./actions";
import {
  ActiveStepCard,
  CompletedStepRow,
  CompletionCard,
  DemoSeedCallout,
  ExistingOrganizations,
  LockedStepRow,
  OptionalStepCard,
  OrganizationCoreFields,
  OrganizationProfileInputs,
  ProgressStepper,
  RentalModeInputs,
  TechnicalDetails,
  asString,
  isOrganizationProfileType,
  isRentalMode,
  profileTypeLabel,
  rentalModeLabel,
  type OrganizationProfileType,
  type RentalMode,
  type Row,
  type StepDef,
} from "./setup-components";
import { SetupManager } from "./setup-manager";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export type SetupWizardProps = {
  initialOrgId: string | null;
  initialOrganization: Row | null;
  initialOrganizations: Row[];
  initialProperties: Row[];
  initialUnits: Row[];
  integrations: Row[];
  locale: Locale;
  apiBaseUrl: string;
  initialTab?: string;
  initialPlanId?: string;
};

/* ------------------------------------------------------------------ */
/*  Helper: read FormData value as string                              */
/* ------------------------------------------------------------------ */

function fd(form: HTMLFormElement, name: string): string {
  const val = new FormData(form).get(name);
  return typeof val === "string" ? val.trim() : "";
}

function fdNum(form: HTMLFormElement, name: string, fallback: number): number {
  const raw = fd(form, name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SetupWizard({
  initialOrgId,
  initialOrganization,
  initialOrganizations,
  initialProperties,
  initialUnits,
  integrations,
  locale,
  apiBaseUrl,
  initialTab,
  initialPlanId,
}: SetupWizardProps) {
  const router = useRouter();
  const isEn = locale === "en-US";

  /* ---- State ---------------------------------------------------- */

  const [orgId, setOrgId] = useState(initialOrgId);
  const [orgName, setOrgName] = useState(
    asString(initialOrganization?.name) || null
  );
  const initProfileType: OrganizationProfileType = isOrganizationProfileType(
    initialOrganization?.profile_type
  )
    ? initialOrganization.profile_type
    : "management_company";
  const [profileType, setProfileType] =
    useState<OrganizationProfileType>(initProfileType);
  const initRentalMode: RentalMode = isRentalMode(
    initialOrganization?.rental_mode
  )
    ? initialOrganization.rental_mode
    : "both";
  const [rentalMode, setRentalMode] = useState<RentalMode>(initRentalMode);
  const [properties, setProperties] = useState<Row[]>(initialProperties);
  const [units, setUnits] = useState<Row[]>(initialUnits);
  const [submitting, setSubmitting] = useState<
    null | "org" | "property" | "unit" | "seed" | "integration" | "lease"
  >(null);
  const [leaseDone, setLeaseDone] = useState(false);
  const [importPropertyOpen, setImportPropertyOpen] = useState(false);
  const [importUnitOpen, setImportUnitOpen] = useState(false);
  const [importLeaseOpen, setImportLeaseOpen] = useState(false);
  const [step4Done, setStep4Done] = useState(false);
  const [step4Skipped, setStep4Skipped] = useState(false);

  /* ---- Derived -------------------------------------------------- */

  const orgDone = Boolean(orgId);
  const propertyDone = properties.length > 0;
  const unitDone = units.length > 0;
  const onboardingDone = orgDone && propertyDone && unitDone;
  const activeStep = !orgDone ? 1 : !propertyDone ? 2 : !unitDone ? 3 : 0;

  const propertyOptions = properties
    .map((row) => ({
      id: asString(row.id),
      label: asString(row.name || row.code || row.id),
    }))
    .filter((item) => item.id);

  const unitOptions = units
    .map((row) => ({
      id: asString(row.id),
      label: asString(row.name || row.code || row.id),
    }))
    .filter((item) => item.id);

  const step4Complete = step4Skipped || step4Done || leaseDone;

  const showDemoSeed =
    orgDone &&
    properties.length === 0 &&
    units.length === 0 &&
    integrations.length === 0;

  const strLinks = [
    {
      href: "/module/integrations",
      label: isEn ? "Connect an integration" : "Conectar una integración",
    },
    {
      href: "/module/reservations",
      label: isEn ? "Start reservations" : "Iniciar reservas",
    },
  ];

  const ltrLinks = [
    {
      href: "/module/leases",
      label: isEn ? "Manage leases" : "Gestionar contratos",
    },
    {
      href: "/module/collections",
      label: isEn ? "View collections" : "Ver cobros",
    },
    {
      href: "/module/listings",
      label: isEn ? "Publish listing" : "Publicar anuncio",
    },
  ];

  const nextActionLinks =
    rentalMode === "str"
      ? strLinks
      : rentalMode === "ltr"
        ? ltrLinks
        : [...strLinks, ...ltrLinks];

  const steps: StepDef[] = [
    {
      number: 1,
      label: isEn ? "Organization" : "Organización",
      done: orgDone,
      active: activeStep === 1,
    },
    {
      number: 2,
      label: isEn ? "Property" : "Propiedad",
      done: propertyDone,
      active: activeStep === 2,
    },
    {
      number: 3,
      label: isEn ? "Unit" : "Unidad",
      done: unitDone,
      active: activeStep === 3,
    },
    ...(onboardingDone
      ? [
          {
            number: 4,
            label:
              rentalMode === "ltr"
                ? isEn
                  ? "Lease"
                  : "Contrato"
                : isEn
                  ? "Connect"
                  : "Conectar",
            done: step4Complete,
            active: !step4Complete,
          },
        ]
      : []),
  ];

  const openAdvancedByDefault = Boolean(initialTab);

  /* ---- Handlers ------------------------------------------------- */

  const handleCreateOrg = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting("org");

    const form = e.currentTarget;
    const result = await wizardCreateOrganization({
      name: fd(form, "name"),
      legal_name: fd(form, "legal_name") || undefined,
      ruc: fd(form, "ruc") || undefined,
      profile_type: fd(form, "profile_type") || "management_company",
      default_currency: fd(form, "default_currency") || "PYG",
      timezone: fd(form, "timezone") || "America/Asuncion",
      rental_mode: fd(form, "rental_mode") || "both",
    });

    if (!result.ok) {
      toast.error(
        isEn
          ? "Could not create organization"
          : "No se pudo crear la organización",
        { description: result.error }
      );
      setSubmitting(null);
      return;
    }

    // Set cookie client-side (belt-and-suspenders with server-side set in action)
    try {
      await fetch("/api/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: result.data.id }),
      });
    } catch {
      // Cookie was already set server-side in the action
    }

    setOrgId(result.data.id);
    setOrgName(result.data.name);
    const pt = fd(form, "profile_type");
    if (isOrganizationProfileType(pt)) setProfileType(pt);
    const rm = fd(form, "rental_mode");
    if (isRentalMode(rm)) setRentalMode(rm);

    toast.success(
      isEn ? "Organization created" : "Organización creada",
      { description: result.data.name }
    );

    // Auto-subscribe to plan if planId is provided (from pricing page)
    if (initialPlanId && result.data.id) {
      try {
        await fetch(`${apiBaseUrl}/billing/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organization_id: result.data.id,
            plan_id: initialPlanId,
          }),
        });
        toast.success(
          isEn ? "Plan activated" : "Plan activado",
          {
            description: isEn
              ? "Your trial period has started."
              : "Tu período de prueba ha comenzado.",
          }
        );
      } catch {
        // Subscription failed silently — user can set up later from billing
      }
    }

    setSubmitting(null);
  };

  const handleCreateProperty = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || !orgId) return;
    setSubmitting("property");

    const form = e.currentTarget;
    const result = await wizardCreateProperty({
      organization_id: orgId,
      name: fd(form, "name"),
      code: fd(form, "code") || undefined,
      address_line1: fd(form, "address_line1") || undefined,
      city: fd(form, "city") || undefined,
    });

    if (!result.ok) {
      toast.error(
        isEn
          ? "Could not create property"
          : "No se pudo crear la propiedad",
        { description: result.error }
      );
      setSubmitting(null);
      return;
    }

    setProperties((prev) => [
      ...prev,
      { id: result.data.id, name: result.data.name },
    ]);
    toast.success(
      isEn ? "Property created" : "Propiedad creada",
      { description: result.data.name }
    );
    setSubmitting(null);
  };

  const handleCreateUnit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || !orgId) return;
    setSubmitting("unit");

    const form = e.currentTarget;
    const result = await wizardCreateUnit({
      organization_id: orgId,
      property_id: fd(form, "property_id"),
      code: fd(form, "code"),
      name: fd(form, "name"),
      max_guests: fdNum(form, "max_guests", 2),
      bedrooms: fdNum(form, "bedrooms", 1),
      bathrooms: fdNum(form, "bathrooms", 1),
    });

    if (!result.ok) {
      toast.error(
        isEn ? "Could not create unit" : "No se pudo crear la unidad",
        { description: result.error }
      );
      setSubmitting(null);
      return;
    }

    setUnits((prev) => [
      ...prev,
      { id: result.data.id, name: fd(form, "name"), code: fd(form, "code") },
    ]);
    toast.success(isEn ? "Unit created" : "Unidad creada");
    setSubmitting(null);
  };

  const handleCreateIntegrationStep4 = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || !orgId) return;
    setSubmitting("integration");

    const form = e.currentTarget;
    const result = await wizardCreateIntegration({
      organization_id: orgId,
      unit_id: fd(form, "unit_id"),
      kind: fd(form, "kind"),
      channel_name: fd(form, "channel_name"),
      public_name: fd(form, "public_name"),
      ical_import_url: fd(form, "ical_import_url") || undefined,
    });

    if (!result.ok) {
      toast.error(
        isEn ? "Could not create integration" : "No se pudo crear la integración",
        { description: result.error }
      );
      setSubmitting(null);
      return;
    }

    setStep4Done(true);
    toast.success(isEn ? "Integration created" : "Integración creada", {
      description: result.data.name,
    });
    setSubmitting(null);
  };

  const handleCreateLeaseStep4 = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting || !orgId) return;
    setSubmitting("lease");

    const form = e.currentTarget;
    const result = await wizardCreateLease({
      organization_id: orgId,
      unit_id: fd(form, "unit_id"),
      tenant_full_name: fd(form, "tenant_full_name"),
      tenant_email: fd(form, "tenant_email") || undefined,
      tenant_phone_e164: fd(form, "tenant_phone_e164") || undefined,
      lease_status: "active",
      starts_on: fd(form, "starts_on"),
      ends_on: fd(form, "ends_on") || undefined,
      currency: fd(form, "currency") || "PYG",
      monthly_rent: fdNum(form, "monthly_rent", 0),
      generate_first_collection: true,
    });

    if (!result.ok) {
      toast.error(
        isEn ? "Could not create lease" : "No se pudo crear el contrato",
        { description: result.error }
      );
      setSubmitting(null);
      return;
    }

    setLeaseDone(true);
    setStep4Done(true);
    toast.success(isEn ? "Lease created" : "Contrato creado", {
      description: isEn
        ? "Collection schedule generated automatically."
        : "Calendario de cobro generado automáticamente.",
    });
    setSubmitting(null);
  };

  const handleSeedDemo = async () => {
    if (submitting || !orgId) return;
    setSubmitting("seed");

    const result = await wizardSeedDemoData({ organization_id: orgId });
    if (!result.ok) {
      toast.error(
        isEn
          ? "Could not load demo data"
          : "No se pudieron cargar datos demo",
        { description: result.error }
      );
      setSubmitting(null);
      return;
    }

    toast.success(
      isEn ? "Demo data loaded" : "Datos demo cargados",
      {
        description: isEn
          ? "Refreshing page..."
          : "Actualizando página...",
      }
    );
    setSubmitting(null);
    router.refresh();
  };

  /* ---- Render --------------------------------------------------- */

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2">
      {/* Header */}
      <div className="text-center">
        <Badge className="mb-3" variant="outline">
          {isEn ? "Setup" : "Configuración"}
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {onboardingDone
            ? isEn
              ? "You're all set"
              : "Todo listo"
            : orgDone
              ? isEn
                ? "Complete your setup"
                : "Completa tu configuración"
              : isEn
                ? "Set up your workspace"
                : "Configura tu espacio de trabajo"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {onboardingDone
            ? isEn
              ? "Your workspace is fully configured and ready to use."
              : "Tu espacio está completamente configurado y listo para usar."
            : isEn
              ? "Complete 3 steps to start managing your properties."
              : "Completa 3 pasos para comenzar a administrar tus propiedades."}
        </p>
      </div>

      {/* Stepper */}
      <ProgressStepper steps={steps} />

      {/* Demo seed (prominent when org has no data) */}
      {showDemoSeed ? (
        <DemoSeedCallout
          isEn={isEn}
          submitting={submitting === "seed"}
          onSeed={handleSeedDemo}
        />
      ) : null}

      {/* Completion card */}
      {onboardingDone ? (
        <CompletionCard isEn={isEn} nextActionLinks={nextActionLinks} rentalMode={rentalMode} />
      ) : null}

      {/* Step 1: Organization */}
      {orgDone ? (
        <CompletedStepRow
          stepNumber={1}
          title={isEn ? "Organization" : "Organización"}
          summary={`${orgName || (isEn ? "Organization" : "Organización")} · ${profileTypeLabel(profileType, isEn)} · ${rentalModeLabel(rentalMode, isEn)}`}
        />
      ) : (
        <ActiveStepCard
          stepNumber={1}
          title={
            isEn ? "Create your organization" : "Crea tu organización"
          }
          description={
            isEn
              ? "Set up your workspace and choose your operating profile."
              : "Configura tu espacio y elige tu perfil operativo."
          }
        >
          <form onSubmit={handleCreateOrg} className="grid gap-3">
            <OrganizationProfileInputs
              defaultValue="management_company"
              isEn={isEn}
            />
            <RentalModeInputs defaultValue="both" isEn={isEn} />
            <OrganizationCoreFields isEn={isEn} />
            <Button
              className="mt-1 w-full"
              type="submit"
              disabled={submitting !== null}
            >
              {submitting === "org" ? (
                <>
                  <Spinner size="sm" className="text-primary-foreground" />
                  {isEn ? "Creating..." : "Creando..."}
                </>
              ) : isEn ? (
                "Create organization"
              ) : (
                "Crear organización"
              )}
            </Button>
          </form>
        </ActiveStepCard>
      )}

      {/* Step 2: Property */}
      {propertyDone ? (
        <CompletedStepRow
          stepNumber={2}
          title={isEn ? "Property" : "Propiedad"}
          summary={`${properties.length} ${isEn ? (properties.length === 1 ? "property" : "properties") : (properties.length === 1 ? "propiedad" : "propiedades")}`}
        />
      ) : activeStep === 2 ? (
        <ActiveStepCard
          stepNumber={2}
          title={
            isEn
              ? "Add your first property"
              : "Agrega tu primera propiedad"
          }
          description={
            isEn
              ? "Register your first asset in your portfolio."
              : "Registra tu primer activo del portafolio."
          }
        >
          <form onSubmit={handleCreateProperty} className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {isEn ? "Property name" : "Nombre de propiedad"}
              </span>
              <Input name="name" placeholder="Villa Morra HQ" required />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {isEn ? "Code" : "Código"}
              </span>
              <Input name="code" placeholder="VM-HQ" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {isEn ? "Address" : "Dirección"}
              </span>
              <Input name="address_line1" placeholder="Av. España 1234" />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {isEn ? "City" : "Ciudad"}
              </span>
              <Input name="city" placeholder="Asunción" />
            </label>
            <Button
              className="mt-1 w-full"
              type="submit"
              disabled={submitting !== null}
            >
              {submitting === "property" ? (
                <>
                  <Spinner size="sm" className="text-primary-foreground" />
                  {isEn ? "Creating..." : "Creando..."}
                </>
              ) : isEn ? (
                "Create property"
              ) : (
                "Crear propiedad"
              )}
            </Button>
          </form>
          <div className="mt-3 text-center">
            <button
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setImportPropertyOpen(true)}
              type="button"
            >
              {isEn ? "Import from Excel/CSV" : "Importar desde Excel/CSV"}
            </button>
          </div>
        </ActiveStepCard>
      ) : (
        <LockedStepRow
          stepNumber={2}
          title={
            isEn
              ? "Add your first property"
              : "Agrega tu primera propiedad"
          }
          description={
            isEn
              ? "Unlocked after creating an organization."
              : "Se habilita al crear una organización."
          }
        />
      )}

      {/* Step 3: Unit */}
      {unitDone ? (
        <CompletedStepRow
          stepNumber={3}
          title={isEn ? "Unit" : "Unidad"}
          summary={`${units.length} ${isEn ? (units.length === 1 ? "unit" : "units") : (units.length === 1 ? "unidad" : "unidades")}`}
        />
      ) : activeStep === 3 ? (
        <ActiveStepCard
          stepNumber={3}
          title={
            isEn ? "Create your first unit" : "Crea tu primera unidad"
          }
          description={
            isEn
              ? "Add your first rentable unit to finish onboarding."
              : "Agrega tu primera unidad alquilable para finalizar el onboarding."
          }
        >
          <form onSubmit={handleCreateUnit} className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {isEn ? "Property" : "Propiedad"}
              </span>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue={propertyOptions[0]?.id ?? ""}
                name="property_id"
                required
              >
                {propertyOptions.length === 0 ? (
                  <option value="">
                    {isEn
                      ? "Create a property first"
                      : "Crea una propiedad primero"}
                  </option>
                ) : null}
                {propertyOptions.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {isEn ? "Unit code" : "Código de unidad"}
                </span>
                <Input name="code" placeholder="A1" required />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {isEn ? "Unit name" : "Nombre de unidad"}
                </span>
                <Input
                  name="name"
                  placeholder="Departamento A1"
                  required
                />
              </label>
            </div>
            <div className="grid gap-3 grid-cols-3">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {isEn ? "Max guests" : "Máx. huéspedes"}
                </span>
                <Input
                  defaultValue={2}
                  min={1}
                  name="max_guests"
                  type="number"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {isEn ? "Bedrooms" : "Dormitorios"}
                </span>
                <Input
                  defaultValue={1}
                  min={0}
                  name="bedrooms"
                  type="number"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {isEn ? "Bathrooms" : "Baños"}
                </span>
                <Input
                  defaultValue={1}
                  min={0}
                  name="bathrooms"
                  step="0.5"
                  type="number"
                />
              </label>
            </div>
            <Button
              className="mt-1 w-full"
              type="submit"
              disabled={submitting !== null}
            >
              {submitting === "unit" ? (
                <>
                  <Spinner size="sm" className="text-primary-foreground" />
                  {isEn ? "Creating..." : "Creando..."}
                </>
              ) : isEn ? (
                "Create unit"
              ) : (
                "Crear unidad"
              )}
            </Button>
          </form>
          <div className="mt-3 text-center">
            <button
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setImportUnitOpen(true)}
              type="button"
            >
              {isEn ? "Import from Excel/CSV" : "Importar desde Excel/CSV"}
            </button>
          </div>
        </ActiveStepCard>
      ) : (
        <LockedStepRow
          stepNumber={3}
          title={
            isEn ? "Create your first unit" : "Crea tu primera unidad"
          }
          description={
            isEn
              ? "Complete step 2 first."
              : "Completa el paso 2 primero."
          }
        />
      )}

      {/* Step 4: Optional — Connect an integration or publish listing */}
      {onboardingDone && !step4Complete ? (
        <OptionalStepCard
          stepNumber={4}
          title={
            rentalMode === "ltr"
              ? isEn
                ? "Create your first lease"
                : "Crea tu primer contrato"
              : isEn
                ? "Connect an integration"
                : "Conecta una integración"
          }
          description={
            rentalMode === "ltr"
              ? isEn
                ? "Set up a tenant contract and auto-generate the collection schedule."
                : "Configura un contrato de inquilino y genera el calendario de cobro automáticamente."
              : isEn
                ? "Link your OTA channels to start receiving reservations."
                : "Conecta tus canales OTA para empezar a recibir reservas."
          }
          isEn={isEn}
        >
          {rentalMode !== "ltr" ? (
            <div className="space-y-4">
              <form
                onSubmit={handleCreateIntegrationStep4}
                className="grid gap-3"
              >
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {isEn ? "Channel type" : "Tipo de canal"}
                  </span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    defaultValue="airbnb"
                    name="kind"
                    required
                  >
                    <option value="airbnb">Airbnb</option>
                    <option value="bookingcom">Booking.com</option>
                    <option value="direct">
                      {isEn ? "Direct" : "Directo"}
                    </option>
                    <option value="vrbo">Vrbo</option>
                    <option value="other">
                      {isEn ? "Other" : "Otro"}
                    </option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {isEn ? "Channel name" : "Nombre del canal"}
                  </span>
                  <Input name="channel_name" placeholder="Airbnb" required />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {isEn ? "Unit" : "Unidad"}
                  </span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    defaultValue={unitOptions[0]?.id ?? ""}
                    name="unit_id"
                    required
                  >
                    {unitOptions.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {isEn ? "Public name" : "Nombre público"}
                  </span>
                  <Input
                    name="public_name"
                    placeholder={
                      isEn
                        ? "Airbnb - Apartment A1"
                        : "Airbnb - Departamento A1"
                    }
                    required
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {isEn
                      ? "iCal import URL (optional)"
                      : "URL de importación iCal (opcional)"}
                  </span>
                  <Input
                    name="ical_import_url"
                    placeholder="https://calendar.google.com/calendar/ical/..."
                  />
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    className="flex-1"
                    type="submit"
                    disabled={submitting !== null}
                  >
                    {submitting === "integration" ? (
                      <>
                        <Spinner
                          size="sm"
                          className="text-primary-foreground"
                        />
                        {isEn ? "Creating..." : "Creando..."}
                      </>
                    ) : isEn ? (
                      "Create integration"
                    ) : (
                      "Crear integración"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep4Skipped(true)}
                  >
                    {isEn ? "Skip" : "Omitir"}
                  </Button>
                </div>
              </form>

              {rentalMode === "both" ? (
                <div className="mt-1 space-y-2 border-t border-border/40 pt-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    {isEn
                      ? "Long-term rental setup"
                      : "Configuración de alquiler a largo plazo"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" })
                      )}
                      href="/module/listings"
                    >
                      {isEn
                        ? "Create marketplace listing"
                        : "Crear anuncio en marketplace"}
                    </Link>
                    <Link
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" })
                      )}
                      href="/module/pricing"
                    >
                      {isEn ? "Set up pricing" : "Configurar precios"}
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <form onSubmit={handleCreateLeaseStep4} className="grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {isEn ? "Unit" : "Unidad"}
                  </span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    defaultValue={unitOptions[0]?.id ?? ""}
                    name="unit_id"
                    required
                  >
                    {unitOptions.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {isEn ? "Tenant full name" : "Nombre completo del inquilino"}
                  </span>
                  <Input name="tenant_full_name" placeholder="Juan Pérez" required />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {isEn ? "Email (optional)" : "Email (opcional)"}
                    </span>
                    <Input name="tenant_email" type="email" placeholder="juan@email.com" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {isEn ? "Phone (optional)" : "Teléfono (opcional)"}
                    </span>
                    <Input name="tenant_phone_e164" placeholder="+595 981 123456" />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {isEn ? "Monthly rent" : "Renta mensual"}
                    </span>
                    <Input name="monthly_rent" type="number" min={0} step="any" placeholder="2500000" required />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {isEn ? "Currency" : "Moneda"}
                    </span>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      defaultValue="PYG"
                      name="currency"
                    >
                      <option value="PYG">PYG (₲)</option>
                      <option value="USD">USD ($)</option>
                    </select>
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {isEn ? "Start date" : "Fecha de inicio"}
                    </span>
                    <Input name="starts_on" type="date" required />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {isEn ? "End date (optional)" : "Fecha de fin (opcional)"}
                    </span>
                    <Input name="ends_on" type="date" />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isEn
                    ? "A monthly collection schedule will be generated automatically."
                    : "Se generará un calendario de cobro mensual automáticamente."}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    className="flex-1"
                    type="submit"
                    disabled={submitting !== null}
                  >
                    {submitting === "lease" ? (
                      <>
                        <Spinner size="sm" className="text-primary-foreground" />
                        {isEn ? "Creating..." : "Creando..."}
                      </>
                    ) : isEn ? (
                      "Create lease"
                    ) : (
                      "Crear contrato"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep4Skipped(true)}
                  >
                    {isEn ? "Skip" : "Omitir"}
                  </Button>
                </div>
              </form>
              <div className="border-t border-border/40 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {isEn ? "Or continue with:" : "O continúa con:"}
                  </p>
                  <button
                    className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setImportLeaseOpen(true)}
                    type="button"
                  >
                    {isEn ? "Import leases from CSV" : "Importar contratos desde CSV"}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    href="/module/listings"
                  >
                    {isEn ? "Publish listing" : "Publicar anuncio"}
                  </Link>
                  <Link
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    href="/module/pricing"
                  >
                    {isEn ? "Set up pricing" : "Configurar precios"}
                  </Link>
                </div>
              </div>
            </div>
          )}
        </OptionalStepCard>
      ) : null}

      {/* Technical details */}
      <TechnicalDetails
        isEn={isEn}
        apiBaseUrl={apiBaseUrl}
        orgId={orgId}
        profileType={profileType}
      />

      {/* Existing organizations (for step 1) */}
      {!orgDone ? (
        <ExistingOrganizations
          organizations={initialOrganizations}
          locale={locale}
          isEn={isEn}
        />
      ) : null}

      {/* Separator + Advanced */}
      {orgDone ? (
        <>
          <Separator />
          <Collapsible defaultOpen={openAdvancedByDefault}>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-xl">
                      {isEn
                        ? "Advanced onboarding"
                        : "Onboarding avanzado"}
                    </CardTitle>
                    <CardDescription>
                      {isEn
                        ? "Full CRUD manager for organizations, properties, units, and integrations."
                        : "Administrador CRUD completo para organizaciones, propiedades, unidades e integraciones."}
                    </CardDescription>
                  </div>
                  <CollapsibleTrigger
                    className={cn(
                      buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })
                    )}
                  >
                    {isEn ? "Toggle advanced" : "Alternar avanzado"}
                  </CollapsibleTrigger>
                </div>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  <SetupManager
                    integrations={integrations}
                    initialTab={initialTab}
                    organizations={initialOrganizations}
                    orgId={orgId!}
                    properties={properties}
                    units={units}
                  />
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </>
      ) : null}

      {/* Back link */}
      {!orgDone ? (
        <div className="flex justify-center">
          <a
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "text-muted-foreground"
            )}
            href="/app"
          >
            {isEn ? "Back to dashboard" : "Volver al panel"}
          </a>
        </div>
      ) : null}

      {/* CSV Import sheets */}
      {orgId ? (
        <>
          <DataImportSheet
            isEn={isEn}
            mode="properties"
            onImportComplete={() => router.refresh()}
            onOpenChange={setImportPropertyOpen}
            open={importPropertyOpen}
            orgId={orgId}
          />
          <DataImportSheet
            isEn={isEn}
            mode="units"
            onImportComplete={() => router.refresh()}
            onOpenChange={setImportUnitOpen}
            open={importUnitOpen}
            orgId={orgId}
            properties={propertyOptions.map((p) => ({ id: p.id, name: p.label }))}
          />
          <DataImportSheet
            isEn={isEn}
            mode="leases"
            onImportComplete={() => router.refresh()}
            onOpenChange={setImportLeaseOpen}
            open={importLeaseOpen}
            orgId={orgId}
            units={unitOptions.map((u) => ({ id: u.id, name: u.label }))}
          />
        </>
      ) : null}
    </div>
  );
}
