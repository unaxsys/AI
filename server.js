require('dotenv').config({ override: true });
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
    await pool.query('UPDATE users SET last_seen_at=now() WHERE id=$1', [rows[0].id]);
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
  const { rows } = await pool.query('SELECT id FROM users WHERE email=$1', [DEFAULT_ADMIN_EMAIL]);
  if (rows[0]) return;

  const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  await pool.query(
    `INSERT INTO users(email, display_name, password_hash, role, is_active, must_change_password)
     VALUES ($1,$2,$3,$4,true,true)`,
    [DEFAULT_ADMIN_EMAIL, 'Ogi Stoev', hash, 'admin']
  );
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // eslint-disable-next-line no-await-in-loop
    await pool.query(sql);
  }
  await pool.query("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager'");
}

const SAFE_DEFAULT_PROMPT = 'You are a practical business assistant. Return concise Bulgarian text with section labels and clear structure.';

function badRequest(res, message) {
  return res.status(400).json({ ok: false, message });
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

function validateTextField(value, fieldName, maxLen) {
  const text = String(value || '').trim();
  if (!text) return { ok: false, message: `${fieldName} is required` };
  if (text.length > maxLen) return { ok: false, message: `${fieldName} exceeds ${maxLen} characters` };
  return { ok: true, value: text };
}

async function writeAgentAudit(agentId, userId, action, payload = {}) {
  await pool.query(
    'INSERT INTO agent_audit(agent_id,user_id,action,payload) VALUES($1,$2,$3,$4)',
    [agentId, userId || null, action, payload || {}]
  );
}

async function resolveAgentByKey(agentKey) {
  const key = String(agentKey || '').trim();
  if (!key) return null;
  const { rows } = await pool.query('SELECT * FROM agents WHERE key=$1 OR code=$1 LIMIT 1', [key]);
  return rows[0] || null;
}

async function loadAgentContext(agentKey) {
  const agent = await resolveAgentByKey(agentKey);
  if (!agent) throw new Error('Agent not found');

  const [promptsResult, settingsResult, knowledgeResult, examplesResult] = await Promise.all([
    pool.query(
      `SELECT id,type,content,version,is_active
       FROM agent_prompts
       WHERE agent_id=$1 AND is_active=true
       ORDER BY version DESC, created_at DESC`,
      [agent.id]
    ),
    pool.query('SELECT * FROM agent_settings WHERE agent_id=$1', [agent.id]),
    pool.query('SELECT id,title,content,source,tags FROM agent_knowledge WHERE agent_id=$1 AND is_active=true ORDER BY created_at DESC LIMIT 20', [agent.id]),
    pool.query(`SELECT id,input_text,output_text,rating,notes,created_at
                FROM agent_training_examples
                WHERE agent_id=$1 AND status='approved'
                ORDER BY created_at DESC
                LIMIT 5`, [agent.id])
  ]);

  const prompts = promptsResult.rows;
  const systemPrompt = prompts.find((p) => p.type === 'system')?.content || SAFE_DEFAULT_PROMPT;
  const stylePrompt = prompts.find((p) => p.type === 'style')?.content || '';
  const rulesPrompt = prompts.find((p) => p.type === 'rules')?.content || '';

  return {
    agent,
    systemPrompt,
    stylePrompt,
    rulesPrompt,
    knowledgeItems: knowledgeResult.rows,
    examples: examplesResult.rows,
    settings: settingsResult.rows[0] || {
      model: 'gpt-4.1-mini',
      temperature: 0.3,
      max_tokens: 800,
      tools_enabled: {}
    },
    activePromptMeta: prompts.map((p) => ({ id: p.id, type: p.type, version: p.version }))
  };
}

function formatContextForUser(context, inputText) {
  const knowledge = context.knowledgeItems.length
    ? context.knowledgeItems.map((row) => `- ${row.title}: ${row.content}`).join('\n')
    : '- Няма добавени знания.';
  const examples = context.examples.length
    ? context.examples.map((row, index) => `${index + 1}) Input: ${row.input_text}\nOutput: ${row.output_text}`).join('\n\n')
    : 'Няма одобрени примери.';

  return [
    'Вход от потребител:',
    inputText,
    '',
    'Контекстни знания:',
    knowledge,
    '',
    'Одобрени примери:',
    examples
  ].join('\n');
}

async function getActivePriceList() {
  const { rows } = await pool.query('SELECT * FROM offers_price_lists WHERE is_active=true ORDER BY id DESC LIMIT 1');
  return rows[0] || null;
}

function pickTier(items, qty) {
  const targetQty = Number(qty || 1);
  return items.find((item) => {
    const min = Number(item.tier_min || 0);
    const max = item.tier_max == null ? null : Number(item.tier_max);
    if (targetQty < min) return false;
    if (max == null) return true;
    return targetQty <= max;
  }) || null;
}

async function computeOfferPricing({ currency = 'BGN', vatMode = 'standard', items = [] }) {
  const activePriceList = await getActivePriceList();
  if (!activePriceList) {
    return {
      pricingConfigured: false,
      subtotal: null,
      vatAmount: null,
      total: null,
      breakdown: 'TBD / requires admin pricing setup',
      resolvedItems: []
    };
  }

  const { rows } = await pool.query(
    `SELECT *
     FROM offers_price_items
     WHERE price_list_id=$1 AND is_active=true
     ORDER BY service_key ASC, tier_min ASC, id ASC`,
    [activePriceList.id]
  );

  const grouped = rows.reduce((acc, row) => {
    const key = row.service_key;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const resolvedItems = items.map((item, idx) => {
    const serviceKey = String(item.serviceKey || '').trim();
    const qty = Number(item.qty || 1) || 1;
    const tiers = grouped[serviceKey] || [];
    const tier = pickTier(tiers, qty);
    const unitPrice = tier ? Number(tier.unit_price) : 0;
    const lineTotal = Number((qty * unitPrice).toFixed(2));
    return {
      lineNo: idx + 1,
      serviceKey,
      description: String(item.description || tier?.service_name || serviceKey || 'Service').trim(),
      qty,
      unit: String(item.unit || tier?.unit || 'unit').trim(),
      unitPrice,
      lineTotal,
      matched: Boolean(tier)
    };
  });

  const subtotal = Number(resolvedItems.reduce((acc, row) => acc + row.lineTotal, 0).toFixed(2));
  const vatPercent = vatMode === 'none' ? 0 : Number(activePriceList.vat_percent || 20);
  const vatAmount = Number((subtotal * (vatPercent / 100)).toFixed(2));
  const total = Number((subtotal + vatAmount).toFixed(2));
  const outCurrency = String(currency || activePriceList.currency || 'BGN').toUpperCase();
  const lines = resolvedItems.map((row) => `- ${row.description}: ${row.qty} x ${row.unitPrice.toFixed(2)} ${outCurrency} = ${row.lineTotal.toFixed(2)} ${outCurrency}`);
  const breakdown = [
    `Ценоразпис: ${activePriceList.name}`,
    ...lines,
    `Междинна сума: ${subtotal.toFixed(2)} ${outCurrency}`,
    `ДДС (${vatPercent}%): ${vatAmount.toFixed(2)} ${outCurrency}`,
    `Крайна сума: ${total.toFixed(2)} ${outCurrency}`
  ].join('\n');

  return {
    pricingConfigured: true,
    priceListId: activePriceList.id,
    subtotal,
    vatAmount,
    total,
    breakdown,
    resolvedItems
  };
}


function buildTaskExportText(task, sections) {
  const header = [
    `Task #${task.id}`,
    `Status: ${task.status}`,
    `Created: ${task.created_at ? new Date(task.created_at).toISOString() : ''}`,
    '',
    'Input:',
    String(task.input_text || '').trim(),
    '',
    'Output:'
  ];
  const output = sections.map((row, index) => {
    const title = String(row.section_type || `section_${index + 1}`).replace(/_/g, ' ').toUpperCase();
    return `${index + 1}. ${title}\n${String(row.content || '').trim()}`;
  });
  return [...header, ...output].join('\n').trim() + '\n';
}

function generateSimplePdfBuffer(text) {
  const safe = String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r/g, '');
  const lines = safe.split('\n').map((line) => line.slice(0, 110));
  const content = ['BT', '/F1 11 Tf', '40 800 Td'];
  lines.forEach((line, idx) => {
    if (idx > 0) content.push('0 -16 Td');
    content.push(`(${line || ' '}) Tj`);
  });
  content.push('ET');
  const streamContent = content.join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(streamContent, 'utf8')} >> stream\n${streamContent}\nendstream endobj`
  ];
  let pdf = '%PDF-1.4\n';
  const xref = [0];
  objects.forEach((obj) => {
    xref.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${obj}\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  xref.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

async function getActiveDocTemplate(agentId, templateType) {
  const { rows } = await pool.query(
    `SELECT id, name, template_type, docx_bytes, mime_type, original_filename
     FROM doc_templates
     WHERE agent_id=$1 AND template_type=$2 AND is_active=true
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [agentId, templateType]
  );
  return rows[0] || null;
}

