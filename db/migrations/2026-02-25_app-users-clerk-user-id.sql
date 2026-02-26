-- Add Clerk identity linkage for gradual Supabase Auth -> Clerk migration.
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS clerk_user_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_users_clerk_user_id_key'
  ) THEN
    ALTER TABLE app_users
      ADD CONSTRAINT app_users_clerk_user_id_key UNIQUE (clerk_user_id);
  END IF;
END $$;

