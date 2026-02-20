DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agents' AND column_name='key'
  ) THEN
    INSERT INTO agents(code,key,name) VALUES
    ('escalations','escalations','Escalation Management'),
    ('sales','sales','Sales'),
    ('accounting','accounting','Accounting Issues'),
    ('tax','tax','Tax Issues'),
    ('cases','cases','Cases (NRA/Companies)'),
    ('procedures','procedures','Rules & Procedures')
    ON CONFLICT (code) DO NOTHING;
  ELSE
    INSERT INTO agents(code,name) VALUES
    ('escalations','Escalation Management'),
    ('sales','Sales'),
    ('accounting','Accounting Issues'),
    ('tax','Tax Issues'),
    ('cases','Cases (NRA/Companies)'),
    ('procedures','Rules & Procedures')
    ON CONFLICT (code) DO NOTHING;
  END IF;
END $$;
