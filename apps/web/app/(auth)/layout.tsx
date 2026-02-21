import { Building01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { CasaoraLogo } from "@/components/icons/casaora-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Icon } from "@/components/ui/icon";

export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Left panel */}
      <div className="relative flex w-full flex-col lg:w-1/2">
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <ThemeToggle />
        </div>

        <div className="absolute top-4 left-6 z-10">
          <Link
            className="flex items-center gap-2 font-bold text-foreground text-lg tracking-tight transition-opacity hover:opacity-80"
            href="/"
          >
            <CasaoraLogo size={24} />
            CASAORA
          </Link>
        </div>

        <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-6 py-20">
          {children}
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 text-muted-foreground text-xs">
          <span>
            &copy;{new Date().getFullYear()} Casaora. All rights reserved.
          </span>
          <div className="flex items-center gap-3">
            <Link className="transition-colors hover:text-foreground" href="#">
              Privacy Policy
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link className="transition-colors hover:text-foreground" href="#">
              Terms & Conditions
            </Link>
          </div>
        </footer>
      </div>

      {/* Right panel (brand illustration) */}
      <div className="hidden items-center justify-center overflow-hidden bg-[#0f1117] p-10 lg:flex lg:w-1/2">
        <div className="flex max-w-lg flex-col items-center gap-10">
          <div className="relative w-full overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] to-transparent shadow-2xl">
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-4 p-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
                <Icon
                  className="text-white/25"
                  icon={Building01Icon}
                  size={28}
                />
              </div>
              <span className="text-sm text-white/25">Image Placeholder</span>
            </div>
          </div>

          <div className="text-center">
            <h2 className="font-semibold text-white text-xl">
              Manage Your Properties
            </h2>
            <p className="mt-2 text-sm text-white/50">
              Short-term rental operations in Paraguay, simplified.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-white" />
            <span className="h-2 w-2 rounded-full bg-white/20" />
            <span className="h-2 w-2 rounded-full bg-white/20" />
          </div>
        </div>
      </div>
    </div>
  );
}
