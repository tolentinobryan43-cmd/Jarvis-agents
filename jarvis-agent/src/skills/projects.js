const db = require('../db');

function addProject({ name, description = '', goal_revenue = null }) {
  const stmt = db.prepare('INSERT INTO projects (name, description, goal_revenue) VALUES (?, ?, ?)');
  const info = stmt.run(name, description, goal_revenue);
  return { id: info.lastInsertRowid, name, description, goal_revenue, status: 'idea' };
}

function updateProject({ id, status = null, notes = null }) {
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!existing) return { error: `No project with id ${id}` };
  const newStatus = status || existing.status;
  const newNotes = notes !== null ? notes : existing.notes;
  db.prepare("UPDATE projects SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newStatus, newNotes, id);
  return { id, status: newStatus, notes: newNotes };
}

function listProjects() {
  return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
}

module.exports = { addProject, updateProject, listProjects };
