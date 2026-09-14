const db = require('../db');

function addTask({ title, priority = 'medium', due_date = null }) {
  const stmt = db.prepare('INSERT INTO tasks (title, priority, due_date) VALUES (?, ?, ?)');
  const info = stmt.run(title, priority, due_date);
  return { id: info.lastInsertRowid, title, priority, due_date, status: 'open' };
}

function listTasks({ status = null } = {}) {
  if (status) {
    return db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at ASC').all(status);
  }
  return db.prepare('SELECT * FROM tasks ORDER BY status ASC, priority DESC, created_at ASC').all();
}

function completeTask({ id }) {
  db.prepare("UPDATE tasks SET status='done', completed_at=datetime('now') WHERE id = ?").run(id);
  return { id, status: 'done' };
}

module.exports = { addTask, listTasks, completeTask };