function sectionsForAgent(code) {
  const map = {
    email: ['reply_short', 'reply_standard', 'reply_detailed'],
    support: ['support_classification', 'support_reply'],
    marketing: ['analysis', 'marketing_copy', 'upsell'],
    recruiting: ['analysis', 'recruiting_jd', 'recruiting_reply'],
    offers: ['analysis', 'service', 'pricing', 'proposal_draft', 'email_draft', 'upsell'],
    contracts: ['contract_summary', 'terms'],
    escalations: ['analysis', 'support_classification', 'support_reply'],
    sales: ['analysis', 'service', 'pricing', 'email_draft', 'upsell'],
    accounting: ['analysis', 'support_reply', 'terms'],
    tax: ['analysis', 'support_reply', 'terms'],
    cases: ['analysis', 'terms', 'email_draft'],
    procedures: ['analysis', 'terms']
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
  await pool.query('UPDATE users SET last_login_at=now(), last_seen_at=now() WHERE id=$1', [user.id]);
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
    mustChangePassword: req.user.must_change_password,
    firstName: req.user.first_name || '',
    lastName: req.user.last_name || '',
    phone: req.user.phone || '',
    jobTitle: req.user.job_title || '',
    company: req.user.company || '',
    bio: req.user.bio || '',
    language: req.user.language_preference || 'bg',
    theme: req.user.theme_preference || 'dark',
    avatarUrl: req.user.avatar_bytes ? `data:${req.user.avatar_mime_type || 'image/png'};base64,${req.user.avatar_bytes.toString('base64')}` : ''
  });
});

app.get('/api/profile', auth, async (req, res) => {
  const profile = {
    displayName: req.user.display_name,
    firstName: req.user.first_name || '',
    lastName: req.user.last_name || '',
    phone: req.user.phone || '',
    jobTitle: req.user.job_title || '',
    company: req.user.company || '',
    bio: req.user.bio || '',
    language: req.user.language_preference || 'bg',
    theme: req.user.theme_preference || 'dark',
    avatarUrl: req.user.avatar_bytes ? `data:${req.user.avatar_mime_type || 'image/png'};base64,${req.user.avatar_bytes.toString('base64')}` : ''
  };

  // Alias for UI that calls /api/profile
  return res.json({ ok: true, user: req.user, profile });
});

app.all('/api/profile', auth, async (req, res, next) => {
  if (!['PATCH', 'POST', 'PUT'].includes(req.method)) return next();
  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  const displayName = String(req.body.displayName || `${firstName} ${lastName}`.trim() || req.user.display_name).trim();
  const phone = String(req.body.phone || '').trim();
  const jobTitle = String(req.body.jobTitle || '').trim();
  const company = String(req.body.company || '').trim();
  const bio = String(req.body.bio || '').trim();
  const language = ['bg', 'en'].includes(String(req.body.language || '').trim()) ? String(req.body.language).trim() : (req.user.language_preference || 'bg');
  const theme = ['dark', 'light'].includes(String(req.body.theme || '').trim()) ? String(req.body.theme).trim() : (req.user.theme_preference || 'dark');

  await pool.query(
    `UPDATE users
     SET display_name=$1, first_name=$2, last_name=$3, phone=$4, job_title=$5, company=$6, bio=$7,
         language_preference=$8, theme_preference=$9, updated_at=now()
     WHERE id=$10`,
    [displayName, firstName, lastName, phone, jobTitle, company, bio, language, theme, req.user.id]
  );

  res.json({ ok: true });
});

