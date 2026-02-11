import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getActiveLocale } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export default async function NotFound() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  return (
    <div className="mx-auto mt-8 max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Page not found" : "Módulo no encontrado"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "The requested route does not match any configured module."
              : "La ruta solicitada no corresponde a un módulo configurado."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href="/app"
          >
            {isEn ? "Back to dashboard" : "Volver al panel"}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
