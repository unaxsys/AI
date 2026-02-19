require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const OpenAI = require('openai');
const multer = require('multer');
const { execFile } = require('child_process');
const { promisify } = require('util');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 8789);
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
const DEFAULT_ADMIN_EMAIL = 'ogi.stoev80@gmail.com';
const DEFAULT_ADMIN_PASSWORD = '12345678';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.json({ limit: '1mb' }));
app.use('/public', express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email, name: user.display_name }, JWT_SECRET, { expiresIn: '8h' });
}

async function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1 AND is_active=true', [payload.sub]);
    if (!rows[0]) return res.status(401).json({ error: 'Unauthorized' });
    req.user = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function requirePasswordUpdated(req, res, next) {
  if (req.user.must_change_password) {
    return res.status(403).json({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

async function seedAdmin() {
  const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  const { rows } = await pool.query('SELECT id FROM users WHERE email=$1', [DEFAULT_ADMIN_EMAIL]);
  if (!rows[0]) {
    await pool.query(
      'INSERT INTO users(email, display_name, password_hash, role, is_active, must_change_password) VALUES ($1,$2,$3,$4,true,true)',
      [DEFAULT_ADMIN_EMAIL, 'Ogi Stoev', hash, 'admin']
    );
    return;
  }

  await pool.query(
    'UPDATE users SET password_hash=$1, role=$2, is_active=true, must_change_password=true, updated_at=now() WHERE email=$3',
    [hash, 'admin', DEFAULT_ADMIN_EMAIL]
  );
}

async function runMigrations() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '001_init.sql'), 'utf8');
  await pool.query(sql);
  await pool.query("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager'");
}

async function getActivePrompt(agentId) {
  const { rows } = await pool.query('SELECT system_prompt_text FROM agent_prompt_versions WHERE agent_id=$1 AND is_active=true ORDER BY version_no DESC LIMIT 1', [agentId]);
  return rows[0]?.system_prompt_text || 'You are a practical business assistant. Return concise Bulgarian text with section labels.';
}

async function buildKnowledge(agentId) {
  const { rows } = await pool.query('SELECT title, content_text FROM knowledge_documents WHERE agent_id=$1 ORDER BY id DESC LIMIT 5', [agentId]);
  return rows.map((r) => `# ${r.title}\n${r.content_text}`).join('\n\n');
}

function sectionsForAgent(code) {
  const map = {
    email: ['reply_short', 'reply_standard', 'reply_detailed'],
    support: ['support_classification', 'support_reply'],
    marketing: ['analysis', 'marketing_copy', 'upsell'],
    recruiting: ['analysis', 'recruiting_jd', 'recruiting_reply'],
    offers: ['analysis', 'service', 'pricing', 'proposal_draft', 'email_draft', 'upsell'],
    contracts: ['contract_summary', 'terms']
  };
  return map[code] || ['analysis'];
}

function parseLabeledSections(text, sectionTypes) {
  const out = {};
  sectionTypes.forEach((s) => { out[s] = ''; });
  let current = sectionTypes[0];
  text.split('\n').forEach((line) => {
    const match = sectionTypes.find((s) => line.toLowerCase().startsWith(`${s}:`));
    if (match) {
      current = match;
      out[current] += line.slice(match.length + 1).trim() + '\n';
    } else {
      out[current] += line + '\n';
    }
  });
  return out;
}

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  const user = rows[0];
  if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  await pool.query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  res.json({
    token: signToken(user),
    user: {
      id: user.id,
      role: user.role,
      email: user.email,
      displayName: user.display_name,
      mustChangePassword: user.must_change_password
    }
  });
});

app.get('/api/auth/me', auth, async (req, res) => {
  res.json({
    id: req.user.id,
    role: req.user.role,
    email: req.user.email,
    displayName: req.user.display_name,
    mustChangePassword: req.user.must_change_password
  });
});

app.post('/api/profile/change-password', auth, async (req, res) => {
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 chars' });
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash=$1, must_change_password=false, updated_at=now() WHERE id=$2', [hash, req.user.id]);
  res.json({ ok: true });
});

app.get('/api/agents', auth, requirePasswordUpdated, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM agents WHERE is_enabled=true ORDER BY id');
  res.json(rows);
});

app.post('/api/tasks', auth, requirePasswordUpdated, async (req, res) => {
  const { agentId, inputText } = req.body;
  const text = String(inputText || '').trim();
  if (!text || text.length > 8000) return res.status(400).json({ error: 'Invalid input' });
  const r = await pool.query('INSERT INTO tasks(agent_id, created_by, input_text, status) VALUES ($1,$2,$3,$4) RETURNING *', [agentId, req.user.id, text, 'draft']);
  res.status(201).json(r.rows[0]);
});

