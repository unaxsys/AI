ALTER TABLE doc_templates
  ADD COLUMN IF NOT EXISTS agent_id int REFERENCES agents(id),
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS original_filename text;

UPDATE doc_templates dt
SET agent_id = a.id
FROM agents a
WHERE dt.agent_id IS NULL
  AND (
    (dt.template_type = 'offer' AND a.key = 'offers')
    OR (dt.template_type = 'contract' AND a.key = 'contracts')
  );


CREATE INDEX IF NOT EXISTS doc_templates_agent_type_active_idx
  ON doc_templates(agent_id, template_type, is_active, created_at DESC);
