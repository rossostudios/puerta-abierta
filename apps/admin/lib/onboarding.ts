import { fetchList } from "@/lib/api";

const ONBOARDING_TOTAL_STEPS = 3;

export type OnboardingProgress = {
  completedSteps: number;
  totalSteps: number;
  percent: number;
};

export async function getOnboardingProgress(
  orgId: string | null
): Promise<OnboardingProgress> {
  if (!orgId) {
    return {
      completedSteps: 0,
      totalSteps: ONBOARDING_TOTAL_STEPS,
      percent: 0,
    };
  }

  try {
    const [properties, units] = await Promise.all([
      fetchList("/properties", orgId, 1),
      fetchList("/units", orgId, 1),
    ]);
    const completedSteps = [
      true, // Step 1: Organization created (always true when orgId exists)
      properties.length > 0, // Step 2: At least one property
      units.length > 0, // Step 3: At least one unit
    ].filter(Boolean).length;

    return {
      completedSteps,
      totalSteps: ONBOARDING_TOTAL_STEPS,
      percent: Math.round((completedSteps / ONBOARDING_TOTAL_STEPS) * 100),
    };
  } catch {
    return {
      completedSteps: 1,
      totalSteps: ONBOARDING_TOTAL_STEPS,
      percent: Math.round(100 / ONBOARDING_TOTAL_STEPS),
    };
  }
}
