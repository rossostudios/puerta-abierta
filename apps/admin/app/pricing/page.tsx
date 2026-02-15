import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Pricing — Puerta Abierta",
  description:
    "Planes transparentes para administrar tus propiedades de alquiler en Paraguay.",
};

type Plan = {
  id: string;
  name: string;
  max_properties: number | null;
  max_units: number | null;
  max_users: number | null;
  price_usd: number | null;
  price_pyg: number | null;
  features: Record<string, unknown>;
};

function formatPYG(value: number | null): string {
  if (value == null || value === 0) return "Gratis";
  const formatted = Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `₲${formatted}`;
}

function formatUSD(value: number | null): string {
  if (value == null || value === 0) return "Free";
  return `$${value}`;
}

export default async function PricingPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  let plans: Plan[] = [];
  try {
    const result = await fetchJson<{ data?: Plan[] }>(
      "/public/subscription-plans"
    );
    plans = result.data ?? [];
  } catch {
    // Plans couldn't be loaded — show a fallback
  }

  const highlighted = plans.length >= 2 ? 1 : 0; // Highlight second plan (Professional)

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <div className="text-center mb-12">
        <Badge variant="outline" className="mb-3">
          {isEn ? "Pricing" : "Precios"}
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {isEn
            ? "Simple, transparent pricing"
            : "Precios simples y transparentes"}
        </h1>
        <p className="mt-3 text-lg text-muted-foreground max-w-xl mx-auto">
          {isEn
            ? "Start for free, upgrade as you grow. All plans include a 14-day free trial."
            : "Empieza gratis, actualiza a medida que crezcas. Todos los planes incluyen 14 días de prueba gratis."}
        </p>
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "Plans coming soon" : "Planes próximamente"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Contact us for early access pricing."
                : "Contáctanos para precios de acceso anticipado."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan, i) => {
            const isPopular = i === highlighted;
            return (
              <Card
                key={plan.id}
                className={cn(
                  "relative flex flex-col",
                  isPopular && "border-primary shadow-lg"
                )}
              >
                {isPopular ? (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground">
                      {isEn ? "Most popular" : "Más popular"}
                    </Badge>
                  </div>
                ) : null}
                <CardHeader className="pb-2">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">
                      {isEn
                        ? formatUSD(plan.price_usd)
                        : formatPYG(plan.price_pyg)}
                    </span>
                    {(plan.price_usd ?? 0) > 0 ? (
                      <span className="text-muted-foreground text-sm">
                        /{isEn ? "mo" : "mes"}
                      </span>
                    ) : null}
                  </div>
                  {!isEn && (plan.price_usd ?? 0) > 0 ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      ~{formatUSD(plan.price_usd)}/mes USD
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <span className="text-green-500">&#10003;</span>
                      {plan.max_properties
                        ? `${plan.max_properties} ${isEn ? "properties" : "propiedades"}`
                        : isEn
                          ? "Unlimited properties"
                          : "Propiedades ilimitadas"}
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-500">&#10003;</span>
                      {plan.max_units
                        ? `${plan.max_units} ${isEn ? "units" : "unidades"}`
                        : isEn
                          ? "Unlimited units"
                          : "Unidades ilimitadas"}
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-500">&#10003;</span>
                      {plan.max_users
                        ? `${plan.max_users} ${isEn ? "team members" : "miembros del equipo"}`
                        : isEn
                          ? "Unlimited team"
                          : "Equipo ilimitado"}
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-500">&#10003;</span>
                      {isEn ? "WhatsApp reminders" : "Recordatorios WhatsApp"}
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-500">&#10003;</span>
                      {isEn ? "Automated collections" : "Cobros automatizados"}
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-green-500">&#10003;</span>
                      {isEn ? "Owner reports" : "Reportes de propietario"}
                    </li>
                  </ul>
                  <Link
                    className={cn(
                      buttonVariants({
                        variant: isPopular ? "default" : "outline",
                      }),
                      "w-full"
                    )}
                    href={`/signup?plan=${plan.id}`}
                  >
                    {isEn ? "Get started" : "Comenzar"}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mt-12 text-center text-sm text-muted-foreground">
        <p>
          {isEn
            ? "Need a custom plan for 100+ units? "
            : "¿Necesitas un plan personalizado para 100+ unidades? "}
          <a
            className="text-primary underline-offset-4 hover:underline"
            href="mailto:hello@puertaabierta.com"
          >
            {isEn ? "Contact us" : "Contáctanos"}
          </a>
        </p>
      </div>
    </div>
  );
}
