"use client";

import {
  ArrowRight01Icon,
  CalendarCheckIn01Icon,
  Cancel01Icon,
  CircleIcon,
  Home01Icon,
  HotelIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import {
  type ComponentProps,
  useCallback,
  useState,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type GettingStartedProps = {
  propertyCount: number;
  unitCount: number;
  integrationCount?: number;
  reservationCount: number;
  taskCount?: number;
  applicationCount?: number;
  collectionCount?: number;
  onboardingCompleted?: boolean;
  role?: "owner_admin" | "operator" | "accountant" | "viewer";
  locale: string;
};

type OnboardingStep = {
  id: string;
  label: string;
  description: string;
  done: boolean;
  icon: ComponentProps<typeof Icon>["icon"];
  href?: string;
};

const DISMISS_KEY = "pa-onboarding-dismissed";

export function GettingStarted({
  propertyCount,
  unitCount,
  integrationCount = 0,
  reservationCount,
  taskCount = 0,
  applicationCount = 0,
  collectionCount = 0,
  onboardingCompleted = false,
  role = "viewer",
  locale,
}: GettingStartedProps) {
  const isEn = locale === "en-US";

  const emptySubscribe = useCallback(() => () => undefined, []);
  const getDismissed = useCallback(
    () => localStorage.getItem(DISMISS_KEY) === "true",
    []
  );
  const getServerDismissed = useCallback(() => true, []); // Default hidden until hydrated
  const dismissed = useSyncExternalStore(
    emptySubscribe,
    getDismissed,
    getServerDismissed
  );
  const [, forceUpdate] = useState(0);

  const onDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    forceUpdate((c) => c + 1);
  };

  if (dismissed) return null;

  const commonStep: OnboardingStep = {
    id: "org",
    label: isEn ? "Define organization" : "Definir organización",
    description: isEn
      ? "Basic workspace container."
      : "Contenedor básico del espacio.",
    done: true,
    icon: Home01Icon,
  };

  const postOnboardingSteps: OnboardingStep[] = [
    {
      id: "channels",
      label: isEn ? "Connect channels" : "Conectar canales",
      description: isEn
        ? "Link Airbnb, Booking.com, direct and more via iCal."
        : "Conecta Airbnb, Booking.com, direct y más vía iCal.",
      done: integrationCount > 0,
      icon: HotelIcon,
      href: "/module/channels",
    },
    {
      id: "ops-start",
      label: isEn ? "Start reservations/tasks" : "Iniciar reservas/tareas",
      description: isEn
        ? "Begin day-to-day operations execution."
        : "Inicia la ejecución operativa diaria.",
      done: reservationCount > 0 || taskCount > 0,
      icon: CalendarCheckIn01Icon,
      href: "/module/reservations",
    },
  ];

  const operatorSteps: OnboardingStep[] = [
    {
      id: "property",
      label: isEn ? "Add a property" : "Agregar una propiedad",
      description: isEn
        ? "Your first portfolio record."
        : "Tu primer registro de portafolio.",
      done: propertyCount > 0,
      icon: HotelIcon,
      href: "/setup?tab=properties",
    },
    {
      id: "units",
      label: isEn ? "Register units" : "Registrar unidades",
      description: isEn
        ? "Link units to properties."
        : "Vincula unidades a propiedades.",
      done: unitCount > 0,
      icon: HotelIcon,
      href: "/setup?tab=units",
    },
    {
      id: "ops",
      label: isEn ? "Set up operations" : "Configurar operaciones",
      description: isEn
        ? "Create reservations or tasks."
        : "Crea reservas o tareas.",
      done: reservationCount > 0,
      icon: CalendarCheckIn01Icon,
      href: "/module/reservations",
    },
  ];

  const ownerSteps: OnboardingStep[] = [
    {
      id: "marketplace",
      label: isEn ? "Publish marketplace listing" : "Publicar anuncio",
      description: isEn
        ? "Complete transparency and launch your first listing."
        : "Completa transparencia y publica tu primer anuncio.",
      done: propertyCount > 0,
      icon: Home01Icon,
      href: "/module/listings",
    },
    {
      id: "applications",
      label: isEn ? "Qualify applications" : "Calificar aplicaciones",
      description: isEn
        ? "Assign and convert applicants into leases."
        : "Asigna y convierte solicitantes en contratos.",
      done: applicationCount > 0,
      icon: Tick02Icon,
      href: "/module/applications",
    },
    {
      id: "statements",
      label: isEn ? "Review payout statements" : "Revisar liquidaciones",
      description: isEn
        ? "Validate net payout and reconciliation."
        : "Valida pago neto y conciliación.",
      done: collectionCount > 0,
      icon: CalendarCheckIn01Icon,
      href: "/module/owner-statements",
    },
  ];

  const accountantSteps: OnboardingStep[] = [
    {
      id: "collections",
      label: isEn ? "Track collections" : "Registrar cobranzas",
      description: isEn
        ? "Keep lease collections up to date."
        : "Mantén cobranzas de contratos al día.",
      done: collectionCount > 0,
      icon: CalendarCheckIn01Icon,
      href: "/module/collections",
    },
    {
      id: "expenses",
      label: isEn ? "Register expenses" : "Registrar gastos",
      description: isEn
        ? "Capture operating expenses with receipts."
        : "Carga gastos operativos con comprobantes.",
      done: reservationCount > 0,
      icon: HotelIcon,
      href: "/module/expenses",
    },
    {
      id: "reconcile",
      label: isEn ? "Reconcile payout statements" : "Conciliar liquidaciones",
      description: isEn
        ? "Review statement diffs before closing month."
        : "Revisa diferencias antes de cerrar mes.",
      done: collectionCount > 0,
      icon: Tick02Icon,
      href: "/module/owner-statements",
    },
  ];

  const steps = onboardingCompleted
    ? [commonStep, ...postOnboardingSteps]
    : role === "operator"
      ? [commonStep, ...operatorSteps]
      : role === "owner_admin"
        ? [commonStep, ...ownerSteps]
        : role === "accountant"
          ? [commonStep, ...accountantSteps]
          : [commonStep, ...operatorSteps];

  const allDone = steps.every((s) => s.done);
  if (allDone && propertyCount > 0) {
    // If they finished everything, we can still show it but maybe they can dismiss it
  }

  return (
    <Card className="relative overflow-hidden transition-all duration-300">
      <Button
        className="absolute top-4 right-4 h-8 w-8 text-muted-foreground hover:bg-muted/50"
        onClick={onDismiss}
        size="icon"
        variant="ghost"
      >
        <Icon icon={Cancel01Icon} size={16} />
      </Button>
      <CardHeader className="border-border/70 border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-xl">
          {isEn ? "Getting started" : "Primeros pasos"}
        </CardTitle>
        <CardDescription className="max-w-md">
          {isEn
            ? "Complete these steps to unlock the full potential of your operations dashboard."
            : "Completa estos pasos para desbloquear todo el potencial de tu panel de operaciones."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              className={cn(
                "group relative flex flex-col gap-2 rounded-2xl border border-border/75 bg-background/90 p-4 transition-all",
                step.done
                  ? "opacity-76"
                  : "hover:border-border hover:bg-background"
              )}
              key={step.id}
            >
              <div className="flex items-center justify-between">
                <div
                  className={cn(
                    "rounded-lg border border-border/70 p-1.5",
                    step.done
                      ? "bg-muted/60 text-foreground"
                      : "bg-muted/40 text-muted-foreground"
                  )}
                >
                  <Icon icon={step.icon} size={18} />
                </div>
                {step.done ? (
                  <Icon
                    className="text-foreground/80"
                    icon={Tick02Icon}
                    size={18}
                  />
                ) : (
                  <Icon
                    className="text-muted-foreground/30"
                    icon={CircleIcon}
                    size={18}
                  />
                )}
              </div>
              <div className="mt-1">
                <p className="font-semibold text-sm leading-none">
                  {step.label}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  {step.description}
                </p>
              </div>
              {!step.done && step.href && (
                <Link
                  className="mt-2 inline-flex items-center gap-1 font-medium text-foreground text-xs hover:underline"
                  href={step.href}
                >
                  {isEn ? "Go to step" : "Ir al paso"}
                  <Icon icon={ArrowRight01Icon} size={12} />
                </Link>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
