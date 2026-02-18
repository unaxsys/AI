require("dotenv").config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { proposalLimiter } = require('./rateLimit');
const { generateProposal } = require('./openai');

const app = express();
const port = Number(process.env.PORT || 8787);

if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY environment variable.');
  process.exit(1);
}

if (!process.env.SITE_API_KEY) {
  console.error('Missing SITE_API_KEY environment variable.');
  process.exit(1);
}

const dbPath = path.join(__dirname, 'data', 'technical_logs.db');
const db = new sqlite3.Database(dbPath);

function initDb() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    db.run(`
      DELETE FROM request_logs
      WHERE id NOT IN (
        SELECT id FROM request_logs ORDER BY id DESC LIMIT 100
      )
    `);
  });
}

function logTechnicalData(ip, endpoint, statusCode) {
  db.run(
    `INSERT INTO request_logs (ip, endpoint, status_code, created_at) VALUES (?, ?, ?, ?)`,
    [ip, endpoint, statusCode, new Date().toISOString()],
    (err) => {
      if (err) {
        console.error('DB log failed:', err.message);
      }
      db.run(`
        DELETE FROM request_logs
        WHERE id NOT IN (
          SELECT id FROM request_logs ORDER BY id DESC LIMIT 100
        )
      `);
    }
  );
}

initDb();

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use('/public', express.static(path.join(__dirname, 'public')));

function getIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

function sanitizeText(input) {
  return String(input || '').replace(/\s+/g, ' ').trim();
}

function isSpamLike(text) {
  const lower = text.toLowerCase();
  if ((lower.match(/https?:\/\//g) || []).length > 3) return true;
  if ((lower.match(/\b(bitcoin|casino|viagra|loan)\b/g) || []).length > 0) return true;
  if (/([a-zа-я])\1{9,}/i.test(lower)) return true;
  return false;
}

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const htmlTemplate = fs.readFileSync(indexPath, 'utf8');
  const html = htmlTemplate.replace('{{SITE_API_KEY}}', process.env.SITE_API_KEY);
  res.type('html').send(html);
});

app.post('/api/generate', proposalLimiter, async (req, res) => {
  const ip = getIp(req);
  const siteApiKey = req.header('x-site-api-key');

  if (!siteApiKey || siteApiKey !== process.env.SITE_API_KEY) {
    logTechnicalData(ip, '/api/generate', 401);
    return res.status(401).json({ error: 'Невалиден достъп. Моля, презаредете страницата.' });
  }

  const leadText = sanitizeText(req.body.leadText);
  const company_name = sanitizeText(req.body.company_name);
  const industry = sanitizeText(req.body.industry);
  const approximate_budget = sanitizeText(req.body.approximate_budget);
  const expected_timeline = sanitizeText(req.body.expected_timeline);

  if (!leadText) {
    logTechnicalData(ip, '/api/generate', 400);
    return res.status(400).json({ error: 'Полето „Опишете вашето запитване“ е задължително.' });
  }

  if (leadText.length > 4000) {
    logTechnicalData(ip, '/api/generate', 400);
    return res.status(400).json({ error: 'Запитването е твърде дълго. Максимум 4000 символа.' });
  }

  if (leadText.length < 20 || isSpamLike(leadText)) {
    logTechnicalData(ip, '/api/generate', 400);
    return res.status(400).json({ error: 'Моля, въведете по-конкретно и валидно бизнес запитване.' });
  }

  try {
    const result = await generateProposal({
      leadText,
      company_name,
      industry,
      approximate_budget,
      expected_timeline
    });

    logTechnicalData(ip, '/api/generate', 200);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Generation error:', error.message);
    logTechnicalData(ip, '/api/generate', 500);
    return res.status(500).json({
      error:
        'Възникна временен проблем при генерирането. Моля, опитайте отново след малко.'
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ресурсът не е намерен.' });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
