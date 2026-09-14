const { pool } = require('../db');

async function addTask({ title, priority = 'medium', due_date = null }) {
  const [result] = await pool.query(
    'INSERT INTO tasks (title, priority, due_date) VALUES (?, ?, ?)',
    [title, priority, due_date]
  );
  return { id: result.insertId, title, priority, due_date, status: 'open' };
}

async function listTasks({ status = null } = {}) {
  if (status) {
    const [rows] = await pool.query(
      'SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at ASC',
      [status]
    );
    return rows;
  }
  const [rows] = await pool.query(
    'SELECT * FROM tasks ORDER BY status ASC, priority DESC, created_at ASC'
  );
  return rows;
}

async function completeTask({ id }) {
  await pool.query("UPDATE tasks SET status='done', completed_at=NOW() WHERE id = ?", [id]);
  return { id, status: 'done' };
}

module.exports = { addTask, listTasks, completeTask };
