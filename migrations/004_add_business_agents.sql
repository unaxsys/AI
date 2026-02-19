INSERT INTO agents(code,name) VALUES
('escalations','Escalation Management'),
('sales','Sales'),
('accounting','Accounting Issues'),
('tax','Tax Issues'),
('cases','Cases (NRA/Companies)'),
('procedures','Rules & Procedures')
ON CONFLICT (code) DO NOTHING;
