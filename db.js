const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const bcrypt = require('bcryptjs');

const execFileAsync = promisify(execFile);
const DB_PATH = path.join(__dirname, 'data', 'anagami.sqlite');
const DEFAULT_MODULES = ['email', 'offers', 'contracts', 'support', 'marketing', 'recruiting', 'admin'];

function ensureDbPath() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function quote(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

function bind(sql, params = []) {
  let index = 0;
  return sql.replace(/\?/g, () => quote(params[index++]));
}

async function execSql(sql, json = false) {
  ensureDbPath();
  const args = [DB_PATH];
  if (json) args.push('-json');
  args.push(sql);
  const { stdout } = await execFileAsync('sqlite3', args);
  return stdout;
}

async function run(sql, params = []) {
  const finalSql = `BEGIN; ${bind(sql, params)}; SELECT last_insert_rowid() as lastID, changes() as changes; COMMIT;`;
  const out = await execSql(finalSql, true);
  const rows = JSON.parse(out || '[]');
  return rows[0] || { lastID: 0, changes: 0 };
}

async function get(sql, params = []) {
  const out = await execSql(`${bind(sql, params)};`, true);
  const rows = JSON.parse(out || '[]');
  return rows[0] || null;
}

async function all(sql, params = []) {
  const out = await execSql(`${bind(sql, params)};`, true);
  return JSON.parse(out || '[]');
}

async function initializeDb() {
  ensureDbPath();
  await execSql(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','manager','agent','viewer')),
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      language TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS knowledge_snippets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags TEXT NOT NULL,
      language TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      language TEXT NOT NULL,
      template_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pricing_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      service TEXT NOT NULL,
      min_price REAL,
      max_price REAL,
      currency TEXT NOT NULL DEFAULT 'BGN',
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      language TEXT NOT NULL,
      lead_text TEXT NOT NULL,
      company TEXT,
      industry TEXT,
      budget TEXT,
      timeline TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
      created_by INTEGER,
      approved_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS task_outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER UNIQUE NOT NULL,
      language TEXT NOT NULL,
      analysis TEXT NOT NULL,
      service TEXT NOT NULL,
      pricing TEXT NOT NULL,
      proposalDraft TEXT NOT NULL,
      emailDraft TEXT NOT NULL,
      upsell TEXT NOT NULL,
      raw_output TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL,
      ip TEXT,
      user_id INTEGER,
      tokens_in INTEGER,
      tokens_out INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS public_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT,
      language TEXT,
      lead_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const existingUser = await get('SELECT id FROM users LIMIT 1');
  if (!existingUser) {
    const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = String(process.env.ADMIN_PASSWORD || '');
    if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required for first seed.');
    const hash = await bcrypt.hash(password, 10);
    await run('INSERT INTO users(email, name, role, password_hash, is_active) VALUES(?,?,?,?,1)', [email, 'System Admin', 'admin', hash]);
  }

  const hasPromptBg = await get('SELECT id FROM prompts WHERE module=? AND language=? AND is_active=1 LIMIT 1', ['offers', 'bg']);
  if (!hasPromptBg) {
    await run('INSERT INTO prompts(module, language, version, content, is_active) VALUES(?,?,?,?,1)', ['offers', 'bg', 1, defaultSalesPrompt('bg')]);
  }

  const hasPromptEn = await get('SELECT id FROM prompts WHERE module=? AND language=? AND is_active=1 LIMIT 1', ['offers', 'en']);
  if (!hasPromptEn) {
    await run('INSERT INTO prompts(module, language, version, content, is_active) VALUES(?,?,?,?,1)', ['offers', 'en', 1, defaultSalesPrompt('en')]);
  }
}

function defaultSalesPrompt(language = 'bg') {
  if (language === 'en') {
    return 'You are Anagami Sales Proposal Agent. Produce practical, ethical and transparent sales drafts. Return STRICT JSON with keys: analysis, service, pricing, proposalDraft, emailDraft, upsell. Never promise guaranteed outcomes. Include pricing uncertainty disclaimer if needed.';
  }
  return 'Ти си Anagami Sales Proposal Agent. Създаваш практични, етични и прозрачни оферти. Връщай САМО JSON с ключове: analysis, service, pricing, proposalDraft, emailDraft, upsell. Не обещавай гарантирани резултати. При несигурност добавяй дисклеймър за цената.';
}

module.exports = { DEFAULT_MODULES, DB_PATH, run, get, all, initializeDb, defaultSalesPrompt };
