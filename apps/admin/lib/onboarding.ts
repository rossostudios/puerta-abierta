import { fetchList } from "@/lib/api";

const ONBOARDING_TOTAL_STEPS = 7;

export type OnboardingProgress = {
    completedSteps: number;
    totalSteps: number;
    percent: number;
};

export async function getOnboardingProgress(orgId: string | null): Promise<OnboardingProgress> {
    if (!orgId) {
        return {
            completedSteps: 0,
            totalSteps: ONBOARDING_TOTAL_STEPS,
            percent: 0,
        };
    }

    try {
        const [properties, units, paymentInstructions, notificationRules, members] = await Promise.all([
            fetchList("/properties", orgId, 1),
            fetchList("/units", orgId, 1),
            fetchList("/payment-instructions", orgId, 1),
            fetchList("/notification-rules", orgId, 1),
            fetchList("/organizations/" + orgId + "/members", orgId, 1).catch(() => []),
        ]);
        const completedSteps = [
            true, // Step 1: Organization created (always true)
            properties.length > 0, // Step 2: Properties imported
            units.length > 0, // Step 3: Units imported
            true, // Step 4: Rental mode (implicit — always set during org creation)
            paymentInstructions.length > 0, // Step 5: Payment details configured
            notificationRules.length > 0, // Step 6: Notification preferences
            members.length > 1, // Step 7: Team members invited
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
