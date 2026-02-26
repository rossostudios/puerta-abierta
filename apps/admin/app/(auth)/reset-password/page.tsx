import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getActiveLocale } from "@/lib/i18n/server";

export default async function ResetPasswordPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_0%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_45%),radial-gradient(circle_at_100%_10%,color-mix(in_oklch,var(--chart-2)_12%,transparent),transparent_55%)]" />
      <CardHeader className="relative">
        <CardTitle className="text-2xl">
          {isEn ? "Password reset link updated" : "Enlace de contraseña actualizado"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Supabase reset links are no longer used. Clerk now handles password reset and account recovery."
            : "Los enlaces de restablecimiento de Supabase ya no se usan. Clerk ahora maneja el restablecimiento y la recuperación de cuenta."}
        </CardDescription>
      </CardHeader>
      <CardContent className="relative space-y-4">
        <p className="text-muted-foreground text-sm">
          {isEn
            ? "Start again from the sign-in page and choose the Clerk password reset flow."
            : "Comienza nuevamente desde la página de inicio de sesión y elige el flujo de restablecimiento de Clerk."}
        </p>
        <Button asChild className="w-full">
          <Link href="/login">
            {isEn ? "Back to sign in" : "Volver a iniciar sesión"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
