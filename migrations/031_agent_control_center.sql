ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS key text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE agents SET key = code WHERE key IS NULL;

UPDATE agents
SET key = CASE code
  WHEN 'email' THEN 'email_replies'
  WHEN 'offers' THEN 'offers'
  WHEN 'contracts' THEN 'contracts'
  WHEN 'support' THEN 'support'
  WHEN 'marketing' THEN 'marketing'
  WHEN 'recruiting' THEN 'recruiting'
  WHEN 'escalations' THEN 'escalations'
  WHEN 'sales' THEN 'sales'
  ELSE COALESCE(key, code)
END
WHERE key IS NULL OR key = code;

ALTER TABLE agents
  ALTER COLUMN key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agents_key_uidx ON agents(key);

INSERT INTO agents(code, key, name, description, is_enabled)
VALUES
('email', 'email_replies', 'Имейл отговори', 'Агент за отговори на клиентски имейли', true),
('offers', 'offers', 'Оферти', 'Агент за оферти и ценови предложения', true),
('contracts', 'contracts', 'Договори', 'Агент за договори и клаузи', true),
('support', 'support', 'Поддръжка', 'Агент за клиентска поддръжка', true),
('marketing', 'marketing', 'Маркетинг', 'Агент за маркетинг кампании', true),
('recruiting', 'recruiting', 'Подбор', 'Агент за подбор на кандидати', true),
('escalations', 'escalations', 'Управление на ескалации', 'Агент за ескалации и критични казуси', true),
('sales', 'sales', 'Продажби', 'Агент за продажбени комуникации', true)
ON CONFLICT (code) DO UPDATE
SET key = EXCLUDED.key,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_enabled = EXCLUDED.is_enabled;

CREATE TABLE IF NOT EXISTS agent_settings (
  agent_id int PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  model text NOT NULL DEFAULT 'gpt-4.1-mini',
  temperature numeric NOT NULL DEFAULT 0.3,
  max_tokens int NOT NULL DEFAULT 800,
  tools_enabled jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_prompts (
  id bigserial PRIMARY KEY,
  agent_id int NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('system','style','rules')),
  content text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_prompts_agent_type_idx ON agent_prompts(agent_id, type);
CREATE INDEX IF NOT EXISTS agent_prompts_agent_type_active_idx ON agent_prompts(agent_id, type, is_active);

CREATE TABLE IF NOT EXISTS agent_knowledge (
  id bigserial PRIMARY KEY,
  agent_id int NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  source text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_knowledge_agent_idx ON agent_knowledge(agent_id);
CREATE INDEX IF NOT EXISTS agent_knowledge_tags_gin_idx ON agent_knowledge USING GIN (tags);

CREATE TABLE IF NOT EXISTS agent_templates (
  id bigserial PRIMARY KEY,
  agent_id int NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_training_examples (
  id bigserial PRIMARY KEY,
  agent_id int NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  input_text text NOT NULL,
  output_text text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  rating int CHECK (rating >= 1 AND rating <= 5),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_audit (
  id bigserial PRIMARY KEY,
  agent_id int NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO agent_settings(agent_id)
SELECT id FROM agents
ON CONFLICT (agent_id) DO NOTHING;

INSERT INTO agent_prompts(agent_id, type, content, is_active, version)
SELECT apv.agent_id, 'system', apv.system_prompt_text, apv.is_active, apv.version_no
FROM agent_prompt_versions apv
LEFT JOIN agent_prompts ap ON ap.agent_id = apv.agent_id AND ap.type='system' AND ap.version = apv.version_no
WHERE ap.id IS NULL;

INSERT INTO agent_knowledge(agent_id, title, content, source, is_active)
SELECT kd.agent_id, kd.title, kd.content_text, kd.source, true
FROM knowledge_documents kd
LEFT JOIN agent_knowledge ak ON ak.agent_id = kd.agent_id AND ak.title = kd.title AND ak.content = kd.content_text
WHERE ak.id IS NULL;
