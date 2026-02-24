ALTER TABLE ai_chat_messages
  ADD COLUMN IF NOT EXISTS feedback_reason text;
