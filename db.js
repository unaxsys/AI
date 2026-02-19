const { Pool } = require('pg');

const DEFAULT_MODULES = ['email', 'offers', 'contracts', 'support', 'marketing', 'recruiting', 'admin'];

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
  const result = await pool.query(convertPlaceholders(text), params);
  return {
    rowCount: result.rowCount,
    lastID: result.rows[0]?.id || null,
    rows: result.rows
  };
}

async function get(sql, params = []) {
  const result = await pool.query(convertPlaceholders(sql), params);
  return result.rows[0] || null;
}

async function all(sql, params = []) {
  const result = await pool.query(convertPlaceholders(sql), params);
  return result.rows;
}

function defaultSalesPrompt(language = 'bg') {
  if (language === 'en') {
    return 'You are Anagami Sales Proposal Agent. Produce practical, ethical and transparent sales drafts. Return STRICT JSON with keys: analysis, service, pricing, proposalDraft, emailDraft, upsell. Never promise guaranteed outcomes. Include pricing uncertainty disclaimer if needed.';
  }
  return 'Ти си Anagami Sales Proposal Agent. Създаваш практични, етични и прозрачни оферти. Връщай САМО JSON с ключове: analysis, service, pricing, proposalDraft, emailDraft, upsell. Не обещавай гарантирани резултати. При несигурност добавяй дисклеймър за цената.';
}

module.exports = {
  DEFAULT_MODULES,
  pool,
  run,
  get,
  all,
  defaultSalesPrompt
};
