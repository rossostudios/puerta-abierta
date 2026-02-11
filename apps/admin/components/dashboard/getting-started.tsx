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
import { useEffect, useState } from "react";

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
  reservationCount: number;
  locale: string;
};

const DISMISS_KEY = "pa-onboarding-dismissed";

export function GettingStarted({
  propertyCount,
  unitCount,
  reservationCount,
  locale,
}: GettingStartedProps) {
  const [dismissed, setDismissed] = useState(true); // Default hidden until hydrated
  const isEn = locale === "en-US";

  useEffect(() => {
    const isDismissed = localStorage.getItem(DISMISS_KEY) === "true";
    setDismissed(isDismissed);
  }, []);

  const onDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  if (dismissed) return null;

  const steps = [
    {
      id: "org",
      label: isEn ? "Define organization" : "Definir organización",
      description: isEn
        ? "Basic workspace container."
        : "Contenedor básico del espacio.",
      done: true,
      icon: Home01Icon,
    },
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

  const allDone = steps.every((s) => s.done);
  if (allDone && propertyCount > 0) {
    // If they finished everything, we can still show it but maybe they can dismiss it
  }

  return (
    <Card className="relative overflow-hidden border-primary/20 bg-primary/5 transition-all duration-300 hover:border-primary/30">
      <Button
        className="absolute top-4 right-4 h-8 w-8 text-muted-foreground hover:bg-background/80"
        onClick={onDismiss}
        size="icon"
        variant="ghost"
      >
        <Icon icon={Cancel01Icon} size={16} />
      </Button>
      <CardHeader>
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
                "group relative flex flex-col gap-2 rounded-lg border bg-background p-4 transition-all",
                step.done
                  ? "border-primary/20 opacity-75"
                  : "hover:border-primary hover:shadow-sm"
              )}
              key={step.id}
            >
              <div className="flex items-center justify-between">
                <div
                  className={cn(
                    "rounded-md p-1.5",
                    step.done
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon icon={step.icon} size={18} />
                </div>
                {step.done ? (
                  <Icon className="text-primary" icon={Tick02Icon} size={18} />
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
                  className="mt-2 inline-flex items-center gap-1 font-medium text-primary text-xs hover:underline"
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
