require('dotenv').config();
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');

const { run, get, all, DEFAULT_MODULES, defaultSalesPrompt } = require('./db');
const { signToken, requireAuth, requireRole } = require('./auth');
const { generateStructuredOutput } = require('./openai');
const { publicGenerateLimiter, loginLimiter } = require('./rateLimit');
const { verifyTurnstile } = require('./turnstile');

const app = express();
const PORT = Number(process.env.PORT || 8789);
const STORE_PUBLIC_REQUESTS = String(process.env.STORE_PUBLIC_REQUESTS || 'false').toLowerCase() === 'true';
const PUBLIC_ALLOWED_ORIGINS = new Set(['https://anagami.bg', 'https://www.anagami.bg']);

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function clampText(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function requireBodyField(field, max = 4000) {
  return (req, res, next) => {
    const value = clampText(req.body[field], max);
    if (!value) return res.status(400).json({ error: `${field} is required` });
    req.body[field] = value;
    return next();
  };
}

function normalizeLanguage(lang) {
  const value = String(lang || 'bg').toLowerCase();
  if (value === 'en') return 'en';
  return 'bg';
}

function assertModule(moduleCode) {
  return DEFAULT_MODULES.includes(moduleCode);
}

let usageLoggingEnabled = true;

async function logUsage(endpoint, req, userId = null, tokensIn = 0, tokensOut = 0) {
  if (!usageLoggingEnabled) return;

  try {
    await run('INSERT INTO usage_logs(endpoint, ip, user_id, tokens_in, tokens_out) VALUES(?,?,?,?,?)', [
      endpoint,
      req.ip,
      userId,
      tokensIn,
      tokensOut
    ]);
  } catch (error) {
    if (error && error.code === '42P01') {
      usageLoggingEnabled = false;
      console.warn('usage_logs table is missing; usage logging is disabled until migration is applied.');
      return;
    }

    console.error('usage logging failed:', error.message || error);
  }
}

async function resolvePrompt(moduleCode, language) {
  const active = await get(
    'SELECT content FROM prompts WHERE module=? AND language=? AND is_active=true ORDER BY version DESC LIMIT 1',
    [moduleCode, language]
  );
  if (active) return active.content;
  return defaultSalesPrompt(language);
}

async function resolveKnowledge(language, moduleCode, leadText) {
  const tokens = `${moduleCode} ${leadText}`.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 10);
  const filters = tokens.map(() => 'LOWER(tags) LIKE ?').join(' OR ');
  const params = [language, ...tokens.map((t) => `%${t}%`)];
  const query = filters
    ? `SELECT title, body, tags FROM knowledge_snippets WHERE language=? AND (${filters}) ORDER BY id DESC LIMIT 5`
    : 'SELECT title, body, tags FROM knowledge_snippets WHERE language=? ORDER BY id DESC LIMIT 5';
  const rows = await all(query, params);
  return rows.map((r) => `[${r.tags}] ${r.title}\n${r.body}`);
}

async function resolveTemplates(moduleCode, language) {
  const rows = await all(
    'SELECT title, body, template_type FROM templates WHERE module=? AND language=? AND is_active=true ORDER BY id DESC LIMIT 3',
    [moduleCode, language]
  );
  return rows.map((r) => `${r.template_type} :: ${r.title}\n${r.body}`);
}

async function resolvePricing(moduleCode) {
  const rows = await all('SELECT service, min_price, max_price, currency, notes FROM pricing_rules WHERE module=? ORDER BY id DESC LIMIT 8', [
    moduleCode
  ]);
  return rows.map((r) => `${r.service}: ${r.min_price || 0}-${r.max_price || 0} ${r.currency}. ${r.notes || ''}`.trim());
}

app.get('/api/health', async (_req, res) => {
  let dbReady = true;
  try {
    await get('SELECT 1 as x');
  } catch (_e) {
    dbReady = false;
  }
  res.json({ ok: true, dbReady, hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY) });
});

