export type AgentRow = {
  slug: string;
  name: string;
  description: string;
  icon_key: string;
  is_active: boolean;
  model_override?: string | null;
  max_steps_override?: number | null;
  allow_mutations_default?: boolean | null;
  overrides_updated_at?: string | null;
  created_at: string;
  updated_at: string;
};
