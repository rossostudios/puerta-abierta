"use client";

import { Logout01Icon } from "@hugeicons/core-free-icons";
import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useActiveLocale } from "@/lib/i18n/client";

type SignOutButtonProps = ButtonProps & {
  redirectTo?: string;
};

export function SignOutButton({
  redirectTo = "/login",
  children,
  ...props
}: SignOutButtonProps) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const router = useRouter();
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    const errorMsg = isEn ? "Could not sign out" : "No se pudo cerrar sesión";

    try {
      await signOut();
      router.replace(redirectTo);
      router.refresh();
      setBusy(false);
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      toast.error(errorMsg, { description });
      setBusy(false);
    }
  };

  return (
    <Button disabled={busy} onClick={onClick} type="button" {...props}>
      <Icon icon={Logout01Icon} size={16} />
      {children ?? (isEn ? "Sign out" : "Cerrar sesión")}
    </Button>
  );
}
