CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS prompts DROP CONSTRAINT IF EXISTS prompts_created_by_fkey;
ALTER TABLE IF EXISTS knowledge_snippets DROP CONSTRAINT IF EXISTS knowledge_snippets_created_by_fkey;
ALTER TABLE IF EXISTS templates DROP CONSTRAINT IF EXISTS templates_created_by_fkey;
ALTER TABLE IF EXISTS pricing_rules DROP CONSTRAINT IF EXISTS pricing_rules_created_by_fkey;
ALTER TABLE IF EXISTS tasks DROP CONSTRAINT IF EXISTS tasks_created_by_fkey;
ALTER TABLE IF EXISTS tasks DROP CONSTRAINT IF EXISTS tasks_approved_by_fkey;
ALTER TABLE IF EXISTS usage_logs DROP CONSTRAINT IF EXISTS usage_logs_user_id_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'id' AND data_type <> 'uuid'
  ) THEN
    RAISE EXCEPTION 'users.id must remain UUID. Found non-UUID users.id type.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prompts' AND column_name = 'created_by' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE prompts
      ALTER COLUMN created_by TYPE UUID
      USING CASE
        WHEN created_by IS NULL THEN NULL
        WHEN created_by::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN created_by::text::uuid
        ELSE NULL
      END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'knowledge_snippets' AND column_name = 'created_by' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE knowledge_snippets
      ALTER COLUMN created_by TYPE UUID
      USING CASE
        WHEN created_by IS NULL THEN NULL
        WHEN created_by::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN created_by::text::uuid
        ELSE NULL
      END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'templates' AND column_name = 'created_by' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE templates
      ALTER COLUMN created_by TYPE UUID
      USING CASE
        WHEN created_by IS NULL THEN NULL
        WHEN created_by::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN created_by::text::uuid
        ELSE NULL
      END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pricing_rules' AND column_name = 'created_by' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE pricing_rules
      ALTER COLUMN created_by TYPE UUID
      USING CASE
        WHEN created_by IS NULL THEN NULL
        WHEN created_by::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN created_by::text::uuid
        ELSE NULL
      END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'created_by' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE tasks
      ALTER COLUMN created_by TYPE UUID
      USING CASE
        WHEN created_by IS NULL THEN NULL
        WHEN created_by::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN created_by::text::uuid
        ELSE NULL
      END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'approved_by' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE tasks
      ALTER COLUMN approved_by TYPE UUID
      USING CASE
        WHEN approved_by IS NULL THEN NULL
        WHEN approved_by::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN approved_by::text::uuid
        ELSE NULL
      END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usage_logs' AND column_name = 'user_id' AND data_type <> 'uuid'
  ) THEN
    ALTER TABLE usage_logs
      ALTER COLUMN user_id TYPE UUID
      USING CASE
        WHEN user_id IS NULL THEN NULL
        WHEN user_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN user_id::text::uuid
        ELSE NULL
      END;
  END IF;
END $$;

ALTER TABLE prompts
  ADD CONSTRAINT prompts_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE knowledge_snippets
  ADD CONSTRAINT knowledge_snippets_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE templates
  ADD CONSTRAINT templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE pricing_rules
  ADD CONSTRAINT pricing_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE usage_logs
  ADD CONSTRAINT usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
