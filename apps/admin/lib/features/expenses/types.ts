export type ExpenseRow = {
  id: string;
  organization_id: string;
  property_id: string | null;
  property_name?: string | null;
  unit_id: string | null;
  unit_name?: string | null;
  reservation_id: string | null;
  category: string;
  vendor_name: string | null;
  expense_date: string;
  amount: number;
  currency: string;
  fx_rate_to_pyg?: number | null;
  payment_method: string;
  invoice_number?: string | null;
  invoice_ruc?: string | null;
  receipt_url?: string | null;
  notes?: string | null;
  created_by_user_id?: string | null;
  created_at?: string | null;
};

export type PropertyRow = { id: string; name?: string | null };

export type UnitRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  property_id?: string | null;
  property_name?: string | null;
};

export type ExpenseRecord = Record<string, unknown>;
