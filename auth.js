const jwt = require('jsonwebtoken');
const { get } = require('./db');

const ROLE_LEVEL = {
  viewer: 1,
  agent: 2,
  manager: 3,
  admin: 4
};

function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      name: user.name
    },
    secret,
    { expiresIn: '12h' }
  );
}

async function requireAuth(req, res, next) {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required');
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = jwt.verify(token, secret);
    const user = await get('SELECT id, email, name, role, is_active FROM users WHERE id=?', [payload.sub]);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    return next();
  } catch (_err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if ((ROLE_LEVEL[req.user.role] || 0) < (ROLE_LEVEL[minRole] || 0)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = {
  ROLE_LEVEL,
  signToken,
  requireAuth,
  requireRole
};