app.post('/api/auth/login', loginLimiter, requireBodyField('email', 255), requireBodyField('password', 255), async (req, res) => {
  const email = String(req.body.email).toLowerCase();
  const user = await get('SELECT * FROM users WHERE email=?', [email]);
  if (!user || user.is_active !== true) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(String(req.body.password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  await run('UPDATE users SET last_login_at=NOW() WHERE id=?', [user.id]);
  await logUsage('/api/auth/login', req, user.id);
  return res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  await logUsage('/api/auth/me', req, req.user.id);
  res.json(req.user);
});

app.get('/api/modules', requireAuth, (_req, res) => {
  res.json(DEFAULT_MODULES);
});

app.post('/api/tasks', requireAuth, requireRole('agent'), requireBodyField('leadText'), async (req, res) => {
  const moduleCode = clampText(req.body.module, 50).toLowerCase();
  if (!assertModule(moduleCode)) return res.status(400).json({ error: 'Invalid module' });

  const language = normalizeLanguage(req.body.language);
  const data = {
    moduleCode,
    language,
    leadText: clampText(req.body.leadText),
    company: clampText(req.body.company, 255),
    industry: clampText(req.body.industry, 255),
    budget: clampText(req.body.budget, 255),
    timeline: clampText(req.body.timeline, 255)
  };

  const result = await run(
    `INSERT INTO tasks(module, language, lead_text, company, industry, budget, timeline, created_by)
     VALUES(?,?,?,?,?,?,?,?)`,
    [data.moduleCode, data.language, data.leadText, data.company, data.industry, data.budget, data.timeline, req.user.id]
  );
  await logUsage('/api/tasks', req, req.user.id);
  res.json({ id: result.lastID });
});

app.post('/api/tasks/:id/generate', requireAuth, requireRole('agent'), async (req, res) => {
  const taskId = Number(req.params.id);
  const task = await get('SELECT * FROM tasks WHERE id=?', [taskId]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const prompt = await resolvePrompt(task.module, task.language);
  const snippets = await resolveKnowledge(task.language, task.module, task.lead_text);
  const templates = await resolveTemplates(task.module, task.language);
  const pricing = await resolvePricing(task.module);

  try {
    const generated = await generateStructuredOutput({
      module: task.module,
      language: task.language,
      payload: {
        leadText: task.lead_text,
        company: task.company,
        industry: task.industry,
        budget: task.budget,
        timeline: task.timeline
      },
      prompt,
      snippets,
      templates,
      pricing
    });

    await run(
      `INSERT INTO task_outputs(task_id, language, analysis, service, pricing, proposalDraft, emailDraft, upsell, raw_output, input_tokens, output_tokens)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(task_id) DO UPDATE SET
        language=excluded.language,
        analysis=excluded.analysis,
        service=excluded.service,
        pricing=excluded.pricing,
        proposalDraft=excluded.proposalDraft,
        emailDraft=excluded.emailDraft,
        upsell=excluded.upsell,
        raw_output=excluded.raw_output,
        input_tokens=excluded.input_tokens,
        output_tokens=excluded.output_tokens,
        updated_at=NOW()`,
      [
        taskId,
        task.language,
        generated.output.analysis,
        generated.output.service,
        generated.output.pricing,
        generated.output.proposalDraft,
        generated.output.emailDraft,
        generated.output.upsell,
        generated.rawOutput,
        generated.usage.inputTokens,
        generated.usage.outputTokens
      ]
    );

    await run('UPDATE tasks SET updated_at=NOW() WHERE id=?', [taskId]);
    await logUsage('/api/tasks/:id/generate', req, req.user.id, generated.usage.inputTokens, generated.usage.outputTokens);
    return res.json(generated.output);
  } catch (err) {
    await run(
      `INSERT INTO task_outputs(task_id, language, analysis, service, pricing, proposalDraft, emailDraft, upsell, raw_output, input_tokens, output_tokens)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(task_id) DO UPDATE SET raw_output=excluded.raw_output, updated_at=NOW()`,
      [taskId, task.language, '', '', '', '', '', '', String(err.message || err), 0, 0]
    );
    return res.status(500).json({ error: 'Generation failed', details: String(err.message || err) });
  }
});

app.get('/api/tasks', requireAuth, async (req, res) => {
  const moduleCode = clampText(req.query.module, 50).toLowerCase();
  const q = clampText(req.query.q, 255).toLowerCase();
  const params = [];
  let query = `
    SELECT t.id, t.module, t.language, t.status, t.lead_text, t.created_at, u.name as creator_name
    FROM tasks t
    LEFT JOIN users u ON u.id=t.created_by
    WHERE 1=1
  `;
  if (moduleCode) {
    query += ' AND t.module=?';
    params.push(moduleCode);
  }
  if (q) {
    query += ' AND LOWER(t.lead_text) LIKE ?';
    params.push(`%${q}%`);
  }
  query += ' ORDER BY t.id DESC LIMIT 200';
  const rows = await all(query, params);
  await logUsage('/api/tasks', req, req.user.id);
  res.json(rows);
});

app.get('/api/tasks/:id', requireAuth, async (req, res) => {
  const task = await get('SELECT * FROM tasks WHERE id=?', [Number(req.params.id)]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  const output = await get('SELECT * FROM task_outputs WHERE task_id=?', [task.id]);
  await logUsage('/api/tasks/:id', req, req.user.id);
  res.json({ task, output });
});

app.patch('/api/tasks/:id/final', requireAuth, requireRole('agent'), async (req, res) => {
  const taskId = Number(req.params.id);
  const language = normalizeLanguage(req.body.language);
  const payload = {
    analysis: clampText(req.body.analysis),
    service: clampText(req.body.service),
    pricing: clampText(req.body.pricing),
    proposalDraft: clampText(req.body.proposalDraft),
    emailDraft: clampText(req.body.emailDraft),
    upsell: clampText(req.body.upsell)
  };

  await run(
    `INSERT INTO task_outputs(task_id, language, analysis, service, pricing, proposalDraft, emailDraft, upsell)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(task_id) DO UPDATE SET
      language=excluded.language,
      analysis=excluded.analysis,
      service=excluded.service,
      pricing=excluded.pricing,
      proposalDraft=excluded.proposalDraft,
      emailDraft=excluded.emailDraft,
      upsell=excluded.upsell,
      updated_at=NOW()`,
    [taskId, language, payload.analysis, payload.service, payload.pricing, payload.proposalDraft, payload.emailDraft, payload.upsell]
  );
  await run('UPDATE tasks SET updated_at=NOW() WHERE id=?', [taskId]);
  await logUsage('/api/tasks/:id/final', req, req.user.id);
  res.json({ ok: true });
});

app.post('/api/tasks/:id/approve', requireAuth, requireRole('manager'), async (req, res) => {
  await run('UPDATE tasks SET status=\'approved\', approved_by=?, approved_at=NOW(), updated_at=NOW() WHERE id=?', [
    req.user.id,
    Number(req.params.id)
  ]);
  await logUsage('/api/tasks/:id/approve', req, req.user.id);
  res.json({ ok: true });
});

app.get('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  const users = await all('SELECT id, email, name, role, is_active, last_login_at, created_at FROM users ORDER BY id DESC');
  await logUsage('/api/admin/users', req, req.user.id);
  res.json(users);
});

app.post('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  const email = clampText(req.body.email, 255).toLowerCase();
  const name = clampText(req.body.name, 255);
  const role = clampText(req.body.role, 20);
  const password = clampText(req.body.password, 255);
  if (!['admin', 'manager', 'agent', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (!email || !name || !password) return res.status(400).json({ error: 'Missing fields' });

  const hash = await bcrypt.hash(password, 10);
  const created = await run('INSERT INTO users(email, name, role, password_hash, is_active) VALUES(?,?,?,?,true)', [email, name, role, hash]);
  await logUsage('/api/admin/users', req, req.user.id);
  res.json({ id: created.lastID });
});

app.patch('/api/admin/users/:id/status', requireAuth, requireRole('admin'), async (req, res) => {
  const isActive = Boolean(req.body.isActive);
  await run('UPDATE users SET is_active=?, updated_at=NOW() WHERE id=?', [isActive, Number(req.params.id)]);
  await logUsage('/api/admin/users/:id/status', req, req.user.id);
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  const password = clampText(req.body.password, 255);
  if (!password) return res.status(400).json({ error: 'Password required' });
  const hash = await bcrypt.hash(password, 10);
  await run('UPDATE users SET password_hash=?, updated_at=NOW() WHERE id=?', [hash, Number(req.params.id)]);
  await logUsage('/api/admin/users/:id/reset-password', req, req.user.id);
  res.json({ ok: true });
});

function registerCrudRoutes(basePath, minRole, tableName, fieldConfig) {
  app.get(basePath, requireAuth, requireRole(minRole), async (req, res) => {
    const rows = await all(`SELECT * FROM ${tableName} ORDER BY id DESC LIMIT 300`);
    res.json(rows);
  });

  app.post(basePath, requireAuth, requireRole(minRole), async (req, res) => {
    const fields = fieldConfig.map((f) => f.name);
    const values = fieldConfig.map((f) => clampText(req.body[f.name], f.max || 4000));
    if (fields.includes('created_by')) {
      const idx = fields.indexOf('created_by');
      values[idx] = req.user.id;
    }
    if (fields.includes('is_active')) {
      const idx = fields.indexOf('is_active');
      values[idx] = String(values[idx]).toLowerCase() === 'true' || values[idx] === true || values[idx] === '1';
    }
    const placeholders = fields.map(() => '?').join(',');
    const result = await run(`INSERT INTO ${tableName}(${fields.join(',')}) VALUES(${placeholders})`, values);
    res.json({ id: result.lastID });
  });

  app.put(`${basePath}/:id`, requireAuth, requireRole(minRole), async (req, res) => {
    const assignments = [];
    const params = [];
    for (const field of fieldConfig) {
      if (field.name === 'created_by') continue;
      assignments.push(`${field.name}=?`);
      params.push(clampText(req.body[field.name], field.max || 4000));
    }
    params.push(Number(req.params.id));
    await run(`UPDATE ${tableName} SET ${assignments.join(',')} WHERE id=?`, params);
    res.json({ ok: true });
  });

  app.delete(`${basePath}/:id`, requireAuth, requireRole(minRole), async (req, res) => {
    await run(`DELETE FROM ${tableName} WHERE id=?`, [Number(req.params.id)]);
    res.json({ ok: true });
  });
}

registerCrudRoutes('/api/admin/prompts', 'manager', 'prompts', [
  { name: 'module', max: 40 },
  { name: 'language', max: 5 },
  { name: 'version', max: 10 },
  { name: 'content', max: 4000 },
  { name: 'is_active', max: 1 },
  { name: 'created_by', max: 20 }
]);

registerCrudRoutes('/api/admin/knowledge', 'manager', 'knowledge_snippets', [
  { name: 'title', max: 255 },
  { name: 'body', max: 4000 },
  { name: 'tags', max: 255 },
  { name: 'language', max: 5 },
  { name: 'created_by', max: 20 }
]);

registerCrudRoutes('/api/admin/templates', 'manager', 'templates', [
  { name: 'module', max: 40 },
  { name: 'language', max: 5 },
  { name: 'template_type', max: 40 },
  { name: 'title', max: 255 },
  { name: 'body', max: 4000 },
  { name: 'is_active', max: 1 },
  { name: 'created_by', max: 20 }
]);

registerCrudRoutes('/api/admin/pricing', 'manager', 'pricing_rules', [
  { name: 'module', max: 40 },
  { name: 'service', max: 255 },
  { name: 'min_price', max: 40 },
  { name: 'max_price', max: 40 },
  { name: 'currency', max: 10 },
  { name: 'notes', max: 500 },
  { name: 'created_by', max: 20 }
]);

app.get('/api/usage/local', requireAuth, requireRole('manager'), async (req, res) => {
  const totals = await get('SELECT COUNT(*) as requests FROM usage_logs');
  const last24h = await get("SELECT COUNT(*) as requests FROM usage_logs WHERE created_at >= NOW() - INTERVAL '24 hours'");
  const tokens = await get('SELECT COALESCE(SUM(tokens_in),0) as inTokens, COALESCE(SUM(tokens_out),0) as outTokens FROM usage_logs');
  res.json({
    totalRequests: totals.requests,
    last24hRequests: last24h.requests,
    inputTokens: tokens.inTokens,
    outputTokens: tokens.outTokens
  });
});

app.options('/api/public/generate', (req, res) => {
  const origin = req.headers.origin;
  if (origin && PUBLIC_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.status(204).end();
});

app.post('/api/public/generate', publicGenerateLimiter, requireBodyField('leadText'), async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !PUBLIC_ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (origin && PUBLIC_ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  const turnstile = await verifyTurnstile(req.body.turnstileToken, req.ip);
  if (!turnstile.ok) return res.status(400).json({ error: turnstile.error, details: turnstile.details || [] });

  const language = normalizeLanguage(req.body.language);
  const payload = {
    leadText: clampText(req.body.leadText),
    company: clampText(req.body.company, 255),
    industry: clampText(req.body.industry, 255),
    budget: clampText(req.body.budget, 255),
    timeline: clampText(req.body.timeline, 255)
  };

  if (STORE_PUBLIC_REQUESTS) {
    await run('INSERT INTO public_requests(ip, language, lead_text) VALUES(?,?,?)', [req.ip, language, payload.leadText]);
  } else {
    await run('INSERT INTO public_requests(ip, language, lead_text) VALUES(?,?,NULL)', [req.ip, language]);
  }

  const prompt = await resolvePrompt('offers', language);
  const snippets = await resolveKnowledge(language, 'offers', payload.leadText);
  const templates = await resolveTemplates('offers', language);
  const pricing = await resolvePricing('offers');

  const generated = await generateStructuredOutput({
    module: 'offers',
    language,
    payload,
    prompt,
    snippets,
    templates,
    pricing
  });

  await logUsage('/api/public/generate', req, null, generated.usage.inputTokens, generated.usage.outputTokens);
  res.json(generated.output);
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: 'Server error', details: String(err.message || err) });
});

(async () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  try {
    await get('SELECT 1');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Anagami AI Core listening on http://localhost:${PORT}`);
  });
})();
