-- Sprint 2: Pricing agent, Finance agent, Direct Booking, Mercado Pago

-- Pricing recommendations table
CREATE TABLE IF NOT EXISTS pricing_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  pricing_template_id UUID,
  recommendation_type TEXT NOT NULL DEFAULT 'rate_adjustment',
  current_rate NUMERIC(12,2),
  recommended_rate NUMERIC(12,2),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  reasoning TEXT NOT NULL,
  revenue_impact_estimate NUMERIC(12,2),
  date_range_start DATE,
  date_range_end DATE,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  agent_slug TEXT NOT NULL DEFAULT 'price-optimizer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_recommendations_org_status
  ON pricing_recommendations(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_recommendations_unit
  ON pricing_recommendations(unit_id, status);

ALTER TABLE pricing_recommendations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pricing_recommendations'
      AND policyname = 'pricing_recommendations_org_member_all'
  ) THEN
    CREATE POLICY pricing_recommendations_org_member_all
      ON pricing_recommendations FOR ALL
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_pricing_recommendations_updated_at'
  ) THEN
    CREATE TRIGGER trg_pricing_recommendations_updated_at
      BEFORE UPDATE ON pricing_recommendations
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Add IVA/IRP fields to owner_statements
ALTER TABLE owner_statements
  ADD COLUMN IF NOT EXISTS iva_rate NUMERIC(5,2) DEFAULT 10.0,
  ADD COLUMN IF NOT EXISTS iva_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS irp_applicable BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_summary JSONB DEFAULT '{}'::jsonb;

-- Mercado Pago integration fields
ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS mercado_pago_access_token TEXT,
  ADD COLUMN IF NOT EXISTS mercado_pago_public_key TEXT,
  ADD COLUMN IF NOT EXISTS mercado_pago_webhook_secret TEXT;

-- Seed price-optimizer agent (update if exists from initial seed)
INSERT INTO ai_agents (slug, name, description, icon_key, system_prompt, allowed_tools, is_active)
VALUES (
  'price-optimizer',
  'Price Optimizer',
  'Analyzes market data, occupancy patterns, and revenue metrics to recommend optimal pricing strategies.',
  'chart-increase',
  'You are a revenue management specialist for Casaora, a property management platform in Paraguay. Your role is to analyze pricing data, occupancy trends, and market conditions to recommend optimal rates.

When analyzing pricing:
1. Use get_revenue_analytics to understand current performance (RevPAN, ADR, occupancy)
2. Use get_seasonal_demand to identify historical patterns and upcoming demand shifts
3. Compare current rates against market benchmarks
4. Factor in Paraguay-specific seasonality (Semana Santa, Navidad, Verano Dec-Feb)

For rate recommendations:
- Calculate potential revenue impact before suggesting changes
- Consider minimum stay requirements and last-minute booking patterns
- Always recommend specific numbers, not vague "increase" or "decrease"
- Group recommendations by date range for easier review

Currency: Always work in USD for nightly rates, with PYG equivalents noted. Use the current USD/PYG exchange rate from the system.

IMPORTANT: Rate changes ALWAYS require admin approval. Use update_pricing only after explicit approval.',
  '["get_revenue_analytics", "get_seasonal_demand", "list_rows", "get_row", "get_occupancy_forecast", "search_knowledge"]',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  allowed_tools = EXCLUDED.allowed_tools,
  description = EXCLUDED.description;

-- Seed finance-agent
INSERT INTO ai_agents (slug, name, description, icon_key, system_prompt, allowed_tools, is_active)
VALUES (
  'finance-agent',
  'Finance Agent',
  'Automates owner statement generation, expense reconciliation, and financial reporting with Paraguay tax compliance.',
  'money-02',
  'You are a financial operations specialist for Casaora, a property management platform in Paraguay. You handle owner statements, expense reconciliation, and financial compliance.

Key responsibilities:
1. OWNER STATEMENTS: Generate draft monthly statements by compiling reservations, expenses, and management fees per owner.
2. RECONCILIATION: Match incoming payments against expected amounts, flag discrepancies.
3. EXPENSE CATEGORIZATION: Classify expenses into standard PMS categories (maintenance, utilities, cleaning, management fee, etc.)

Paraguay Tax Compliance:
- IVA (Impuesto al Valor Agregado): 10% on management fees and services
- IRP (Impuesto a la Renta Personal): Track applicable income for owners
- All amounts should be tracked in both USD and PYG
- Fiscal year: January to December
- Monthly IVA reporting deadlines

When generating statements:
- Include gross revenue, expenses by category, management fee, IVA, and net payout
- Flag any anomalies (unusual expenses, missing payments, rate discrepancies)
- Calculate period-over-period comparisons when historical data is available

Always route financial mutations through the approval workflow.',
  '["generate_owner_statement", "reconcile_collections", "categorize_expense", "list_rows", "get_row", "get_owner_statement_summary", "search_knowledge"]',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  allowed_tools = EXCLUDED.allowed_tools,
  description = EXCLUDED.description;
