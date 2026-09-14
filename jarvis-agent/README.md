# Jarvis — a real agent, not a static dashboard

This is a full-stack app: an Express backend running an actual agent loop against
the Claude API, with persistent memory (SQLite) and a dashboard frontend. Jarvis
has a **role** (system prompt defining his job) and **skills** (functions he can
actually call, not just talk about).

## What "agent with role and skills" means here

- **Role**: `src/agent.js` → `ROLE` — his job description and priorities
  (track your life, push money-making projects forward, give grounded advice).
- **Skills**: `src/skills/` — each file is a capability (tasks, projects, journal,
  briefing). `src/skills/index.js` exposes them to Claude as callable tools. When
  you tell Jarvis "add a task" or "start tracking this idea," he actually calls
  `add_task` / `add_project` and it's saved to the database — it's not roleplay.
- **Memory**: `jarvis.db` (SQLite, created on first run) stores tasks, projects,
  journal entries, and full chat history, so Jarvis has continuity across sessions.
- **Loop**: `runAgent()` lets Claude call tools repeatedly (up to 6 steps) before
  answering, so it can e.g. pull a full summary, then log three tasks, then reply.

## Setup

```bash
cd jarvis-agent
npm install
cp .env.example .env
# edit .env and paste in your Anthropic API key (from console.anthropic.com)
npm start
```

Open `http://localhost:3000`.

## Extending Jarvis with new skills

1. Add a function to an existing file in `src/skills/`, or create a new file there.
2. Register it in `src/skills/index.js` with a `schema` (what Claude sees) and a
   `run` (what actually executes).
3. Restart the server. Jarvis will start using it automatically — no prompt
   engineering needed beyond the tool description.

Ideas worth adding yourself:
- A real web-search tool (Anthropic's API supports a hosted `web_search` tool —
  see Anthropic's docs) so Jarvis can research money-making opportunities live.
- A daily cron job that calls `runAgent("Give me my morning briefing")` and emails
  or texts you the result.
- OAuth + a calendar/email API as more skills, so Jarvis can read (or with care,
  send) real messages.

## Honest limitations

- Jarvis cannot browse the web, move money, or act outside this database unless
  you add tools that let him — he's told this in his role prompt so he won't
  pretend otherwise.
- This runs on your machine/server with your own API key and bears normal Claude
  API costs per message (small, but not free).
- Single-user, no auth — don't deploy this publicly without adding login
  protection, since anyone who reaches it can read/write your data.

## Project structure

```
jarvis-agent/
├── server.js              Express app, REST routes
├── src/
│   ├── agent.js            Role + tool-calling loop
│   ├── db.js                SQLite schema
│   └── skills/
│       ├── tasks.js
│       ├── projects.js
│       ├── journal.js
│       ├── briefing.js
│       └── index.js         Registers skills as Claude tools
└── public/                 Dashboard (vanilla HTML/CSS/JS)
```
