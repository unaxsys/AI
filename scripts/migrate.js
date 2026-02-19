require('dotenv').config();
const { initializeDb, DB_PATH } = require('../db');

initializeDb()
  .then(() => {
    console.log(`SQLite schema ready at ${DB_PATH}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