app.get('/api/tasks', auth, requirePasswordUpdated, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const agentId = req.query.agentId;
  const params = [req.user.id];
  let sql = 'SELECT t.*, a.code agent_code FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.created_by=$1';
  if (agentId) { params.push(agentId); sql += ` AND t.agent_id=$${params.length}`; }
  if (q) { params.push(`%${q}%`); sql += ` AND t.input_text ILIKE $${params.length}`; }
  sql += ' ORDER BY t.updated_at DESC LIMIT 100';
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

app.get('/api/tasks/:id', auth, requirePasswordUpdated, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id=$1 AND created_by=$2', [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  const sections = await pool.query('SELECT * FROM task_sections WHERE task_id=$1 ORDER BY id', [req.params.id]);
  res.json({ task: rows[0], sections: sections.rows });
});

app.post('/api/tasks/:id/generate', auth, requirePasswordUpdated, async (req, res) => {
  const taskId = req.params.id;
  const t = await pool.query('SELECT t.*, a.code FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.id=$1 AND t.created_by=$2', [taskId, req.user.id]);
  const task = t.rows[0];
  if (!task) return res.status(404).json({ error: 'Not found' });

  const prompt = await getActivePrompt(task.agent_id);
  const knowledge = await buildKnowledge(task.agent_id);
  const sectionTypes = sectionsForAgent(task.code);
  const instructions = `Return plain text. Use lines starting with exact labels: ${sectionTypes.map((s) => `${s}:`).join(', ')}.`;

  const result = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: `${prompt}\n\nKnowledge:\n${knowledge || 'No knowledge configured.'}` },
      { role: 'user', content: `${instructions}\n\nInput:\n${task.input_text}` }
    ]
  });

  const text = result.choices?.[0]?.message?.content || '';
  const parsed = parseLabeledSections(text, sectionTypes);
  for (const s of sectionTypes) {
    await pool.query(
      `INSERT INTO task_sections(task_id, section_type, content_draft, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT(task_id, section_type) DO UPDATE SET content_draft=EXCLUDED.content_draft, updated_at=now()`,
      [taskId, s, parsed[s]?.trim() || '']
    );
  }
  await pool.query('UPDATE tasks SET updated_at=now(), status=$2 WHERE id=$1', [taskId, 'reviewed']);
  const sections = await pool.query('SELECT * FROM task_sections WHERE task_id=$1 ORDER BY id', [taskId]);
  res.json({ sections: sections.rows });
});

app.patch('/api/tasks/:id/sections', auth, requirePasswordUpdated, async (req, res) => {
  const updates = Array.isArray(req.body.sections) ? req.body.sections : [];
  for (const row of updates) {
    await pool.query('UPDATE task_sections SET content_final=$1, updated_at=now() WHERE task_id=$2 AND section_type=$3', [String(row.contentFinal || ''), req.params.id, row.sectionType]);
  }
  await pool.query('UPDATE tasks SET updated_at=now() WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/approve', auth, requirePasswordUpdated, async (req, res) => {
  await pool.query('UPDATE tasks SET status=$2, approved_by=$3, approved_at=now(), updated_at=now() WHERE id=$1 AND created_by=$3', [req.params.id, 'approved', req.user.id]);
  res.json({ ok: true });
});

app.post('/api/offers', auth, requirePasswordUpdated, async (req, res) => {
  const { clientCompany, clientName, clientEmail, leadText, currency = 'BGN', vatMode = 'standard' } = req.body;
  const activePricing = await pool.query('SELECT * FROM pricing_versions WHERE is_active=true ORDER BY id DESC LIMIT 1');
  const offer = await pool.query(
    'INSERT INTO offers(created_by,client_company,client_name,client_email,lead_text,currency,vat_mode,status,pricing_version_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [req.user.id, clientCompany, clientName, clientEmail, leadText, currency, vatMode, 'draft', activePricing.rows[0]?.id || null]
  );
  const pricingText = activePricing.rows[0] ? 'Ценообразуването ще се изчисли автоматично.' : 'TBD / requires admin pricing setup';
  await pool.query('INSERT INTO offer_sections(offer_id, section_type, content) VALUES ($1,$2,$3),($1,$4,$5)', [offer.rows[0].id, 'offer_intro', 'Проектна оферта.', 'pricing', pricingText]);
  res.status(201).json({ offer: offer.rows[0], pricingConfigured: Boolean(activePricing.rows[0]) });
});

app.post('/api/contracts', auth, requirePasswordUpdated, async (req, res) => {
  const { contractType, clientCompany, clientName, clientEmail } = req.body;
  const r = await pool.query('INSERT INTO contracts(created_by,contract_type,client_company,client_name,client_email,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.user.id, contractType || 'general', clientCompany, clientName, clientEmail, 'draft']);
  await pool.query('INSERT INTO contract_sections(contract_id, section_type, content) VALUES ($1,$2,$3)', [r.rows[0].id, 'contract_summary', 'Contract scaffold ready.']);
  res.status(201).json(r.rows[0]);
});

app.get('/api/admin/users', auth, requirePasswordUpdated, adminOnly, async (_req, res) => {
  const { rows } = await pool.query('SELECT id,email,display_name,role,is_active,created_at,last_login_at,must_change_password FROM users ORDER BY created_at DESC');
  res.json({
    ok: true,
    users: rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      isActive: row.is_active,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      mustChangePassword: row.must_change_password
    }))
  });
});

