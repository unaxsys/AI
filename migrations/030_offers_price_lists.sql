CREATE TABLE IF NOT EXISTS offers_price_lists (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'BGN',
  vat_percent numeric(6,2) NOT NULL DEFAULT 20,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offers_price_items (
  id bigserial PRIMARY KEY,
  price_list_id bigint NOT NULL REFERENCES offers_price_lists(id) ON DELETE CASCADE,
  service_key text NOT NULL,
  service_name text NOT NULL,
  unit text NOT NULL DEFAULT 'unit',
  tier_min numeric(12,2) NOT NULL DEFAULT 1,
  tier_max numeric(12,2),
  unit_price numeric(12,2) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offers_price_lists_active ON offers_price_lists(is_active);
CREATE INDEX IF NOT EXISTS idx_offers_price_items_list_key ON offers_price_items(price_list_id, service_key);
