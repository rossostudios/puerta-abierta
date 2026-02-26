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

export default async function ForgotPasswordPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_0%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_45%),radial-gradient(circle_at_100%_10%,color-mix(in_oklch,var(--chart-2)_12%,transparent),transparent_55%)]" />
      <CardHeader className="relative">
        <CardTitle className="text-2xl">
          {isEn ? "Reset password" : "Restablecer contraseña"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Password reset is now handled by Clerk inside the sign-in flow."
            : "El restablecimiento de contraseña ahora se gestiona con Clerk dentro del inicio de sesión."}
        </CardDescription>
      </CardHeader>
      <CardContent className="relative space-y-4">
        <p className="text-muted-foreground text-sm">
          {isEn
            ? "Open the sign-in page and use the “Forgot password?” option."
            : "Abre la página de inicio de sesión y usa la opción “Olvidé mi contraseña”."}
        </p>
        <Button asChild className="w-full">
          <Link href="/login">
            {isEn ? "Go to sign in" : "Ir a iniciar sesión"}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