app.post('/api/admin/users', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  const gender = String(req.body.gender || '').trim().toLowerCase();
  const role = String(req.body.role || 'user').trim().toLowerCase();
  const displayName = String(req.body.displayName || `${firstName} ${lastName}`).trim();

  if (!email || !firstName || !lastName || !gender || !displayName) {
    return res.status(400).json({ ok: false, message: 'Missing required fields' });
  }

  if (!['admin', 'manager', 'user'].includes(role)) {
    return res.status(400).json({ ok: false, message: 'Invalid role' });
  }

  if (!['male', 'female', 'other'].includes(gender)) {
    return res.status(400).json({ ok: false, message: 'Invalid gender' });
  }

  const tempPassword = String(req.body.password || '').trim() || Math.random().toString(36).slice(-10) + 'A!';
  const hash = await bcrypt.hash(tempPassword, 10);

  const { rows } = await pool.query(
    'INSERT INTO users(email,display_name,password_hash,role,is_active,must_change_password) VALUES($1,$2,$3,$4,true,true) RETURNING id,email,display_name,role,is_active,created_at,must_change_password',
    [email, displayName, hash, role]
  );

  return res.status(201).json({
    ok: true,
    user: {
      id: rows[0].id,
      email: rows[0].email,
      displayName: rows[0].display_name,
      role: rows[0].role,
      isActive: rows[0].is_active,
      createdAt: rows[0].created_at,
      mustChangePassword: rows[0].must_change_password
    },
    tempPassword
  });
});

app.patch('/api/admin/users/:id', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  await pool.query('UPDATE users SET role=COALESCE($1,role), is_active=COALESCE($2,is_active), must_change_password=COALESCE($3,must_change_password), updated_at=now() WHERE id=$4', [req.body.role, req.body.isActive, req.body.mustChangePassword, req.params.id]);
  if (req.body.newPassword) {
    const hash = await bcrypt.hash(String(req.body.newPassword), 10);
    await pool.query('UPDATE users SET password_hash=$1, must_change_password=true, updated_at=now() WHERE id=$2', [hash, req.params.id]);
  }
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/reset-password', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const tempPassword = Math.random().toString(36).slice(-10) + 'A!';
  const hash = await bcrypt.hash(tempPassword, 10);
  const { rowCount } = await pool.query('UPDATE users SET password_hash=$1, must_change_password=true, updated_at=now() WHERE id=$2', [hash, req.params.id]);
  if (!rowCount) return res.status(404).json({ ok: false, message: 'User not found' });
  return res.json({ ok: true, tempPassword });
});

app.get('/api/admin/prompts', auth, requirePasswordUpdated, adminOnly, async (_req, res) => {
  const { rows } = await pool.query('SELECT apv.*, a.code agent_code FROM agent_prompt_versions apv JOIN agents a ON a.id=apv.agent_id ORDER BY apv.created_at DESC LIMIT 200');
  res.json(rows);
});

app.post('/api/admin/prompts', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const v = await pool.query('SELECT COALESCE(MAX(version_no),0)+1 n FROM agent_prompt_versions WHERE agent_id=$1', [req.body.agentId]);
  if (req.body.isActive) await pool.query('UPDATE agent_prompt_versions SET is_active=false WHERE agent_id=$1', [req.body.agentId]);
  const { rows } = await pool.query('INSERT INTO agent_prompt_versions(agent_id,version_no,system_prompt_text,is_active) VALUES ($1,$2,$3,$4) RETURNING *', [req.body.agentId, v.rows[0].n, req.body.systemPromptText, Boolean(req.body.isActive)]);
  res.status(201).json(rows[0]);
});

