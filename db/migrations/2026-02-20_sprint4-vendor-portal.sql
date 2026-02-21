-- Sprint 4: Vendor Portal
-- Vendor access tokens + reviews table + review-manager agent seed

-- ── Vendor access tokens ──
CREATE TABLE IF NOT EXISTS vendor_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name text NOT NULL,
  vendor_phone text,
  vendor_email text,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_tokens_hash ON vendor_access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_vendor_tokens_org ON vendor_access_tokens(organization_id);

ALTER TABLE vendor_access_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendor_tokens_org_isolation ON vendor_access_tokens
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

-- ── Reviews table ──
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  guest_name text,
  platform text NOT NULL DEFAULT 'direct',
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  response_text text,
  response_status text NOT NULL DEFAULT 'pending' CHECK (response_status IN ('pending', 'draft', 'published', 'skipped')),
  ai_suggested_response text,
  responded_at timestamptz,
  review_date timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_org ON reviews(organization_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reservation ON reviews(reservation_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(response_status);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_org_isolation ON reviews
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE TRIGGER set_reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ── Review-manager agent seed ──
INSERT INTO ai_agents (slug, name, description, icon_key, system_prompt, allowed_tools, is_active)
VALUES (
  'review-manager',
  'Review Manager',
  'Automated review solicitation and response generation',
  'star',
  'You are the Review Manager agent for a property management company in Paraguay. Your responsibilities:

1. REVIEW SOLICITATION: After guest checkout (24h delay), send a friendly review request via WhatsApp or email.
2. RESPONSE GENERATION: For incoming reviews, generate thoughtful, personalized responses.
3. SENTIMENT ANALYSIS: Identify negative trends and escalate to the team.

Response guidelines:
- Thank the guest by name
- Reference specific aspects of their stay when possible
- For positive reviews: reinforce the positives, invite them back
- For negative reviews: acknowledge concerns, apologize genuinely, offer to make it right
- Keep responses 2-4 sentences, professional but warm
- Default to Spanish for PY guests unless the review is in English

Available tools: search_knowledge, send_message, list_rows, get_row, recall_memory, store_memory',
  '["search_knowledge", "send_message", "list_rows", "get_row", "recall_memory", "store_memory"]'::jsonb,
  true
) ON CONFLICT (slug) DO NOTHING;