app.post('/api/profile/avatar', auth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Avatar file is required' });
  if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ ok: false, error: 'Invalid image file' });

  await pool.query('UPDATE users SET avatar_bytes=$1, avatar_mime_type=$2, updated_at=now() WHERE id=$3', [req.file.buffer, req.file.mimetype, req.user.id]);
  return res.json({ ok: true });
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
  try {
    const text = String(req.body.inputText || '').trim();
    if (!text || text.length > 8000) return res.status(400).json({ ok: false, message: 'Invalid input text' });

    let agentId = req.body.agentId ? Number(req.body.agentId) : null;
    const agentKey = String(req.body.agent_key || req.body.agentKey || '').trim();
    if (!agentId && agentKey) {
      const resolved = await resolveAgentByKey(agentKey);
      agentId = resolved?.id || null;
    }
    if (!agentId) return res.status(400).json({ ok: false, message: 'agentId or agent_key is required' });

    const r = await pool.query('INSERT INTO tasks(agent_id, created_by, input_text, status) VALUES ($1,$2,$3,$4) RETURNING *', [agentId, req.user.id, text, 'draft']);
    return res.status(201).json({ ok: true, ...r.rows[0], task: r.rows[0] });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Failed to create task' });
  }
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
  try {
    const taskId = req.params.id;
    const t = await pool.query('SELECT t.*, a.code, a.key FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.id=$1 AND t.created_by=$2', [taskId, req.user.id]);
    const task = t.rows[0];
    if (!task) return res.status(404).json({ ok: false, message: 'Task not found' });

    const context = await loadAgentContext(task.key || task.code);
    const sectionTypes = sectionsForAgent(task.code);
    const instructions = `Return plain text. Use lines starting with exact labels: ${sectionTypes.map((s) => `${s}:`).join(', ')}.`;
    const systemPrompt = [context.systemPrompt, context.rulesPrompt, context.stylePrompt].filter(Boolean).join('\n\n');

    const result = await openai.chat.completions.create({
      model: context.settings.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      temperature: Number(context.settings.temperature ?? 0.3),
      max_tokens: Number(context.settings.max_tokens ?? 800),
      messages: [
        { role: 'system', content: systemPrompt || SAFE_DEFAULT_PROMPT },
        { role: 'user', content: `${instructions}\n\n${formatContextForUser(context, task.input_text)}` }
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
    return res.json({ ok: true, sections: sections.rows });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Generation failed' });
  }
});

app.patch('/api/tasks/:id/sections', auth, requirePasswordUpdated, async (req, res) => {
  const updates = Array.isArray(req.body.sections) ? req.body.sections : [];
  for (const row of updates) {
    await pool.query('UPDATE task_sections SET content_final=$1, updated_at=now() WHERE task_id=$2 AND section_type=$3', [String(row.contentFinal || ''), req.params.id, row.sectionType]);
  }
  await pool.query('UPDATE tasks SET updated_at=now() WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});


app.get('/api/tasks/:id/export', auth, requirePasswordUpdated, async (req, res) => {
  const format = req.query.format === 'pdf' ? 'pdf' : 'docx';
  const taskResult = await pool.query('SELECT * FROM tasks WHERE id=$1 AND created_by=$2', [req.params.id, req.user.id]);
  const task = taskResult.rows[0];
  if (!task) return res.status(404).json({ ok: false, message: 'Task not found' });

  const sections = await pool.query(
    `SELECT section_type, COALESCE(content_final, content_draft, '') AS content
     FROM task_sections
     WHERE task_id=$1
     ORDER BY id`,
    [req.params.id]
  );
  const text = buildTaskExportText(task, sections.rows);

  if (format === 'pdf') {
    const pdfBytes = generateSimplePdfBuffer(text);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=task_${task.id}.pdf`);
    return res.send(pdfBytes);
  }

  const docxBytes = Buffer.from(text, 'utf8');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename=task_${task.id}.docx`);
  return res.send(docxBytes);
});

app.post('/api/tasks/:id/approve', auth, requirePasswordUpdated, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskResult = await client.query(
      'SELECT t.*, a.id AS agent_id FROM tasks t JOIN agents a ON a.id=t.agent_id WHERE t.id=$1 AND t.created_by=$2',
      [req.params.id, req.user.id]
    );
    const task = taskResult.rows[0];
    if (!task) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, message: 'Task not found' });
    }

    await client.query('UPDATE tasks SET status=$2, approved_by=$3, approved_at=now(), updated_at=now() WHERE id=$1', [req.params.id, 'approved', req.user.id]);
    const sections = await client.query(`SELECT section_type, COALESCE(content_final, content_draft, '') AS content FROM task_sections WHERE task_id=$1 ORDER BY id`, [req.params.id]);
    const outputText = sections.rows.map((row) => `${row.section_type}: ${row.content}`).join('\n\n').trim() || 'Approved output';
    await client.query(
      `INSERT INTO agent_training_examples(agent_id,input_text,output_text,status,notes)
       VALUES($1,$2,$3,'approved',$4)`,
      [task.agent_id, task.input_text, outputText, `Auto-approved from task #${req.params.id}`]
    );
    await writeAgentAudit(task.agent_id, req.user.id, 'approve_task_training', { taskId: req.params.id });
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ ok: false, message: error.message || 'Approve failed' });
  } finally {
    client.release();
  }
});

