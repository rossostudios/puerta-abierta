export type SubmittingState =
  | null
  | "org"
  | "property"
  | "unit"
  | "seed"
  | "integration"
  | "lease";

export type SelectOption = {
  id: string;
  label: string;
};

export type Step4View = "str" | "ltr";

export type SharedStepProps = {
  isEn: boolean;
  submitting: SubmittingState;
};

export type OrganizationProfileType =
  import("./setup-components").OrganizationProfileType;
export type RentalMode = import("./setup-components").RentalMode;
export type Row = import("./setup-components").Row;

export function fd(form: HTMLFormElement, name: string): string {
  const val = new FormData(form).get(name);
  return typeof val === "string" ? val.trim() : "";
}

export function fdNum(
  form: HTMLFormElement,
  name: string,
  fallback: number
): number {
  const raw = fd(form, name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
