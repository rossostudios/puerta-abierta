"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { CARD, EASING, type OnboardingStatus } from "./helpers";

type Step = {
  title: string;
  subtitle: string;
  prompt: string;
  done: boolean;
};

function buildSteps(onboarding: OnboardingStatus): Step[] {
  return [
    {
      title: "Add your first property",
      subtitle: "Tell me about it or import from Airbnb",
      prompt: "I'd like to add my first property",
      done: onboarding.has_properties,
    },
    {
      title: "Connect your channels",
      subtitle: "Airbnb, VRBO, bank accounts",
      prompt: "Help me connect my booking channels",
      done: onboarding.has_integrations,
    },
    {
      title: "Add tenants or guests",
      subtitle: "I'll manage communications from there",
      prompt: "I want to add tenants or guests",
      done: onboarding.has_tenants_or_guests,
    },
    {
      title: "Set your AI boundaries",
      subtitle: "What I can do autonomously vs. with your approval",
      prompt: "Help me configure AI autonomy settings",
      done: onboarding.has_ai_config,
    },
  ];
}

const STEP_ICONS = [
  // Property icon
  <svg
    aria-label="Property"
    className="h-4 w-4"
    fill="none"
    key="prop"
    role="img"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.5}
    viewBox="0 0 24 24"
  >
    <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
  </svg>,
  // Link/channel icon
  <svg
    aria-label="Channels"
    className="h-4 w-4"
    fill="none"
    key="link"
    role="img"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.5}
    viewBox="0 0 24 24"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>,
  // User icon
  <svg
    aria-label="Users"
    className="h-4 w-4"
    fill="none"
    key="user"
    role="img"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.5}
    viewBox="0 0 24 24"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>,
  // Settings/gear icon
  <svg
    aria-label="Settings"
    className="h-4 w-4"
    fill="none"
    key="gear"
    role="img"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.5}
    viewBox="0 0 24 24"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>,
];

export function OnboardingCard({
  onboarding,
  onSend,
  disabled,
}: {
  onboarding: OnboardingStatus;
  onSend: (message: string) => void;
  disabled?: boolean;
}) {
  const steps = buildSteps(onboarding);
  const completedCount = steps.filter((s) => s.done).length;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(CARD, "space-y-4 p-5")}
      initial={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.4, ease: EASING }}
    >
      <div className="flex items-center justify-between">
        <p className="font-semibold text-foreground text-sm">
          Get started with Casaora
        </p>
        <span className="text-muted-foreground/60 text-xs tabular-nums">
          {completedCount} of 4 complete
        </span>
      </div>

      <div className="space-y-1">
        {steps.map((step, i) => (
          <motion.div
            animate={{ opacity: 1, x: 0 }}
            className={cn(
              "flex items-center gap-3 rounded-xl p-3 transition-colors",
              step.done ? "opacity-50" : "glass-inner"
            )}
            initial={{ opacity: 0, x: -8 }}
            key={step.title}
            transition={{
              delay: 0.1 + i * 0.08,
              duration: 0.3,
              ease: EASING,
            }}
          >
            {/* Icon or checkmark */}
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                step.done
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "glass-inner text-muted-foreground/60"
              )}
            >
              {step.done ? (
                <svg
                  aria-label="Complete"
                  className="h-4 w-4"
                  fill="none"
                  role="img"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                STEP_ICONS[i]
              )}
            </div>

            {/* Text */}
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "font-medium text-sm",
                  step.done
                    ? "text-muted-foreground line-through"
                    : "text-foreground"
                )}
              >
                {step.title}
              </p>
              <p className="text-muted-foreground/60 text-xs">
                {step.subtitle}
              </p>
            </div>

            {/* Action button */}
            {!step.done && (
              <button
                className="shrink-0 rounded-lg bg-foreground px-3 py-1.5 font-medium text-[12px] text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
                disabled={disabled}
                onClick={() => onSend(step.prompt)}
                type="button"
              >
                Start &rarr;
              </button>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
