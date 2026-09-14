const chatLog = document.getElementById('chat-log');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

async function loadHistory() {
  const res = await fetch('/api/messages');
  if (res.status === 401) return (window.location.href = '/login.html');
  const rows = await res.json();
  chatLog.innerHTML = '';
  if (rows.length === 0) {
    addMsg('assistant', "I'm Jarvis. Tell me what's going on — a task, an idea, how your day's going — and I'll take it from there.");
  }
  rows.forEach((r) => addMsg(r.role, r.content));
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  addMsg('user', text);
  const pending = addMsg('assistant pending', 'thinking…');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    pending.remove();
    if (data.error) {
      addMsg('assistant', `Error: ${data.error}`);
    } else {
      addMsg('assistant', data.reply);
      refreshWidgets();
    }
  } catch (err) {
    pending.remove();
    addMsg('assistant', `Connection error: ${err.message}`);
  }
});

// --- Widgets ---

async function refreshTasks() {
  const res = await fetch('/api/tasks');
  const tasks = await res.json();
  const list = document.getElementById('task-list');
  list.innerHTML = '';
  if (tasks.length === 0) { list.innerHTML = '<li class="empty">No tasks yet.</li>'; return; }
  tasks.forEach((t) => {
    const li = document.createElement('li');
    li.className = `item priority-${t.priority} status-${t.status}`;
    li.innerHTML = `
      <div>
        <div class="item-title">${escapeHtml(t.title)}</div>
        <div class="item-meta">${t.priority}${t.due_date ? ' · ' + t.due_date : ''}</div>
      </div>
      ${t.status === 'open' ? '<div class="item-check" title="Mark done"></div>' : ''}
    `;
    if (t.status === 'open') {
      li.querySelector('.item-check').addEventListener('click', async () => {
        await fetch(`/api/tasks/${t.id}/complete`, { method: 'POST' });
        refreshTasks();
      });
    }
    list.appendChild(li);
  });
}

async function refreshProjects() {
  const res = await fetch('/api/projects');
  const projects = await res.json();
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  if (projects.length === 0) { list.innerHTML = '<li class="empty">No projects yet.</li>'; return; }
  projects.forEach((p) => {
    const li = document.createElement('li');
    li.className = `item status-${p.status}`;
    li.innerHTML = `
      <div>
        <div class="item-title">${escapeHtml(p.name)}</div>
        <div class="item-meta">${p.status}${p.goal_revenue ? ' · $' + p.goal_revenue : ''}</div>
      </div>
    `;
    list.appendChild(li);
  });
}

async function refreshJournal() {
  const res = await fetch('/api/journal');
  const entries = await res.json();
  const list = document.getElementById('journal-list');
  list.innerHTML = '';
  if (entries.length === 0) { list.innerHTML = '<li class="empty">No entries yet.</li>'; return; }
  entries.slice(0, 6).forEach((j) => {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `
      <div>
        <div class="item-title">${escapeHtml(j.content)}</div>
        <div class="item-meta">${j.mood || ''} ${new Date(j.created_at).toLocaleDateString()}</div>
      </div>
    `;
    list.appendChild(li);
  });
}

function refreshWidgets() {
  refreshTasks();
  refreshProjects();
  refreshJournal();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('add-task-btn').addEventListener('click', async () => {
  const title = prompt('Task title:');
  if (!title) return;
  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, priority: 'medium' }),
  });
  refreshTasks();
});

document.getElementById('add-project-btn').addEventListener('click', async () => {
  const name = prompt('Project name:');
  if (!name) return;
  await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  refreshProjects();
});

async function checkStatus() {
  try {
    const res = await fetch('/api/tasks');
    if (res.ok) {
      statusEl.className = 'status online';
      statusText.textContent = 'online';
    } else throw new Error();
  } catch {
    statusEl.className = 'status offline';
    statusText.textContent = 'offline';
  }
}

loadHistory();
refreshWidgets();
checkStatus();
