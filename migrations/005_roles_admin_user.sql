UPDATE users
SET role = 'user', updated_at = NOW()
WHERE role IN ('viewer', 'agent', 'manager');

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','user'));
