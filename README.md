# Jarvis — a real agent, not a static dashboard

This is a full-stack app: an Express backend running an actual agent loop against
the Gemini API, with persistent memory (SQLite) and a dashboard frontend. Jarvis
has a **role** (system prompt defining his job) and **skills** (functions he can
actually call, not just talk about).

## What "agent with role and skills" means here

- **Role**: `src/agent.js` → `ROLE` — his job description and priorities
  (track your life, push money-making projects forward, give grounded advice).
- **Skills**: `src/skills/` — each file is a capability (tasks, projects, journal,
  briefing). `src/skills/index.js` exposes them to Gemini as callable tools. When
  you tell Jarvis "add a task" or "start tracking this idea," he actually calls
  `add_task` / `add_project` and it's saved to the database — it's not roleplay.
- **Memory**: MySQL database (on Hostinger, their managed database; locally,
  any MySQL/MariaDB server) storing tasks, projects, journal entries, and full
  chat history — persists across restarts and redeploys.
- **Loop**: `runAgent()` lets Gemini call tools repeatedly (up to 6 steps) before
  answering, so it can e.g. pull a full summary, then log three tasks, then reply.

## Setup (local development)

You'll need a local MySQL/MariaDB server running (or point `DB_HOST` etc. at
any remote MySQL instance).

```bash
cd jarvis-agent
npm install
cp .env.example .env
# edit .env: paste your Gemini API key (from ai.google.dev, no billing required
# for the free tier), set a password, and fill in your MySQL connection details
npm start
```

Open `http://localhost:3000`. The database tables are created automatically
on first boot — no migration step needed.

## Deploying to Hostinger (Business/Cloud hosting)

Hostinger's managed Node.js app hosting has **ephemeral file storage** — a
SQLite file would be wiped on every redeploy or restart. That's why this app
uses MySQL instead, via Hostinger's built-in managed database.

1. **Push the code to GitHub** (or prepare a ZIP) — GitHub deploys are faster
   since Hostinger auto-redeploys on every push.
2. In **hPanel → Websites → [your site] → Databases**, create a MySQL
   database and note the name, username, and password.
3. In **hPanel**, start a **Node.js app** deployment: connect the GitHub repo
   (or upload the ZIP), and when prompted, **connect the MySQL database** —
   Hostinger will automatically wire up `DB_HOST`, `DB_PORT`, `DB_USER`,
   `DB_PASSWORD`, and `DB_NAME` for you.
4. Add the remaining environment variables manually in the same screen:
   `GEMINI_API_KEY`, `JARVIS_PASSWORD`, `SESSION_SECRET`.
5. Deploy. Hostinger runs `npm install` and starts the app automatically.
6. Once live, open the app's URL — you'll land on the login page.

## Extending Jarvis with new skills

1. Add a function to an existing file in `src/skills/`, or create a new file there.
2. Register it in `src/skills/index.js` with a `schema` (what Gemini sees) and a
   `run` (what actually executes).
3. Restart the server. Jarvis will start using it automatically — no prompt
   engineering needed beyond the tool description.

Ideas worth adding yourself:
- A real web-search tool (Gemini's API supports Google Search grounding —
  see Google's docs) so Jarvis can research money-making opportunities live.
- A daily cron job that calls `runAgent("Give me my morning briefing")` and emails
  or texts you the result.
- OAuth + a calendar/email API as more skills, so Jarvis can read (or with care,
  send) real messages.

## Honest limitations

- Jarvis cannot browse the web, move money, or act outside this database unless
  you add tools that let him — he's told this in his role prompt so he won't
  pretend otherwise.
- This runs on your machine/server with your own API key. Gemini's free tier
  covers normal personal use (1,500 requests/day on Flash), but Google may use
  free-tier prompts/responses to improve its products — don't put anything in
  here you wouldn't want reviewed.
- Single-user, no auth — don't deploy this publicly without adding login
  protection, since anyone who reaches it can read/write your data.

## Project structure

```
jarvis-agent/
├── server.js              Express app, REST routes
├── src/
│   ├── agent.js            Role + tool-calling loop
│   ├── db.js                MySQL connection pool + schema init
│   └── skills/
│       ├── tasks.js
│       ├── projects.js
│       ├── journal.js
│       ├── briefing.js
│       └── index.js         Registers skills as Gemini tools
└── public/                 Dashboard (vanilla HTML/CSS/JS)
```
