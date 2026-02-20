CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin','user');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('draft','reviewed','approved');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE section_type AS ENUM (
    'analysis','service','pricing','proposal_draft','email_draft','upsell',
    'reply_short','reply_standard','reply_detailed','support_classification','support_reply',
    'marketing_copy','recruiting_jd','recruiting_reply','contract_summary','terms',
    'offer_intro','offer_scope','offer_terms'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE file_entity_type AS ENUM ('offer','contract');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE file_format AS ENUM ('docx','pdf');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  must_change_password boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS agents (
  id serial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS agent_prompt_versions (
  id bigserial PRIMARY KEY,
  agent_id int NOT NULL REFERENCES agents(id),
  version_no int NOT NULL,
  system_prompt_text text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id, version_no)
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id bigserial PRIMARY KEY,
  agent_id int NOT NULL REFERENCES agents(id),
  title text NOT NULL,
  content_text text NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id bigserial PRIMARY KEY,
  agent_id int NOT NULL REFERENCES agents(id),
  created_by uuid NOT NULL REFERENCES users(id),
  status task_status NOT NULL DEFAULT 'draft',
  input_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz
);

CREATE TABLE IF NOT EXISTS task_sections (
  id bigserial PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  section_type section_type NOT NULL,
  content_draft text,
  content_final text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, section_type)
);

CREATE TABLE IF NOT EXISTS pricing_versions (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pricing_services (
  id bigserial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pricing_service_prices (
  id bigserial PRIMARY KEY,
  service_id bigint NOT NULL REFERENCES pricing_services(id),
  pricing_version_id bigint NOT NULL REFERENCES pricing_versions(id),
  unit text NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  currency text NOT NULL,
  vat_mode text NOT NULL,
  valid_from date,
  valid_to date
);
CREATE TABLE IF NOT EXISTS pricing_rules (
  id bigserial PRIMARY KEY,
  pricing_version_id bigint NOT NULL REFERENCES pricing_versions(id),
  rule_name text NOT NULL,
  rule_text text NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_templates (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  template_type text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  docx_bytes bytea NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offers (
  id bigserial PRIMARY KEY,
  created_by uuid NOT NULL REFERENCES users(id),
  client_company text,
  client_name text,
  client_email text,
  lead_text text,
  currency text,
  vat_mode text,
  subtotal numeric(12,2),
  vat_amount numeric(12,2),
  total numeric(12,2),
  status task_status NOT NULL DEFAULT 'draft',
  pricing_version_id bigint REFERENCES pricing_versions(id),
  template_id bigint REFERENCES doc_templates(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz
);
CREATE TABLE IF NOT EXISTS offer_items (
  id bigserial PRIMARY KEY,
  offer_id bigint NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  service_id bigint REFERENCES pricing_services(id),
  description text NOT NULL,
  qty numeric(12,2) NOT NULL,
  unit text NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  line_total numeric(12,2) NOT NULL
);
CREATE TABLE IF NOT EXISTS offer_sections (
  id bigserial PRIMARY KEY,
  offer_id bigint NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  section_type section_type NOT NULL,
  content text NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id bigserial PRIMARY KEY,
  created_by uuid NOT NULL REFERENCES users(id),
  contract_type text NOT NULL,
  client_company text,
  client_name text,
  client_email text,
  status task_status NOT NULL DEFAULT 'draft',
  template_id bigint REFERENCES doc_templates(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz
);
CREATE TABLE IF NOT EXISTS contract_sections (
  id bigserial PRIMARY KEY,
  contract_id bigint NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  section_type section_type NOT NULL,
  content text NOT NULL
);

CREATE TABLE IF NOT EXISTS generated_files (
  id bigserial PRIMARY KEY,
  entity_type file_entity_type NOT NULL,
  entity_id bigint NOT NULL,
  format file_format NOT NULL,
  mime_type text NOT NULL,
  file_bytes bytea NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='agents' AND column_name='key'
  ) THEN
    INSERT INTO agents(code,key,name) VALUES
    ('email','email','Email Replies'),
    ('offers','offers','Offers'),
    ('contracts','contracts','Contracts'),
    ('support','support','Support'),
    ('marketing','marketing','Marketing'),
    ('recruiting','recruiting','Recruiting')
    ON CONFLICT (code) DO NOTHING;
  ELSE
    INSERT INTO agents(code,name) VALUES
    ('email','Email Replies'),('offers','Offers'),('contracts','Contracts'),('support','Support'),('marketing','Marketing'),('recruiting','Recruiting')
    ON CONFLICT (code) DO NOTHING;
  END IF;
END $$;
