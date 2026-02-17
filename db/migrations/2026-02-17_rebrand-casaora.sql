-- Migration: Rebrand Puerta Abierta → Casaora + new AI agents + guest portal
-- Date: 2026-02-17
-- Safe to run multiple times (idempotent).

-- ═══════════════════════════════════════════════════════
-- 1. Rebrand: update AI agent prompts
-- ═══════════════════════════════════════════════════════

UPDATE ai_agents
SET system_prompt = REPLACE(system_prompt, 'Puerta Abierta', 'Casaora'),
    updated_at = now()
WHERE system_prompt LIKE '%Puerta Abierta%';

-- ═══════════════════════════════════════════════════════
-- 2. New AI Agents: GuestConcierge + OwnerInsight
-- ═══════════════════════════════════════════════════════

INSERT INTO ai_agents (slug, name, description, icon_key, system_prompt, allowed_tools, is_active)
VALUES
  (
    'guest-concierge',
    'Guest Concierge',
    'Bilingual guest communication assistant for reservations, upsells, and urgent issue triage.',
    'Message01Icon',
    'You are Guest Concierge for Casaora, a short-term rental platform in Paraguay. Help operators draft bilingual (Spanish/English) guest messages. Look up reservation and property details to personalize responses. Suggest upsells like early check-in or late check-out when appropriate. Flag urgent issues (lockouts, safety, no-shows) for immediate human attention. Keep messages warm, professional, and concise.',
    '["list_tables", "get_org_snapshot", "list_rows", "get_row", "create_row", "update_row"]'::jsonb,
    true
  ),
  (
    'owner-insight',
    'Owner Insight',
    'Read-only financial analyst for owner statements, revenue trends, and expense anomaly detection.',
    'Invoice03Icon',
    'You are Owner Insight for Casaora, a short-term rental platform in Paraguay. Summarize owner statements and compare revenue across properties. Detect expense anomalies and unusual patterns. Forecast expected revenue from confirmed reservations. Present numbers clearly with currency formatting (PYG uses dots as thousands separator, e.g. ₲1.500.000). You have read-only access — never attempt to create or modify data.',
    '["list_tables", "get_org_snapshot", "list_rows", "get_row"]'::jsonb,
    true
  )
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon_key = EXCLUDED.icon_key,
  system_prompt = EXCLUDED.system_prompt,
  allowed_tools = EXCLUDED.allowed_tools,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- ═══════════════════════════════════════════════════════
-- 3. Guest Portal: access tokens table
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS guest_access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  email citext,
  phone_e164 text,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_access_tokens_reservation
  ON guest_access_tokens(reservation_id);

CREATE INDEX IF NOT EXISTS idx_guest_access_tokens_guest
  ON guest_access_tokens(guest_id);

CREATE INDEX IF NOT EXISTS idx_guest_access_tokens_hash
  ON guest_access_tokens(token_hash);

ALTER TABLE guest_access_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guest_access_tokens_updated_at') THEN
    CREATE TRIGGER trg_guest_access_tokens_updated_at
      BEFORE UPDATE ON guest_access_tokens
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