app.get('/api/admin/knowledge', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM knowledge_documents WHERE agent_id=$1 ORDER BY created_at DESC', [req.query.agentId]);
  res.json(rows);
});

app.post('/api/admin/knowledge', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const { rows } = await pool.query('INSERT INTO knowledge_documents(agent_id,title,content_text,source) VALUES($1,$2,$3,$4) RETURNING *', [req.body.agentId, req.body.title, req.body.contentText, req.body.source]);
  res.status(201).json(rows[0]);
});

app.post('/api/admin/templates', auth, requirePasswordUpdated, adminOnly, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required' });
  if (req.body.isActive === 'true') await pool.query('UPDATE doc_templates SET is_active=false WHERE template_type=$1', [req.body.templateType]);
  const { rows } = await pool.query('INSERT INTO doc_templates(name,template_type,is_active,docx_bytes,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,name,template_type,is_active,created_at', [req.body.name, req.body.templateType, req.body.isActive === 'true', req.file.buffer, req.user.id]);
  res.status(201).json(rows[0]);
});

app.get('/api/admin/pricing', auth, requirePasswordUpdated, adminOnly, async (_req, res) => {
  const versions = await pool.query('SELECT * FROM pricing_versions ORDER BY created_at DESC');
  const services = await pool.query('SELECT * FROM pricing_services ORDER BY created_at DESC');
  res.json({ versions: versions.rows, services: services.rows });
});

app.post('/api/admin/pricing/versions', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  if (req.body.isActive) await pool.query('UPDATE pricing_versions SET is_active=false');
  const { rows } = await pool.query('INSERT INTO pricing_versions(name,is_active) VALUES($1,$2) RETURNING *', [req.body.name, Boolean(req.body.isActive)]);
  res.status(201).json(rows[0]);
});

async function storeGenerated(entityType, entityId, format, mimeType, bytes, userId) {
  const { rows } = await pool.query('INSERT INTO generated_files(entity_type,entity_id,format,mime_type,file_bytes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [entityType, entityId, format, mimeType, bytes, userId]);
  return rows[0].id;
}

async function generateDocxStub(entityType, entityId) {
  return Buffer.from(`ANAGAMI ${entityType.toUpperCase()} #${entityId}`);
}

async function convertToPdf(docxBuffer) {
  const base = `/tmp/anagami_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const input = `${base}.docx`;
  const outDir = '/tmp';
  const outPdf = `${base}.pdf`;
  await fs.promises.writeFile(input, docxBuffer);
  try {
    await execFileAsync('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, input]);
    return await fs.promises.readFile(outPdf);
  } finally {
    fs.promises.unlink(input).catch(() => {});
    fs.promises.unlink(outPdf).catch(() => {});
  }
}

app.post('/api/offers/:id/export', auth, requirePasswordUpdated, async (req, res) => {
  const format = req.query.format === 'pdf' ? 'pdf' : 'docx';
  const docx = await generateDocxStub('offer', req.params.id);
  let bytes = docx;
  let mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (format === 'pdf') {
    bytes = await convertToPdf(docx);
    mime = 'application/pdf';
  }
  const fileId = await storeGenerated('offer', req.params.id, format, mime, bytes, req.user.id);
  res.json({ fileId, downloadUrl: `/api/files/${fileId}/download` });
});

app.post('/api/contracts/:id/export', auth, requirePasswordUpdated, async (req, res) => {
  const format = req.query.format === 'pdf' ? 'pdf' : 'docx';
  const docx = await generateDocxStub('contract', req.params.id);
  let bytes = docx;
  let mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (format === 'pdf') {
    bytes = await convertToPdf(docx);
    mime = 'application/pdf';
  }
  const fileId = await storeGenerated('contract', req.params.id, format, mime, bytes, req.user.id);
  res.json({ fileId, downloadUrl: `/api/files/${fileId}/download` });
});

app.get('/api/files/:id/download', auth, requirePasswordUpdated, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM generated_files WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', rows[0].mime_type);
  res.setHeader('Content-Disposition', `attachment; filename=file_${rows[0].id}.${rows[0].format}`);
  res.send(rows[0].file_bytes);
});

app.get('/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});

(async () => {
  await runMigrations();
  await seedAdmin();
  app.listen(PORT, () => console.log(`Anagami AI Core listening on :${PORT}`));
})();
