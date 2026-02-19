require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf8');
    await client.query(sql);
    console.log('Migration complete');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
