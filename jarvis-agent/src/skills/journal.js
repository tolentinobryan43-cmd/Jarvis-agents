const db = require('../db');

function addEntry({ mood = null, content }) {
  const stmt = db.prepare('INSERT INTO journal (mood, content) VALUES (?, ?)');
  const info = stmt.run(mood, content);
  return { id: info.lastInsertRowid, mood, content };
}

function listEntries({ limit = 20 } = {}) {
  return db.prepare('SELECT * FROM journal ORDER BY created_at DESC LIMIT ?').all(limit);
}

module.exports = { addEntry, listEntries };
