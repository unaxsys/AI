require('dotenv').config();
const { initDb, closeDb } = require('../db');

initDb()
  .then(async () => {
    console.log('PostgreSQL migrations applied successfully.');
    await closeDb();
  })
  .catch(async (err) => {
    console.error('Migration failed:', err.message);
    try {
      await closeDb();
    } catch (_e) {}
    process.exit(1);
  });