app.post('/api/offers', auth, requirePasswordUpdated, async (req, res) => {
  const { clientCompany, clientName, clientEmail, leadText, currency = 'BGN', vatMode = 'standard' } = req.body;
  const inputItems = Array.isArray(req.body.items) ? req.body.items : [];
  const pricing = await computeOfferPricing({ currency, vatMode, items: inputItems });

  const offersAgent = await resolveAgentByKey('offers');
  const activeTemplate = offersAgent ? await getActiveDocTemplate(offersAgent.id, 'offer') : null;

  const offer = await pool.query(
    `INSERT INTO offers(created_by,client_company,client_name,client_email,lead_text,currency,vat_mode,subtotal,vat_amount,total,status,pricing_version_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      req.user.id,
      clientCompany,
      clientName,
      clientEmail,
      leadText,
      currency,
      vatMode,
      pricing.subtotal,
      pricing.vatAmount,
      pricing.total,
      'draft',
      pricing.priceListId || null
    ]
  );

  if (activeTemplate) {
    await pool.query('UPDATE offers SET template_id=$1, updated_at=now() WHERE id=$2', [activeTemplate.id, offer.rows[0].id]);
    offer.rows[0].template_id = activeTemplate.id;
  }

  await pool.query(
    'INSERT INTO offer_sections(offer_id, section_type, content) VALUES ($1,$2,$3),($1,$4,$5)',
    [offer.rows[0].id, 'offer_intro', 'Проектна оферта.', 'pricing', pricing.breakdown]
  );

  res.status(201).json({ offer: offer.rows[0], pricingConfigured: pricing.pricingConfigured });
});

app.post('/api/contracts', auth, requirePasswordUpdated, async (req, res) => {
  const { contractType, clientCompany, clientName, clientEmail } = req.body;
  const r = await pool.query('INSERT INTO contracts(created_by,contract_type,client_company,client_name,client_email,status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.user.id, contractType || 'general', clientCompany, clientName, clientEmail, 'draft']);
  const contractsAgent = await resolveAgentByKey('contracts');
  const activeTemplate = contractsAgent ? await getActiveDocTemplate(contractsAgent.id, 'contract') : null;
  if (activeTemplate) {
    await pool.query('UPDATE contracts SET template_id=$1, updated_at=now() WHERE id=$2', [activeTemplate.id, r.rows[0].id]);
    r.rows[0].template_id = activeTemplate.id;
  }
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

app.get('/api/admin/sessions', auth, requirePasswordUpdated, adminOnly, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, email, display_name, role, is_active, last_login_at, last_seen_at,
            (last_seen_at IS NOT NULL AND last_seen_at > now() - interval '5 minutes') AS is_online
     FROM users
     ORDER BY display_name ASC`
  );

  const sessions = rows.map((row) => {
    const durationSec = row.is_online && row.last_login_at
      ? Math.max(0, Math.floor((Date.now() - new Date(row.last_login_at).getTime()) / 1000))
      : null;
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      isActive: row.is_active,
      isOnline: row.is_online,
      lastLoginAt: row.last_login_at,
      lastSeenAt: row.last_seen_at,
      sessionDurationSec: durationSec
    };
  });

  return res.json({ ok: true, sessions });
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


app.delete('/api/admin/users/:id', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ ok: false, message: 'Cannot delete current admin user' });
  }
  const { rowCount } = await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ ok: false, message: 'User not found' });
  return res.json({ ok: true });
});

app.get('/api/admin/agents', auth, requirePasswordUpdated, adminOnly, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, key, code, name, description, is_enabled, created_at FROM agents ORDER BY created_at ASC, id ASC');
    return res.json({ ok: true, agents: rows });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Failed to load agents' });
  }
});

app.post('/api/admin/agents', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  try {
    const keyValidation = validateTextField(req.body.key, 'key', 120);
    const nameValidation = validateTextField(req.body.name, 'name', 200);
    if (!keyValidation.ok) return badRequest(res, keyValidation.message);
    if (!nameValidation.ok) return badRequest(res, nameValidation.message);
    const key = keyValidation.value.toLowerCase().replace(/\s+/g, '_');
    const description = String(req.body.description || '').trim().slice(0, 2000);
    const isEnabled = req.body.is_enabled === undefined ? true : Boolean(req.body.is_enabled);
    const { rows } = await pool.query(
      `INSERT INTO agents(code,key,name,description,is_enabled)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,key,code,name,description,is_enabled,created_at`,
      [key, key, nameValidation.value, description, isEnabled]
    );
    await pool.query('INSERT INTO agent_settings(agent_id) VALUES($1) ON CONFLICT (agent_id) DO NOTHING', [rows[0].id]);
    await writeAgentAudit(rows[0].id, req.user.id, 'create_agent', { key, name: nameValidation.value });
    return res.status(201).json({ ok: true, agent: rows[0] });
  } catch (error) {
    return res.status(400).json({ ok: false, message: error.message || 'Failed to create agent' });
  }
});

app.put('/api/admin/agents/:id', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return badRequest(res, 'Invalid agent id');
    const current = await pool.query('SELECT * FROM agents WHERE id=$1', [id]);
    if (!current.rows[0]) return res.status(404).json({ ok: false, message: 'Agent not found' });
    const payload = {
      name: req.body.name === undefined ? current.rows[0].name : String(req.body.name || '').trim(),
      description: req.body.description === undefined ? current.rows[0].description : String(req.body.description || '').trim(),
      is_enabled: req.body.is_enabled === undefined ? current.rows[0].is_enabled : Boolean(req.body.is_enabled)
    };
    if (!payload.name) return badRequest(res, 'name is required');
    const { rows } = await pool.query(
      'UPDATE agents SET name=$1, description=$2, is_enabled=$3 WHERE id=$4 RETURNING id,key,code,name,description,is_enabled,created_at',
      [payload.name, payload.description, payload.is_enabled, id]
    );
    await writeAgentAudit(id, req.user.id, 'update_agent', payload);
    return res.json({ ok: true, agent: rows[0] });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Failed to update agent' });
  }
});

app.get('/api/admin/agents/:id/settings', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Invalid agent id');
  const { rows } = await pool.query('SELECT * FROM agent_settings WHERE agent_id=$1', [id]);
  if (!rows[0]) return res.status(404).json({ ok: false, message: 'Settings not found' });
  return res.json({ ok: true, settings: rows[0] });
});

app.put('/api/admin/agents/:id/settings', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return badRequest(res, 'Invalid agent id');
    const model = String(req.body.model || 'gpt-4.1-mini').trim().slice(0, 120);
    const temperature = Number(req.body.temperature ?? 0.3);
    const maxTokens = Number(req.body.max_tokens ?? req.body.maxTokens ?? 800);
    const toolsEnabled = req.body.tools_enabled && typeof req.body.tools_enabled === 'object' ? req.body.tools_enabled : {};
    if (!model) return badRequest(res, 'model is required');
    if (Number.isNaN(temperature) || temperature < 0 || temperature > 2) return badRequest(res, 'temperature must be between 0 and 2');
    if (!Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > 8000) return badRequest(res, 'max_tokens must be between 64 and 8000');

    const { rows } = await pool.query(
      `INSERT INTO agent_settings(agent_id,model,temperature,max_tokens,tools_enabled,updated_at)
       VALUES($1,$2,$3,$4,$5,now())
       ON CONFLICT (agent_id)
       DO UPDATE SET model=EXCLUDED.model,temperature=EXCLUDED.temperature,max_tokens=EXCLUDED.max_tokens,tools_enabled=EXCLUDED.tools_enabled,updated_at=now()
       RETURNING *`,
      [id, model, temperature, maxTokens, toolsEnabled]
    );
    await writeAgentAudit(id, req.user.id, 'update_settings', { model, temperature, maxTokens });
    return res.json({ ok: true, settings: rows[0] });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Failed to update settings' });
  }
});

