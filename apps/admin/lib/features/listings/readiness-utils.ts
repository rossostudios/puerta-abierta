export type ReadinessLevel = "green" | "yellow" | "red";

export function readinessLevel(score: number): ReadinessLevel {
  if (score >= 80) return "green";
  if (score >= 50) return "yellow";
  return "red";
}
