"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SetupAdvancedSection } from "./setup-advanced-section";
import {
  wizardCreateIntegration,
  wizardCreateLease,
  wizardCreateOrganization,
  wizardCreateProperty,
  wizardCreateUnit,
  wizardSeedDemoData,
} from "./setup-api-client";
import {
  asString,
  CompletionCard,
  DemoSeedCallout,
  ExistingOrganizations,
  isOrganizationProfileType,
  isRentalMode,
  type OrganizationProfileType,
  ProgressStepper,
  type RentalMode,
  type Row,
  type StepDef,
  TechnicalDetails,
} from "./setup-components";
import { SetupImportSheets } from "./setup-import-sheets";
import { SetupStepConnect } from "./setup-step-connect";
import { SetupStepOrganization } from "./setup-step-organization";
import { SetupStepProperty } from "./setup-step-property";
import { SetupStepUnit } from "./setup-step-unit";
import { fd, fdNum, type Step4View, type SubmittingState } from "./setup-types";

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
  const [submitting, setSubmitting] = useState<SubmittingState>(null);
  const [leaseDone, setLeaseDone] = useState(false);
  const [importPropertyOpen, setImportPropertyOpen] = useState(false);
  const [importUnitOpen, setImportUnitOpen] = useState(false);
  const [importLeaseOpen, setImportLeaseOpen] = useState(false);
  const [step4Done, setStep4Done] = useState(false);
  const [step4Skipped, setStep4Skipped] = useState(false);
  const [step4View, setStep4View] = useState<Step4View>(
    rentalMode === "ltr" ? "ltr" : "str"
  );

  const effectiveImportPropertyOpen = orgId ? importPropertyOpen : false;
  const effectiveImportUnitOpen = orgId ? importUnitOpen : false;
  const effectiveImportLeaseOpen = orgId ? importLeaseOpen : false;

  const orgDone = Boolean(orgId);
  const propertyDone = properties.length > 0;
  const unitDone = units.length > 0;
  const onboardingDone = orgDone && propertyDone && unitDone;
  const activeStep = orgDone ? (propertyDone ? (unitDone ? 0 : 3) : 2) : 1;

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
      href: "/module/channels",
      label: isEn ? "Connect a channel" : "Conectar un canal",
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

    try {
      await fetch("/api/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: result.data.id }),
      });
    } catch {
      /* Best effort: local org cookie sync route failed */
    }

    setOrgId(result.data.id);
    setOrgName(result.data.name);
    const pt = fd(form, "profile_type");
    if (isOrganizationProfileType(pt)) setProfileType(pt);
    const rm = fd(form, "rental_mode");
    if (isRentalMode(rm)) setRentalMode(rm);

    toast.success(isEn ? "Organization created" : "Organización creada", {
      description: result.data.name,
    });

    if (initialPlanId && result.data.id) {
      const planSuccessTitle = isEn ? "Plan activated" : "Plan activado";
      const planSuccessDesc = isEn
        ? "Your trial period has started."
        : "Tu período de prueba ha comenzado.";
      const planErrorTitle = isEn
        ? "Could not activate plan"
        : "No se pudo activar el plan";
      const planErrorDesc = isEn
        ? "You can activate it later from Settings → Billing."
        : "Puedes activarlo después desde Ajustes → Facturación.";

      try {
        const subscribeRes = await fetch(`${apiBaseUrl}/billing/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organization_id: result.data.id,
            plan_id: initialPlanId,
          }),
        });
        if (subscribeRes.ok) {
          toast.success(planSuccessTitle, { description: planSuccessDesc });
        } else {
          toast.error(planErrorTitle, { description: planErrorDesc });
        }
      } catch {
        toast.error(planErrorTitle, { description: planErrorDesc });
      }
    }

    router.refresh();
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
        isEn ? "Could not create property" : "No se pudo crear la propiedad",
        { description: result.error }
      );
      setSubmitting(null);
      return;
    }

    setProperties((prev) => [
      ...prev,
      { id: result.data.id, name: result.data.name },
    ]);
    toast.success(isEn ? "Property created" : "Propiedad creada", {
      description: result.data.name,
    });
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

  const handleCreateIntegrationStep4 = async (
    e: FormEvent<HTMLFormElement>
  ) => {
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
        isEn ? "Could not create channel" : "No se pudo crear el canal",
        { description: result.error }
      );
      setSubmitting(null);
      return;
    }

    setStep4Done(true);
    toast.success(isEn ? "Channel created" : "Canal creado", {
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
        isEn ? "Could not load demo data" : "No se pudieron cargar datos demo",
        { description: result.error }
      );
      setSubmitting(null);
      return;
    }

    toast.success(isEn ? "Demo data loaded" : "Datos demo cargados", {
      description: isEn ? "Refreshing page..." : "Actualizando página...",
    });
    setSubmitting(null);
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2">
      <div className="text-center">
        <Badge className="mb-3" variant="outline">
          {isEn ? "Setup" : "Configuración"}
        </Badge>
        <h1 className="font-semibold text-2xl text-foreground tracking-tight">
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
        <p className="mt-1 text-muted-foreground text-sm">
          {onboardingDone
            ? isEn
              ? "Your workspace is fully configured and ready to use."
              : "Tu espacio está completamente configurado y listo para usar."
            : isEn
              ? "Complete 3 steps to start managing your properties."
              : "Completa 3 pasos para comenzar a administrar tus propiedades."}
        </p>
      </div>

      <ProgressStepper steps={steps} />

      {showDemoSeed ? (
        <DemoSeedCallout
          isEn={isEn}
          onSeed={handleSeedDemo}
          submitting={submitting === "seed"}
        />
      ) : null}

      {onboardingDone ? (
        <CompletionCard
          isEn={isEn}
          nextActionLinks={nextActionLinks}
          rentalMode={rentalMode}
        />
      ) : null}

      <SetupStepOrganization
        isEn={isEn}
        onSubmit={handleCreateOrg}
        orgDone={orgDone}
        orgName={orgName}
        profileType={profileType}
        rentalMode={rentalMode}
        submitting={submitting}
      />

      <SetupStepProperty
        activeStep={activeStep}
        isEn={isEn}
        onImportClick={() => setImportPropertyOpen(true)}
        onSubmit={handleCreateProperty}
        propertyCount={properties.length}
        propertyDone={propertyDone}
        submitting={submitting}
      />

      <SetupStepUnit
        activeStep={activeStep}
        isEn={isEn}
        onImportClick={() => setImportUnitOpen(true)}
        onSubmit={handleCreateUnit}
        propertyOptions={propertyOptions}
        submitting={submitting}
        unitCount={units.length}
        unitDone={unitDone}
      />

      {onboardingDone && !step4Complete ? (
        <SetupStepConnect
          isEn={isEn}
          onCreateIntegration={handleCreateIntegrationStep4}
          onCreateLease={handleCreateLeaseStep4}
          onImportLeaseClick={() => setImportLeaseOpen(true)}
          onSkip={() => setStep4Skipped(true)}
          onStep4ViewChange={setStep4View}
          rentalMode={rentalMode}
          step4View={step4View}
          submitting={submitting}
          unitOptions={unitOptions}
        />
      ) : null}

      <TechnicalDetails
        apiBaseUrl={apiBaseUrl}
        isEn={isEn}
        orgId={orgId}
        profileType={profileType}
      />

      {orgDone ? null : (
        <ExistingOrganizations
          isEn={isEn}
          locale={locale}
          organizations={initialOrganizations}
        />
      )}

      {orgDone ? (
        <SetupAdvancedSection
          initialOrganizations={initialOrganizations}
          initialTab={initialTab}
          integrations={integrations}
          isEn={isEn}
          openAdvancedByDefault={Boolean(initialTab)}
          orgId={orgId as string}
          properties={properties}
          units={units}
        />
      ) : null}

      {orgDone ? null : (
        <div className="flex justify-center">
          <Link
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "text-muted-foreground"
            )}
            href="/app"
          >
            {isEn ? "Back to dashboard" : "Volver al panel"}
          </Link>
        </div>
      )}

      {orgId ? (
        <SetupImportSheets
          importLeaseOpen={effectiveImportLeaseOpen}
          importPropertyOpen={effectiveImportPropertyOpen}
          importUnitOpen={effectiveImportUnitOpen}
          isEn={isEn}
          onImportComplete={() => router.refresh()}
          onImportLeaseOpenChange={setImportLeaseOpen}
          onImportPropertyOpenChange={setImportPropertyOpen}
          onImportUnitOpenChange={setImportUnitOpen}
          orgId={orgId}
          propertyOptions={propertyOptions}
          unitOptions={unitOptions}
        />
      ) : null}
    </div>
  );
}
