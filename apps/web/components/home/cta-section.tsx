import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { ScrollReveal } from "@/components/scroll-reveal";

export function CtaSection() {
  return (
    <section className="bg-casaora-gradient py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ScrollReveal className="mx-auto max-w-3xl text-center">
          <h2 className="font-semibold text-3xl text-white tracking-tight lg:text-5xl">
            Ready to transform your property operations?
          </h2>
          <p className="mt-4 text-lg text-white/80">
            Join hundreds of property teams already using Casaora to streamline
            their business.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              className="inline-flex h-12 items-center gap-2 rounded-lg bg-white px-6 font-medium text-[#1e3a8a] text-sm transition-opacity hover:opacity-90"
              href="/contact"
            >
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              className="inline-flex h-12 items-center gap-2 rounded-lg border border-white/30 px-6 font-medium text-sm text-white transition-colors hover:bg-white/10"
              href="/pricing"
            >
              View pricing
            </Link>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