app.get('/api/admin/agents/:id/prompts', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const type = String(req.query.type || '').trim();
  if (!id) return badRequest(res, 'Invalid agent id');
  if (type && !['system', 'style', 'rules'].includes(type)) return badRequest(res, 'Invalid prompt type');
  const params = [id];
  let sql = 'SELECT * FROM agent_prompts WHERE agent_id=$1';
  if (type) {
    params.push(type);
    sql += ` AND type=$${params.length}`;
  }
  sql += ' ORDER BY type ASC, version DESC, created_at DESC';
  const { rows } = await pool.query(sql, params);
  return res.json({ ok: true, prompts: rows });
});

app.post('/api/admin/agents/:id/prompts', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return badRequest(res, 'Invalid agent id');
    const type = String(req.body.type || '').trim();
    if (!['system', 'style', 'rules'].includes(type)) return badRequest(res, 'Invalid prompt type');
    const contentValidation = validateTextField(req.body.content, 'content', 20000);
    if (!contentValidation.ok) return badRequest(res, contentValidation.message);
    const versionRes = await pool.query('SELECT COALESCE(MAX(version),0)+1 AS next_version FROM agent_prompts WHERE agent_id=$1 AND type=$2', [id, type]);
    const { rows } = await pool.query(
      `INSERT INTO agent_prompts(agent_id,type,content,version,is_active)
       VALUES($1,$2,$3,$4,false)
       RETURNING *`,
      [id, type, contentValidation.value, versionRes.rows[0].next_version]
    );
    await writeAgentAudit(id, req.user.id, 'create_prompt', { promptId: rows[0].id, type, version: rows[0].version });
    return res.status(201).json({ ok: true, prompt: rows[0] });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message || 'Failed to create prompt' });
  }
});

app.put('/api/admin/prompts/:promptId', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const promptId = Number(req.params.promptId);
  if (!promptId) return badRequest(res, 'Invalid prompt id');
  const contentValidation = validateTextField(req.body.content, 'content', 20000);
  if (!contentValidation.ok) return badRequest(res, contentValidation.message);
  const { rows } = await pool.query('UPDATE agent_prompts SET content=$1 WHERE id=$2 RETURNING *', [contentValidation.value, promptId]);
  if (!rows[0]) return res.status(404).json({ ok: false, message: 'Prompt not found' });
  await writeAgentAudit(rows[0].agent_id, req.user.id, 'update_prompt', { promptId });
  return res.json({ ok: true, prompt: rows[0] });
});

app.post('/api/admin/prompts/:promptId/activate', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const promptId = Number(req.params.promptId);
  if (!promptId) return badRequest(res, 'Invalid prompt id');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM agent_prompts WHERE id=$1', [promptId]);
    const prompt = current.rows[0];
    if (!prompt) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, message: 'Prompt not found' });
    }
    await client.query('UPDATE agent_prompts SET is_active=false WHERE agent_id=$1 AND type=$2', [prompt.agent_id, prompt.type]);
    await client.query('UPDATE agent_prompts SET is_active=true WHERE id=$1', [promptId]);
    await writeAgentAudit(prompt.agent_id, req.user.id, 'activate_prompt', { promptId });
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ ok: false, message: error.message || 'Failed to activate prompt' });
  } finally {
    client.release();
  }
});

app.get('/api/admin/agents/:id/knowledge', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Invalid agent id');
  const { rows } = await pool.query('SELECT * FROM agent_knowledge WHERE agent_id=$1 ORDER BY created_at DESC', [id]);
  return res.json({ ok: true, knowledge: rows });
});

