const { pool } = require('../db');

async function addEntry({ mood = null, content }) {
  const [result] = await pool.query('INSERT INTO journal (mood, content) VALUES (?, ?)', [mood, content]);
  return { id: result.insertId, mood, content };
}

async function listEntries({ limit = 20 } = {}) {
  const [rows] = await pool.query('SELECT * FROM journal ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows;
}

module.exports = { addEntry, listEntries };
