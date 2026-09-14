require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const db = require('./src/db');
const { runAgent } = require('./src/agent');
const tasks = require('./src/skills/tasks');
const projects = require('./src/skills/projects');
const journal = require('./src/skills/journal');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'insecure-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

// --- Auth: everything below requires a password, everything above (login page/route) doesn't ---
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.JARVIS_PASSWORD) {
    return res.status(500).json({ error: 'JARVIS_PASSWORD is not set on the server. Add it to .env.' });
  }
  if (password === process.env.JARVIS_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not logged in' });
  return res.redirect('/login.html');
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

// --- Chat with the agent ---
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server. Copy .env.example to .env and add your key.' });
    }
    const reply = await runAgent(message);
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', (req, res) => {
  const rows = db.prepare('SELECT * FROM messages ORDER BY id ASC').all();
  res.json(rows);
});

// --- Direct data access for dashboard widgets (bypasses the agent for speed) ---
app.get('/api/tasks', (req, res) => res.json(tasks.listTasks()));
app.post('/api/tasks', (req, res) => res.json(tasks.addTask(req.body)));
app.post('/api/tasks/:id/complete', (req, res) => res.json(tasks.completeTask({ id: Number(req.params.id) })));

app.get('/api/projects', (req, res) => res.json(projects.listProjects()));
app.post('/api/projects', (req, res) => res.json(projects.addProject(req.body)));
app.patch('/api/projects/:id', (req, res) =>
  res.json(projects.updateProject({ id: Number(req.params.id), ...req.body }))
);

app.get('/api/journal', (req, res) => res.json(journal.listEntries()));
app.post('/api/journal', (req, res) => res.json(journal.addEntry(req.body)));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Jarvis is running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('WARNING: ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key.');
  }
});
