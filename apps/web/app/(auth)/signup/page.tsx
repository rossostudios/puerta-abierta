"use client";

import {
  ArrowRight01Icon,
  Building06Icon,
  CoinsDollarIcon,
  Home01Icon,
  LockPasswordIcon,
  Mail01Icon,
  MoreHorizontalIcon,
  UserCircle02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getAdminUrl, getSiteUrl } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";

type RoleOption = {
  value: string;
  label: string;
  description: string;
  icon: IconSvgElement;
};

const ROLES: readonly RoleOption[] = [
  {
    value: "property_owner",
    label: "Property Owner",
    description: "I own properties and want to manage them",
    icon: Home01Icon,
  },
  {
    value: "property_management_company",
    label: "Property Management Co.",
    description: "I manage properties for multiple owners",
    icon: Building06Icon,
  },
  {
    value: "investor",
    label: "Investor",
    description: "I'm looking for investment opportunities",
    icon: CoinsDollarIcon,
  },
  {
    value: "tenant",
    label: "Tenant / Renter",
    description: "I'm looking for a place to rent",
    icon: UserGroupIcon,
  },
  {
    value: "other",
    label: "Other",
    description: "Something else entirely",
    icon: MoreHorizontalIcon,
  },
];

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const adminUrl = getAdminUrl();
  const siteUrl = getSiteUrl();

  const [step, setStep] = useState<"role" | "details">("role");
  const [selectedRole, setSelectedRole] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState(
    searchParams.get("ref") ?? ""
  );
  const [busy, setBusy] = useState(false);

  const supabase = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      toast.error("Supabase is not configured", {
        description:
          "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in apps/web/.env.local.",
      });
      return;
    }

    const trimmedEmail = email.trim();
    if (!(trimmedEmail && password)) {
      toast.error("Missing information", {
        description: "Email and password are required.",
      });
      return;
    }

    setBusy(true);
    const redirectUrl = `${siteUrl}/auth/callback?next=${encodeURIComponent(`${adminUrl}/app`)}`;
    try {
      const { error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            ...(fullName.trim() ? { full_name: fullName.trim() } : {}),
            ...(selectedRole ? { role: selectedRole } : {}),
          },
          emailRedirectTo: redirectUrl,
        },
      });

      if (error) {
        toast.error("Could not create account", {
          description: error.message,
        });
        setBusy(false);
        return;
      }

      const trimmedRef = referralCode.trim().toUpperCase();
      if (trimmedRef) {
        localStorage.setItem("pa-referral-code", trimmedRef);
      }

      toast.success("Account created", {
        description: "Check your email to confirm your address.",
      });
      window.location.href = "/login";
      setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_0%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_45%),radial-gradient(circle_at_100%_10%,color-mix(in_oklch,var(--chart-2,#3b82f6)_12%,transparent),transparent_55%)]" />

      <CardHeader className="relative">
        <CardTitle className="text-2xl">Create account</CardTitle>
        <CardDescription>
          {step === "role"
            ? "What best describes you?"
            : "Fill in your details to get started."}
        </CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-4">
        {step === "role" ? (
          <div className="space-y-3">
            {ROLES.map((role) => (
              <button
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                  selectedRole === role.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30 hover:bg-muted/50"
                )}
                key={role.value}
                onClick={() => setSelectedRole(role.value)}
                type="button"
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                    selectedRole === role.value
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-muted/50 text-muted-foreground"
                  )}
                >
                  <Icon icon={role.icon} size={18} />
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-sm">{role.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {role.description}
                  </p>
                </div>
              </button>
            ))}

            <Button
              className="group w-full gap-2"
              disabled={!selectedRole}
              onClick={() => setStep("details")}
              type="button"
            >
              Continue
              <Icon
                className="transition-transform group-hover:translate-x-0.5"
                icon={ArrowRight01Icon}
                size={18}
              />
            </Button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={onSubmit}>
            <button
              className="mb-2 text-muted-foreground text-xs hover:text-foreground"
              onClick={() => setStep("role")}
              type="button"
            >
              &larr; Change role
            </button>

            <label className="block" htmlFor="signup-full-name">
              <span className="mb-1 block font-medium text-muted-foreground text-xs">
                Full name
              </span>
              <div className="relative">
                <Icon
                  className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                  icon={UserCircle02Icon}
                  size={16}
                />
                <Input
                  autoComplete="name"
                  className="pl-9"
                  id="signup-full-name"
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Your name"
                  value={fullName}
                />
              </div>
            </label>

            <label className="block" htmlFor="signup-email">
              <span className="mb-1 block font-medium text-muted-foreground text-xs">
                Email
              </span>
              <div className="relative">
                <Icon
                  className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                  icon={Mail01Icon}
                  size={16}
                />
                <Input
                  autoComplete="email"
                  className="pl-9"
                  id="signup-email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  type="email"
                  value={email}
                />
              </div>
            </label>

            <label className="block" htmlFor="signup-password">
              <span className="mb-1 block font-medium text-muted-foreground text-xs">
                Password
              </span>
              <div className="relative">
                <Icon
                  className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                  icon={LockPasswordIcon}
                  size={16}
                />
                <Input
                  autoComplete="new-password"
                  className="pl-9"
                  id="signup-password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Create a password"
                  type="password"
                  value={password}
                />
              </div>
            </label>

            <label className="block" htmlFor="signup-referral-code">
              <span className="mb-1 block font-medium text-muted-foreground text-xs">
                Referral code (optional)
              </span>
              <Input
                className="font-mono uppercase"
                id="signup-referral-code"
                onChange={(event) => setReferralCode(event.target.value)}
                placeholder="PA-XXXXXXXX"
                value={referralCode}
              />
            </label>

            <Button
              className="group w-full gap-2"
              disabled={busy}
              type="submit"
            >
              <span
                className={cn(
                  "transition-opacity",
                  busy ? "opacity-60" : "opacity-100"
                )}
              >
                Create account
              </span>
              <Icon
                className={cn(
                  "transition-transform",
                  busy ? "translate-x-0" : "group-hover:translate-x-0.5"
                )}
                icon={ArrowRight01Icon}
                size={18}
              />
            </Button>
          </form>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/login"
          >
            Already have an account?
          </Link>
          <Link
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/forgot-password"
          >
            Forgot your password?
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
