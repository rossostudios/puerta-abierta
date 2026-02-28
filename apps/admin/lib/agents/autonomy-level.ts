export type AutonomyLevel = "copilot" | "collaborator" | "autonomous";

/**
 * Derives the current autonomy level from approval policies.
 *
 * - Copilot: all mutation tools require approval
 * - Autonomous: most tools are auto-approved
 * - Collaborator: mixed (some require approval, some don't)
 */
export function deriveAutonomyLevel(
  policies: Array<{
    tool_name: string;
    approval_mode: string;
    enabled: boolean;
  }>
): AutonomyLevel {
  const activePolicies = policies.filter((p) => p.enabled);

  if (activePolicies.length === 0) return "autonomous";

  const requiredCount = activePolicies.filter(
    (p) => p.approval_mode === "required"
  ).length;
  const autoCount = activePolicies.filter(
    (p) => p.approval_mode === "auto"
  ).length;

  if (requiredCount === activePolicies.length) return "copilot";
  if (autoCount === activePolicies.length) return "autonomous";
  return "collaborator";
}