app.post('/api/admin/agents/:id/knowledge', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Invalid agent id');
  const titleValidation = validateTextField(req.body.title, 'title', 300);
  const contentValidation = validateTextField(req.body.content, 'content', 50000);
  if (!titleValidation.ok) return badRequest(res, titleValidation.message);
  if (!contentValidation.ok) return badRequest(res, contentValidation.message);
  const source = String(req.body.source || '').trim().slice(0, 200);
  const tags = normalizeTags(req.body.tags);
  const isActive = req.body.is_active === undefined ? true : Boolean(req.body.is_active);
  const { rows } = await pool.query(
    `INSERT INTO agent_knowledge(agent_id,title,content,source,tags,is_active)
     VALUES($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [id, titleValidation.value, contentValidation.value, source, JSON.stringify(tags), isActive]
  );
  await writeAgentAudit(id, req.user.id, 'create_knowledge', { knowledgeId: rows[0].id });
  return res.status(201).json({ ok: true, knowledge: rows[0] });
});

app.put('/api/admin/knowledge/:kid', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const kid = Number(req.params.kid);
  if (!kid) return badRequest(res, 'Invalid knowledge id');
  const current = await pool.query('SELECT * FROM agent_knowledge WHERE id=$1', [kid]);
  const row = current.rows[0];
  if (!row) return res.status(404).json({ ok: false, message: 'Knowledge not found' });
  const payload = {
    title: req.body.title === undefined ? row.title : String(req.body.title || '').trim(),
    content: req.body.content === undefined ? row.content : String(req.body.content || '').trim(),
    source: req.body.source === undefined ? row.source : String(req.body.source || '').trim(),
    tags: req.body.tags === undefined ? row.tags : normalizeTags(req.body.tags),
    is_active: req.body.is_active === undefined ? row.is_active : Boolean(req.body.is_active)
  };
  if (!payload.title) return badRequest(res, 'title is required');
  if (!payload.content) return badRequest(res, 'content is required');
  if (payload.content.length > 50000) return badRequest(res, 'content exceeds 50000 characters');
  const { rows } = await pool.query(
    `UPDATE agent_knowledge
     SET title=$1, content=$2, source=$3, tags=$4, is_active=$5
     WHERE id=$6 RETURNING *`,
    [payload.title, payload.content, payload.source, JSON.stringify(payload.tags), payload.is_active, kid]
  );
  await writeAgentAudit(row.agent_id, req.user.id, 'update_knowledge', { knowledgeId: kid });
  return res.json({ ok: true, knowledge: rows[0] });
});

app.delete('/api/admin/knowledge/:kid', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const kid = Number(req.params.kid);
  if (!kid) return badRequest(res, 'Invalid knowledge id');
  const { rows } = await pool.query('DELETE FROM agent_knowledge WHERE id=$1 RETURNING *', [kid]);
  if (!rows[0]) return res.status(404).json({ ok: false, message: 'Knowledge not found' });
  await writeAgentAudit(rows[0].agent_id, req.user.id, 'delete_knowledge', { knowledgeId: kid });
  return res.json({ ok: true });
});

app.get('/api/admin/agents/:id/templates', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Invalid agent id');
  const { rows } = await pool.query('SELECT * FROM agent_templates WHERE agent_id=$1 ORDER BY created_at DESC', [id]);
  return res.json({ ok: true, templates: rows });
});

app.get('/api/admin/doc-templates', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const filters = [];
  const params = [];

  if (req.query.agentId) {
    const agentId = Number(req.query.agentId);
    if (!agentId) return badRequest(res, 'Invalid agentId');
    params.push(agentId);
    filters.push(`dt.agent_id=$${params.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT dt.id, dt.name, dt.template_type, dt.agent_id, dt.is_active, dt.created_at, dt.original_filename,
            a.name AS agent_name, a.key AS agent_key
     FROM doc_templates dt
     LEFT JOIN agents a ON a.id=dt.agent_id
     ${whereClause}
     ORDER BY dt.created_at DESC, dt.id DESC`,
    params
  );

  return res.json({ ok: true, templates: rows });
});

app.post('/api/admin/doc-templates', auth, requirePasswordUpdated, adminOnly, upload.single('templateFile'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const templateType = String(req.body.templateType || '').trim().toLowerCase();
  const agentId = Number(req.body.agentId);
  const isActive = req.body.isActive === undefined ? true : String(req.body.isActive) === 'true';
  const file = req.file;

  if (!name) return badRequest(res, 'name is required');
  if (!agentId) return badRequest(res, 'agentId is required');
  if (!['offer', 'contract'].includes(templateType)) return badRequest(res, 'templateType must be offer or contract');
  if (!file) return badRequest(res, 'templateFile is required');
  if (!/\.docx$/i.test(file.originalname || '')) return badRequest(res, 'Only .docx templates are supported');

  const agent = await pool.query('SELECT id FROM agents WHERE id=$1', [agentId]);
  if (!agent.rows[0]) return badRequest(res, 'Agent not found');

  if (isActive) {
    await pool.query('UPDATE doc_templates SET is_active=false WHERE agent_id=$1 AND template_type=$2', [agentId, templateType]);
  }

  const { rows } = await pool.query(
    `INSERT INTO doc_templates(name, template_type, agent_id, is_active, docx_bytes, mime_type, original_filename, created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, name, template_type, agent_id, is_active, created_at, original_filename`,
    [name, templateType, agentId, isActive, file.buffer, file.mimetype || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file.originalname || null, req.user.id]
  );

  await writeAgentAudit(agentId, req.user.id, 'upload_doc_template', { templateId: rows[0].id, templateType });
  return res.status(201).json({ ok: true, template: rows[0] });
});

app.delete('/api/admin/doc-templates/:id', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Invalid template id');
  const { rows } = await pool.query('DELETE FROM doc_templates WHERE id=$1 RETURNING id,agent_id', [id]);
  if (!rows[0]) return res.status(404).json({ ok: false, message: 'Template not found' });
  await writeAgentAudit(rows[0].agent_id, req.user.id, 'delete_doc_template', { templateId: id });
  return res.json({ ok: true });
});

app.post('/api/admin/agents/:id/templates', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Invalid agent id');
  const nameValidation = validateTextField(req.body.name, 'name', 300);
  const contentValidation = validateTextField(req.body.content, 'content', 50000);
  if (!nameValidation.ok) return badRequest(res, nameValidation.message);
  if (!contentValidation.ok) return badRequest(res, contentValidation.message);
  const tags = normalizeTags(req.body.tags);
  const isActive = req.body.is_active === undefined ? true : Boolean(req.body.is_active);
  const { rows } = await pool.query(
    `INSERT INTO agent_templates(agent_id,name,content,tags,is_active)
     VALUES($1,$2,$3,$4,$5)
     RETURNING *`,
    [id, nameValidation.value, contentValidation.value, JSON.stringify(tags), isActive]
  );
  await writeAgentAudit(id, req.user.id, 'create_template', { templateId: rows[0].id });
  return res.status(201).json({ ok: true, template: rows[0] });
});

app.put('/api/admin/templates/:tid', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const tid = Number(req.params.tid);
  if (!tid) return badRequest(res, 'Invalid template id');
  const current = await pool.query('SELECT * FROM agent_templates WHERE id=$1', [tid]);
  const row = current.rows[0];
  if (!row) return res.status(404).json({ ok: false, message: 'Template not found' });
  const payload = {
    name: req.body.name === undefined ? row.name : String(req.body.name || '').trim(),
    content: req.body.content === undefined ? row.content : String(req.body.content || '').trim(),
    tags: req.body.tags === undefined ? row.tags : normalizeTags(req.body.tags),
    is_active: req.body.is_active === undefined ? row.is_active : Boolean(req.body.is_active)
  };
  if (!payload.name) return badRequest(res, 'name is required');
  if (!payload.content) return badRequest(res, 'content is required');
  const { rows } = await pool.query(
    `UPDATE agent_templates
     SET name=$1, content=$2, tags=$3, is_active=$4
     WHERE id=$5 RETURNING *`,
    [payload.name, payload.content, JSON.stringify(payload.tags), payload.is_active, tid]
  );
  await writeAgentAudit(row.agent_id, req.user.id, 'update_template', { templateId: tid });
  return res.json({ ok: true, template: rows[0] });
});

app.delete('/api/admin/templates/:tid', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const tid = Number(req.params.tid);
  if (!tid) return badRequest(res, 'Invalid template id');
  const { rows } = await pool.query('DELETE FROM agent_templates WHERE id=$1 RETURNING *', [tid]);
  if (!rows[0]) return res.status(404).json({ ok: false, message: 'Template not found' });
  await writeAgentAudit(rows[0].agent_id, req.user.id, 'delete_template', { templateId: tid });
  return res.json({ ok: true });
});

app.get('/api/admin/agents/:id/examples', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Invalid agent id');
  const { rows } = await pool.query('SELECT * FROM agent_training_examples WHERE agent_id=$1 ORDER BY created_at DESC', [id]);
  return res.json({ ok: true, examples: rows });
});

app.post('/api/admin/agents/:id/examples', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Invalid agent id');
  const inputValidation = validateTextField(req.body.input_text, 'input_text', 20000);
  const outputValidation = validateTextField(req.body.output_text, 'output_text', 20000);
  if (!inputValidation.ok) return badRequest(res, inputValidation.message);
  if (!outputValidation.ok) return badRequest(res, outputValidation.message);
  const status = ['draft', 'approved', 'rejected'].includes(String(req.body.status || 'draft')) ? String(req.body.status || 'draft') : 'draft';
  const rating = req.body.rating == null ? null : Number(req.body.rating);
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return badRequest(res, 'rating must be between 1 and 5');
  const notes = String(req.body.notes || '').trim().slice(0, 3000);
  const { rows } = await pool.query(
    `INSERT INTO agent_training_examples(agent_id,input_text,output_text,status,rating,notes)
     VALUES($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [id, inputValidation.value, outputValidation.value, status, rating, notes]
  );
  await writeAgentAudit(id, req.user.id, 'create_example', { exampleId: rows[0].id, status });
  return res.status(201).json({ ok: true, example: rows[0] });
});

app.put('/api/admin/examples/:eid', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const eid = Number(req.params.eid);
  if (!eid) return badRequest(res, 'Invalid example id');
  const current = await pool.query('SELECT * FROM agent_training_examples WHERE id=$1', [eid]);
  const row = current.rows[0];
  if (!row) return res.status(404).json({ ok: false, message: 'Example not found' });
  const payload = {
    input_text: req.body.input_text === undefined ? row.input_text : String(req.body.input_text || '').trim(),
    output_text: req.body.output_text === undefined ? row.output_text : String(req.body.output_text || '').trim(),
    status: req.body.status === undefined ? row.status : String(req.body.status || '').trim(),
    rating: req.body.rating === undefined ? row.rating : (req.body.rating == null ? null : Number(req.body.rating)),
    notes: req.body.notes === undefined ? row.notes : String(req.body.notes || '').trim()
  };
  if (!payload.input_text || !payload.output_text) return badRequest(res, 'input_text and output_text are required');
  if (!['draft', 'approved', 'rejected'].includes(payload.status)) return badRequest(res, 'Invalid status');
  if (payload.rating != null && (!Number.isInteger(payload.rating) || payload.rating < 1 || payload.rating > 5)) return badRequest(res, 'rating must be between 1 and 5');
  const { rows } = await pool.query(
    `UPDATE agent_training_examples
     SET input_text=$1, output_text=$2, status=$3, rating=$4, notes=$5
     WHERE id=$6 RETURNING *`,
    [payload.input_text, payload.output_text, payload.status, payload.rating, payload.notes, eid]
  );
  await writeAgentAudit(row.agent_id, req.user.id, 'update_example', { exampleId: eid, status: payload.status });
  return res.json({ ok: true, example: rows[0] });
});

app.post('/api/admin/examples/:eid/approve', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const eid = Number(req.params.eid);
  if (!eid) return badRequest(res, 'Invalid example id');
  const { rows } = await pool.query("UPDATE agent_training_examples SET status='approved' WHERE id=$1 RETURNING *", [eid]);
  if (!rows[0]) return res.status(404).json({ ok: false, message: 'Example not found' });
  await writeAgentAudit(rows[0].agent_id, req.user.id, 'approve_example', { exampleId: eid });
  return res.json({ ok: true, example: rows[0] });
});

