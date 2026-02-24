-- P1: Close the guest reply delivery loop
-- Adds delivery tracking on message_logs + agent_approvals, feedback on ai_chat_messages

ALTER TABLE message_logs
  ADD COLUMN IF NOT EXISTS idempotency_key text UNIQUE,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

ALTER TABLE agent_approvals
  ADD COLUMN IF NOT EXISTS delivery_status text CHECK (delivery_status IN ('pending','sent','delivered','failed')),
  ADD COLUMN IF NOT EXISTS delivery_message_log_id uuid REFERENCES message_logs(id) ON DELETE SET NULL;

ALTER TABLE ai_chat_messages
  ADD COLUMN IF NOT EXISTS feedback_rating text CHECK (feedback_rating IN ('positive','negative')),
  ADD COLUMN IF NOT EXISTS feedback_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_agent_approvals_delivery_msg
  ON agent_approvals (delivery_message_log_id)
  WHERE delivery_message_log_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_feedback
  ON ai_chat_messages (feedback_rating)
  WHERE feedback_rating IS NOT NULL;
