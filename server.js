require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { pool, initSchema } = require('./src/db');
const { runAgent } = require('./src/agent');
const { transcribe } = require('./src/transcribe');
const tasks = require('./src/skills/tasks');
const projects = require('./src/skills/projects');
const journal = require('./src/skills/journal');

const app = express();

// Hostinger's CDN caches static files at the edge, so a deploy alone does not
// reach browsers. Stamping asset URLs with a per-boot id makes each deploy a
// distinct object the CDN has never seen.
const BUILD_ID = Date.now().toString(36);

function page(name) {
  return fs
    .readFileSync(path.join(__dirname, 'public', name), 'utf8')
    .replace(/(src|href)="\/([\w.-]+\.(?:js|css))"/g, `$1="/$2?v=${BUILD_ID}"`);
}

const INDEX_HTML = page('index.html');
const LOGIN_HTML = page('login.html');

function sendPage(res, html) {
  res.set('Cache-Control', 'no-store').type('html').send(html);
}
app.use(cors({ origin: true, credentials: true }));
// Voice clips arrive as base64 in the JSON body, so the default 100kb cap is
// far too small.
app.use(express.json({ limit: '25mb' }));
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
app.get('/login.html', (req, res) => sendPage(res, LOGIN_HTML));

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!process.env.JARVIS_PASSWORD) {
    return res.status(500).json({ error: 'JARVIS_PASSWORD is not set on the server. Add it in your environment variables.' });
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
app.get('/', (req, res) => sendPage(res, INDEX_HTML));

// Code must revalidate on every load, or a deploy leaves browsers running the
// previous build. The wake-word model is large and immutable, so it may cache.
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
      else if (filePath.endsWith('.pv')) res.setHeader('Cache-Control', 'public, max-age=604800');
    },
  })
);

// Wrap async route handlers so thrown errors become clean 500s instead of crashing
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// --- Chat with the agent ---
app.post('/api/chat', wrap(async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server. Add it in your environment variables.' });
  }
  const reply = await runAgent(message);
  res.json({ reply });
}));

// --- Voice: transcribe a recorded clip, and hand the browser its wake-word key ---
app.post('/api/transcribe', wrap(async (req, res) => {
  const { audio, mimeType } = req.body || {};
  if (!audio) return res.status(400).json({ error: 'audio is required' });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not set on the server.' });
  }
  res.json({ text: await transcribe(audio, mimeType) });
}));

app.get('/api/config', (req, res) => {
  res.json({ picovoiceKey: process.env.PICOVOICE_ACCESS_KEY || '' });
});

app.get('/api/messages', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM messages ORDER BY id ASC');
  res.json(rows);
}));

// --- Direct data access for dashboard widgets (bypasses the agent for speed) ---
app.get('/api/tasks', wrap(async (req, res) => res.json(await tasks.listTasks())));
app.post('/api/tasks', wrap(async (req, res) => res.json(await tasks.addTask(req.body))));
app.post('/api/tasks/:id/complete', wrap(async (req, res) =>
  res.json(await tasks.completeTask({ id: Number(req.params.id) }))
));

app.get('/api/projects', wrap(async (req, res) => res.json(await projects.listProjects())));
app.post('/api/projects', wrap(async (req, res) => res.json(await projects.addProject(req.body))));
app.patch('/api/projects/:id', wrap(async (req, res) =>
  res.json(await projects.updateProject({ id: Number(req.params.id), ...req.body }))
));

app.get('/api/journal', wrap(async (req, res) => res.json(await journal.listEntries())));
app.post('/api/journal', wrap(async (req, res) => res.json(await journal.addEntry(req.body))));

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Jarvis is running at http://localhost:${PORT}`);
      if (!process.env.GEMINI_API_KEY) {
        console.warn('WARNING: GEMINI_API_KEY not set. Add it in your environment variables.');
      }
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err.message);
    process.exit(1);
  });