app.post('/api/admin/examples/:eid/reject', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const eid = Number(req.params.eid);
  if (!eid) return badRequest(res, 'Invalid example id');
  const { rows } = await pool.query("UPDATE agent_training_examples SET status='rejected' WHERE id=$1 RETURNING *", [eid]);
  if (!rows[0]) return res.status(404).json({ ok: false, message: 'Example not found' });
  await writeAgentAudit(rows[0].agent_id, req.user.id, 'reject_example', { exampleId: eid });
  return res.json({ ok: true, example: rows[0] });
});

app.get('/api/admin/agents/:id/audit', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Invalid agent id');
  const { rows } = await pool.query('SELECT * FROM agent_audit WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 200', [id]);
  return res.json({ ok: true, audit: rows });
});

app.get('/api/admin/agents/:id/debug-context', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return badRequest(res, 'Invalid agent id');
  const agentResult = await pool.query('SELECT key, code FROM agents WHERE id=$1', [id]);
  if (!agentResult.rows[0]) return res.status(404).json({ ok: false, message: 'Agent not found' });
  const context = await loadAgentContext(agentResult.rows[0].key || agentResult.rows[0].code);
  return res.json({
    ok: true,
    activePrompts: context.activePromptMeta,
    settings: context.settings,
    knowledgeCount: context.knowledgeItems.length,
    approvedExamplesCount: context.examples.length
  });
});

// backwards-compatible legacy endpoints
app.get('/api/admin/prompts', auth, requirePasswordUpdated, adminOnly, async (_req, res) => {
  const { rows } = await pool.query('SELECT ap.*, a.code agent_code, a.key agent_key FROM agent_prompts ap JOIN agents a ON a.id=ap.agent_id ORDER BY ap.created_at DESC LIMIT 300');
  return res.json(rows);
});

app.post('/api/admin/prompts', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const agentId = Number(req.body.agentId);
  if (!agentId) return badRequest(res, 'agentId is required');
  const content = req.body.systemPromptText || req.body.content;
  req.params.id = String(agentId);
  req.body.type = 'system';
  req.body.content = content;
  const nextVersion = await pool.query('SELECT COALESCE(MAX(version),0)+1 n FROM agent_prompts WHERE agent_id=$1 AND type=$2', [agentId, 'system']);
  if (req.body.isActive) await pool.query('UPDATE agent_prompts SET is_active=false WHERE agent_id=$1 AND type=$2', [agentId, 'system']);
  const { rows } = await pool.query('INSERT INTO agent_prompts(agent_id,type,content,is_active,version) VALUES($1,$2,$3,$4,$5) RETURNING *', [agentId, 'system', String(content || '').trim(), Boolean(req.body.isActive), nextVersion.rows[0].n]);
  await writeAgentAudit(agentId, req.user.id, 'legacy_create_prompt', { promptId: rows[0].id });
  return res.status(201).json(rows[0]);
});

