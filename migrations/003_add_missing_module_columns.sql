ALTER TABLE prompts
  ADD COLUMN IF NOT EXISTS module TEXT;

UPDATE prompts
SET module = 'offers'
WHERE module IS NULL;

ALTER TABLE prompts
  ALTER COLUMN module SET NOT NULL;

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS module TEXT;

UPDATE templates
SET module = 'offers'
WHERE module IS NULL;

ALTER TABLE templates
  ALTER COLUMN module SET NOT NULL;

ALTER TABLE pricing_rules
  ADD COLUMN IF NOT EXISTS module TEXT;

UPDATE pricing_rules
SET module = 'offers'
WHERE module IS NULL;

ALTER TABLE pricing_rules
  ALTER COLUMN module SET NOT NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS module TEXT;

UPDATE tasks
SET module = 'offers'
WHERE module IS NULL;

ALTER TABLE tasks
  ALTER COLUMN module SET NOT NULL;
