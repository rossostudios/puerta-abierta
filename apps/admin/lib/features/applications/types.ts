import type { DataTableRow } from "@/components/ui/data-table";

export type ApplicationRow = DataTableRow & {
  id: string;
  full_name: string;
  email: string;
  phone_e164: string | null;
  status: string;
  status_label: string;
  listing_title: string;
  monthly_income: number;
  first_response_minutes: number;
  created_at: string;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  response_sla_status: string;
  response_sla_alert_level: string;
  response_sla_due_at: string | null;
  response_sla_remaining_minutes: number;
  qualification_score: number;
  qualification_band: string;
  income_to_rent_ratio: number | null;
};

export type MessageTemplateOption = {
  id: string;
  channel: string;
  template_key: string;
  name: string;
  subject: string;
  body: string;
  is_active: boolean;
};

export type BoardLane = {
  key: string;
  label: {
    "es-PY": string;
    "en-US": string;
  };
  statuses: string[];
};