app.get('/api/admin/knowledge', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const agentId = Number(req.query.agentId);
  if (!agentId) return badRequest(res, 'agentId is required');
  const { rows } = await pool.query('SELECT * FROM agent_knowledge WHERE agent_id=$1 ORDER BY created_at DESC', [agentId]);
  return res.json({ ok: true, docs: rows });
});

app.post('/api/admin/knowledge', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const agentId = Number(req.body.agentId);
  if (!agentId) return badRequest(res, 'agentId is required');
  const titleValidation = validateTextField(req.body.title, 'title', 300);
  const contentValidation = validateTextField(req.body.contentText, 'contentText', 50000);
  if (!titleValidation.ok) return badRequest(res, titleValidation.message);
  if (!contentValidation.ok) return badRequest(res, contentValidation.message);
  const { rows } = await pool.query('INSERT INTO agent_knowledge(agent_id,title,content,source,is_active) VALUES($1,$2,$3,$4,true) RETURNING *', [agentId, titleValidation.value, contentValidation.value, String(req.body.source || '').trim()]);
  await writeAgentAudit(agentId, req.user.id, 'legacy_create_knowledge', { knowledgeId: rows[0].id });
  return res.status(201).json(rows[0]);
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

app.get('/api/admin/offers/pricing', auth, requirePasswordUpdated, adminOnly, async (_req, res) => {
  const active = await getActivePriceList();
  return res.json({ ok: true, pricingConfigured: Boolean(active), activePriceList: active });
});

app.get('/api/admin/offers/price-lists', auth, requirePasswordUpdated, adminOnly, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM offers_price_lists ORDER BY created_at DESC, id DESC');
  return res.json({ ok: true, priceLists: rows });
});

app.post('/api/admin/offers/price-lists', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const currency = String(req.body.currency || 'BGN').trim().toUpperCase() || 'BGN';
  const vatPercent = Number(req.body.vatPercent ?? 20);
  const isActive = Boolean(req.body.isActive);
  if (!name) return res.status(400).json({ ok: false, error: 'Name is required' });
  if (isActive) await pool.query('UPDATE offers_price_lists SET is_active=false, updated_at=now() WHERE is_active=true');
  const { rows } = await pool.query(
    `INSERT INTO offers_price_lists(name,currency,vat_percent,is_active,created_by,updated_at)
     VALUES($1,$2,$3,$4,$5,now()) RETURNING *`,
    [name, currency, vatPercent, isActive, req.user.id]
  );
  return res.status(201).json({ ok: true, priceList: rows[0] });
});

app.get('/api/admin/offers/price-items', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const priceListId = Number(req.query.priceListId || 0);
  if (!priceListId) return res.status(400).json({ ok: false, error: 'priceListId is required' });
  const { rows } = await pool.query('SELECT * FROM offers_price_items WHERE price_list_id=$1 ORDER BY service_key ASC, tier_min ASC, id ASC', [priceListId]);
  return res.json({ ok: true, items: rows });
});

app.post('/api/admin/offers/price-items', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const { priceListId, serviceKey, serviceName, unit = 'unit', tierMin = 1, tierMax = null, unitPrice, isActive = true } = req.body;
  if (!priceListId || !serviceKey || !serviceName || unitPrice == null) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }
  const { rows } = await pool.query(
    `INSERT INTO offers_price_items(price_list_id,service_key,service_name,unit,tier_min,tier_max,unit_price,is_active,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING *`,
    [priceListId, serviceKey, serviceName, unit, tierMin, tierMax, unitPrice, Boolean(isActive)]
  );
  return res.status(201).json({ ok: true, item: rows[0] });
});

app.patch('/api/admin/offers/price-items/:id', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
  const current = await pool.query('SELECT * FROM offers_price_items WHERE id=$1', [id]);
  const row = current.rows[0];
  if (!row) return res.status(404).json({ ok: false, error: 'Not found' });
  const payload = {
    service_key: req.body.serviceKey ?? row.service_key,
    service_name: req.body.serviceName ?? row.service_name,
    unit: req.body.unit ?? row.unit,
    tier_min: req.body.tierMin ?? row.tier_min,
    tier_max: req.body.tierMax === undefined ? row.tier_max : req.body.tierMax,
    unit_price: req.body.unitPrice ?? row.unit_price,
    is_active: req.body.isActive === undefined ? row.is_active : Boolean(req.body.isActive)
  };
  const { rows } = await pool.query(
    `UPDATE offers_price_items
     SET service_key=$1,service_name=$2,unit=$3,tier_min=$4,tier_max=$5,unit_price=$6,is_active=$7,updated_at=now()
     WHERE id=$8 RETURNING *`,
    [payload.service_key, payload.service_name, payload.unit, payload.tier_min, payload.tier_max, payload.unit_price, payload.is_active, id]
  );
  return res.json({ ok: true, item: rows[0] });
});

app.delete('/api/admin/offers/price-items/:id', auth, requirePasswordUpdated, adminOnly, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM offers_price_items WHERE id=$1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ ok: false, error: 'Not found' });
  return res.json({ ok: true });
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
  const linkedTemplate = await pool.query(
    `SELECT dt.docx_bytes
     FROM offers o
     JOIN doc_templates dt ON dt.id=o.template_id
     WHERE o.id=$1`,
    [req.params.id]
  );
  const docx = linkedTemplate.rows[0]?.docx_bytes || await generateDocxStub('offer', req.params.id);
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
  const linkedTemplate = await pool.query(
    `SELECT dt.docx_bytes
     FROM contracts c
     JOIN doc_templates dt ON dt.id=c.template_id
     WHERE c.id=$1`,
    [req.params.id]
  );
  const docx = linkedTemplate.rows[0]?.docx_bytes || await generateDocxStub('contract', req.params.id);
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
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, db: true });
  } catch {
    return res.status(503).json({ ok: false, db: false });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, db: true });
  } catch {
    return res.status(503).json({ ok: false, db: false });
  }
});

(async () => {
  await runMigrations();
  await seedAdmin();
  app.listen(PORT, () => console.log(`Anagami AI Core listening on :${PORT}`));
})();
