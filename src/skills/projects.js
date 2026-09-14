const { pool } = require('../db');

async function addProject({ name, description = '', goal_revenue = null }) {
  const [result] = await pool.query(
    'INSERT INTO projects (name, description, goal_revenue) VALUES (?, ?, ?)',
    [name, description, goal_revenue]
  );
  return { id: result.insertId, name, description, goal_revenue, status: 'idea' };
}

async function updateProject({ id, status = null, notes = null }) {
  const [rows] = await pool.query('SELECT * FROM projects WHERE id = ?', [id]);
  const existing = rows[0];
  if (!existing) return { error: `No project with id ${id}` };
  const newStatus = status || existing.status;
  const newNotes = notes !== null ? notes : existing.notes;
  await pool.query('UPDATE projects SET status = ?, notes = ? WHERE id = ?', [newStatus, newNotes, id]);
  return { id, status: newStatus, notes: newNotes };
}

async function listProjects() {
  const [rows] = await pool.query('SELECT * FROM projects ORDER BY updated_at DESC');
  return rows;
}

module.exports = { addProject, updateProject, listProjects };
