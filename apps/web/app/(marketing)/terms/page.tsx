import type { Metadata } from "next";
import { Section } from "@/components/layout/section";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Casaora terms of service — the rules and guidelines for using our platform.",
};

export default function TermsPage() {
  return (
    <Section>
      <div className="mx-auto max-w-3xl">
        <h1 className="font-bold text-4xl tracking-tight">Terms of Service</h1>
        <p className="mt-4 text-muted-foreground">
          Last updated: February 2026
        </p>

        <div className="mt-10 space-y-8 text-muted-foreground text-sm leading-relaxed">
          <div>
            <h2 className="mb-3 font-semibold text-foreground text-lg">
              Acceptance of Terms
            </h2>
            <p>
              By accessing or using Casaora, you agree to be bound by these
              terms. If you do not agree, please do not use our services.
            </p>
          </div>

          <div>
            <h2 className="mb-3 font-semibold text-foreground text-lg">
              Use of Services
            </h2>
            <p>
              Casaora provides a marketplace for long-term property rentals and
              tools for property management. You agree to use the platform only
              for lawful purposes and in accordance with these terms.
            </p>
          </div>

          <div>
            <h2 className="mb-3 font-semibold text-foreground text-lg">
              Listing Accuracy
            </h2>
            <p>
              Property managers are responsible for the accuracy of their
              listings. Casaora does not guarantee the accuracy, completeness, or
              availability of any listing information.
            </p>
          </div>

          <div>
            <h2 className="mb-3 font-semibold text-foreground text-lg">
              Limitation of Liability
            </h2>
            <p>
              Casaora is provided &quot;as is&quot; without warranties of any
              kind. We are not liable for any damages arising from your use of
              the platform.
            </p>
          </div>

          <div>
            <h2 className="mb-3 font-semibold text-foreground text-lg">
              Contact
            </h2>
            <p>
              For questions about these terms, contact us at{" "}
              <a
                className="text-primary underline underline-offset-4"
                href="mailto:legal@casaora.co"
              >
                legal@casaora.co
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
