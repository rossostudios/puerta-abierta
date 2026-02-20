import type { Metadata } from "next";
import { Section } from "@/components/layout/section";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Casaora privacy policy — how we collect, use, and protect your personal data.",
};

export default function PrivacyPage() {
  return (
    <Section>
      <div className="mx-auto max-w-3xl">
        <h1 className="font-bold text-4xl tracking-tight">Privacy Policy</h1>
        <p className="mt-4 text-muted-foreground">
          Last updated: February 2026
        </p>

        <div className="mt-10 space-y-8 text-muted-foreground text-sm leading-relaxed">
          <div>
            <h2 className="mb-3 font-semibold text-foreground text-lg">
              Information We Collect
            </h2>
            <p>
              We collect information you provide directly, such as your name,
              email address, and property preferences when you create an account
              or use our marketplace. We also collect usage data automatically,
              including pages visited and interactions with listings.
            </p>
          </div>

          <div>
            <h2 className="mb-3 font-semibold text-foreground text-lg">
              How We Use Your Information
            </h2>
            <p>
              Your information is used to provide and improve our services,
              personalize your experience, communicate important updates, and
              ensure the security of our platform.
            </p>
          </div>

          <div>
            <h2 className="mb-3 font-semibold text-foreground text-lg">
              Data Sharing
            </h2>
            <p>
              We do not sell your personal data. We may share information with
              property managers when you inquire about a listing, and with
              service providers who help us operate our platform.
            </p>
          </div>

          <div>
            <h2 className="mb-3 font-semibold text-foreground text-lg">
              Contact
            </h2>
            <p>
              For questions about this policy, contact us at{" "}
              <a
                className="text-primary underline underline-offset-4"
                href="mailto:privacy@casaora.co"
              >
                privacy@casaora.co
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
