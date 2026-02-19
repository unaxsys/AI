const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DEFAULT_MODULES = ['email', 'offers', 'contracts', 'support', 'marketing', 'recruiting', 'admin'];
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function buildConnectionConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PG_SSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
    };
  }

  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'anagami',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || ''
  };
}

const pool = new Pool(buildConnectionConfig());

function convertPlaceholders(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => {
    idx += 1;
    return `$${idx}`;
  });
}

async function run(sql, params = []) {
  let text = sql.trim();
  const isInsert = /^insert\s+/i.test(text);
  const hasReturning = /\breturning\b/i.test(text);
  if (isInsert && !hasReturning) {
    text = `${text} RETURNING id`;
  }
  const query = convertPlaceholders(text);
  const result = await pool.query(query, params);
  return {
    rowCount: result.rowCount,
    lastID: result.rows[0]?.id || null,
    rows: result.rows
  };
}

async function get(sql, params = []) {
  const query = convertPlaceholders(sql);
  const result = await pool.query(query, params);
  return result.rows[0] || null;
}

async function all(sql, params = []) {
  const query = convertPlaceholders(sql);
  const result = await pool.query(query, params);
  return result.rows;
}

async function applyMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    const already = await get('SELECT 1 FROM schema_migrations WHERE filename = ?', [filename]);
    if (already) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function defaultSalesPrompt(language = 'bg') {
  if (language === 'en') {
    return 'You are Anagami Sales Proposal Agent. Produce practical, ethical and transparent sales drafts. Return STRICT JSON with keys: analysis, service, pricing, proposalDraft, emailDraft, upsell. Never promise guaranteed outcomes. Include pricing uncertainty disclaimer if needed.';
  }
  return 'Ти си Anagami Sales Proposal Agent. Създаваш практични, етични и прозрачни оферти. Връщай САМО JSON с ключове: analysis, service, pricing, proposalDraft, emailDraft, upsell. Не обещавай гарантирани резултати. При несигурност добавяй дисклеймър за цената.';
}

async function seedAdmin() {
  const existingUser = await get('SELECT id FROM users LIMIT 1');
  if (existingUser) return;

  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const name = String(process.env.ADMIN_NAME || 'Admin').trim() || 'Admin';
  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for first seed.');
  }

  const hash = await bcrypt.hash(password, 10);
  await run('INSERT INTO users(email, name, role, password_hash, is_active) VALUES(?,?,?,?,?)', [email, name, 'admin', hash, true]);
}

async function seedDefaultPrompts() {
  const bgPrompt = await get('SELECT id FROM prompts WHERE module=? AND language=? AND is_active=true LIMIT 1', ['offers', 'bg']);
  if (!bgPrompt) {
    await run(
      'INSERT INTO prompts(module, language, version, content, is_active) VALUES(?,?,?,?,?)',
      ['offers', 'bg', 1, defaultSalesPrompt('bg'), true]
    );
  }

  const enPrompt = await get('SELECT id FROM prompts WHERE module=? AND language=? AND is_active=true LIMIT 1', ['offers', 'en']);
  if (!enPrompt) {
    await run(
      'INSERT INTO prompts(module, language, version, content, is_active) VALUES(?,?,?,?,?)',
      ['offers', 'en', 1, defaultSalesPrompt('en'), true]
    );
  }
}

async function initDb() {
  await pool.query('SELECT 1');
  await applyMigrations();
  await seedAdmin();
  await seedDefaultPrompts();
}

async function closeDb() {
  await pool.end();
}

module.exports = {
  DEFAULT_MODULES,
  pool,
  initDb,
  initializeDb: initDb,
  closeDb,
  run,
  get,
  all,
  defaultSalesPrompt
};
