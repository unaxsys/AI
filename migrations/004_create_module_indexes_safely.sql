DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='prompts' AND column_name='module'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='prompts' AND column_name='language'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='prompts' AND column_name='is_active'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_prompts_module_language_active ON prompts(module, language, is_active);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='tasks' AND column_name='module'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='tasks' AND column_name='created_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_tasks_module_created_at ON tasks(module, created_at DESC);
  END IF;
END $$;
