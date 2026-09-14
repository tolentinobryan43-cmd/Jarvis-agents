const $ = (id) => document.getElementById(id);
const chatLog = $('chat-log');
const chatForm = $('chat-form');
const chatInput = $('chat-input');

const START = Date.now();
let busy = 0;          // 0 idle, 1 request in flight
let amp = 0.3;        // waveform amplitude, eased toward target

/* ═══════════ text helpers ═══════════ */

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function inlineMarks(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

// Escape first, then apply a small markdown subset, so agent output renders
// as formatted text rather than literal asterisks.
function renderRich(text) {
  const lines = escapeHtml(text).split('\n');
  let out = '';
  let inList = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[*-]\s+(.*)$/);
    const heading = line.match(/^\s*#{1,4}\s+(.*)$/);
    const boldOnly = line.match(/^\s*\*\*(.+?)\*\*:?\s*$/);

    if (bullet) {
      if (!inList) { out += '<ul>'; inList = true; }
      out += `<li>${inlineMarks(bullet[1])}</li>`;
      continue;
    }
    if (inList) { out += '</ul>'; inList = false; }

    if (heading) out += `<h4>${inlineMarks(heading[1])}</h4>`;
    else if (boldOnly) out += `<h4>${inlineMarks(boldOnly[1])}</h4>`;
    else if (line.trim() === '') out += '<br>';
    else out += `<div>${inlineMarks(line)}</div>`;
  }
  if (inList) out += '</ul>';
  return out;
}

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  if (role.startsWith('assistant') && !role.includes('pending')) {
    div.classList.add('rich');
    div.innerHTML = renderRich(text);
  } else {
    div.textContent = text;
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  const n = chatLog.querySelectorAll('.msg:not(.pending)').length;
  $('sig-logged').textContent = n;
  return div;
}

/* ═══════════ chat ═══════════ */

$('logout-btn').addEventListener('click', async () => {
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
  const pending = addMsg('assistant pending', 'processing…');

  busy = 1;
  $('sig-state').textContent = 'TRANSMITTING';
  $('core-state').textContent = 'PROCESSING';
  $('sig-engine').textContent = 'ACTIVE';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    pending.remove();
    if (data.error) addMsg('assistant', `Error: ${data.error}`);
    else { addMsg('assistant', data.reply); refreshWidgets(); }
  } catch (err) {
    pending.remove();
    addMsg('assistant', `Connection error: ${err.message}`);
  } finally {
    busy = 0;
    $('sig-state').textContent = 'IDLE';
    $('core-state').textContent = 'STANDING BY';
    $('sig-engine').textContent = 'READY';
  }
});

document.querySelectorAll('#cmd-list li').forEach((li) => {
  li.addEventListener('click', () => {
    chatInput.value = li.dataset.cmd;
    chatInput.focus();
  });
});

/* ═══════════ data widgets ═══════════ */

async function refreshTasks() {
  const res = await fetch('/api/tasks');
  const tasks = await res.json();
  const list = $('task-list');
  list.innerHTML = '';

  const open = tasks.filter((t) => t.status === 'open').length;
  $('task-count').textContent = open;
  $('g-tasks').textContent = open;

  if (tasks.length === 0) { list.innerHTML = '<li class="empty">No tasks logged</li>'; return; }
  tasks.forEach((t) => {
    const li = document.createElement('li');
    li.className = `item priority-${t.priority} status-${t.status}`;
    li.innerHTML = `
      <div>
        <div class="item-title">${escapeHtml(t.title)}</div>
        <div class="item-meta">${t.priority}${t.due_date ? ' · ' + t.due_date : ''}</div>
      </div>
      ${t.status === 'open' ? '<div class="item-check" title="Mark done"></div>' : ''}`;
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
  const list = $('project-list');
  list.innerHTML = '';

  $('project-count').textContent = projects.length;
  $('g-proj').textContent = projects.length;

  if (projects.length === 0) { list.innerHTML = '<li class="empty">No projects tracked</li>'; return; }
  projects.forEach((p) => {
    const li = document.createElement('li');
    li.className = `item status-${p.status}`;
    li.innerHTML = `
      <div>
        <div class="item-title">${escapeHtml(p.name)}</div>
        <div class="item-meta">${p.status}${p.goal_revenue ? ' · $' + p.goal_revenue : ''}</div>
      </div>`;
    list.appendChild(li);
  });
}

async function refreshJournal() {
  const res = await fetch('/api/journal');
  const entries = await res.json();
  const list = $('journal-list');
  list.innerHTML = '';

  $('g-entries').textContent = entries.length;

  if (entries.length === 0) { list.innerHTML = '<li class="empty">No activity logged</li>'; return; }
  entries.slice(0, 12).forEach((j) => {
    const li = document.createElement('li');
    li.className = 'item';
    const d = new Date(j.created_at);
    li.innerHTML = `
      <div>
        <div class="item-title">${escapeHtml(j.content)}</div>
        <div class="item-meta">${j.mood ? j.mood + ' · ' : ''}${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>`;
    list.appendChild(li);
  });
}

function refreshWidgets() { refreshTasks(); refreshProjects(); refreshJournal(); }

$('add-task-btn').addEventListener('click', async () => {
  const title = prompt('Task title:');
  if (!title) return;
  await fetch('/api/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, priority: 'medium' }),
  });
  refreshTasks();
});

$('add-project-btn').addEventListener('click', async () => {
  const name = prompt('Project name:');
  if (!name) return;
  await fetch('/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  refreshProjects();
});

/* ═══════════ clock + uptime ═══════════ */

const pad = (n) => String(n).padStart(2, '0');

function tickClock() {
  const now = new Date();
  let h = now.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  $('clock-time').textContent = `${pad(h)}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${ampm}`;
  $('clock-date').textContent = `${pad(now.getMonth() + 1)}.${pad(now.getDate())}.${now.getFullYear()}`;

  const up = Math.floor((Date.now() - START) / 1000);
  $('n-up').textContent = `${pad(Math.floor(up / 60))}:${pad(up % 60)}`;
}

/* ═══════════ system telemetry (real) ═══════════ */

let frames = 0, lastFpsT = performance.now(), fps = 0;

function setBar(id, pct) {
  const el = $(id);
  if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function sampleFps() {
  frames++;
  const now = performance.now();
  if (now - lastFpsT >= 1000) {
    fps = Math.round((frames * 1000) / (now - lastFpsT));
    frames = 0;
    lastFpsT = now;
    $('s-fps').textContent = fps + ' FPS';
    $('r-fps').textContent = fps;
    setBar('s-fps-b', (fps / 60) * 100);
  }
}

function sampleMemory() {
  const m = performance.memory;
  if (!m) {
    $('s-mem').textContent = 'N/A';
    $('r-mem').textContent = 'N/A';
    return;
  }
  const usedMb = m.usedJSHeapSize / 1048576;
  const limitMb = m.jsHeapSizeLimit / 1048576;
  $('s-mem').textContent = usedMb.toFixed(0) + ' MB';
  $('r-mem').textContent = usedMb.toFixed(0) + 'MB';
  setBar('s-mem-b', (usedMb / limitMb) * 100);
}

async function sampleStorage() {
  if (!navigator.storage || !navigator.storage.estimate) { $('s-sto').textContent = 'N/A'; return; }
  const est = await navigator.storage.estimate();
  const usedMb = (est.usage || 0) / 1048576;
  const quotaMb = (est.quota || 1) / 1048576;
  $('s-sto').textContent = usedMb < 1 ? '<1 MB' : usedMb.toFixed(0) + ' MB';
  setBar('s-sto-b', (usedMb / quotaMb) * 100);
}

async function sampleBattery() {
  if (!navigator.getBattery) { $('s-bat').textContent = 'N/A'; return; }
  try {
    const b = await navigator.getBattery();
    const paint = () => {
      const pct = Math.round(b.level * 100);
      $('s-bat').textContent = pct + '%' + (b.charging ? ' ⚡' : '');
      setBar('s-bat-b', pct);
    };
    paint();
    b.addEventListener('levelchange', paint);
    b.addEventListener('chargingchange', paint);
  } catch { $('s-bat').textContent = 'N/A'; }
}

function sampleConnection() {
  const c = navigator.connection;
  if (!c) { $('n-type').textContent = 'N/A'; $('n-down').textContent = 'N/A'; return; }
  $('n-type').textContent = (c.effectiveType || 'unknown').toUpperCase();
  $('n-down').textContent = c.downlink ? c.downlink.toFixed(1) + ' Mbps' : '—';
}

/* ═══════════ link latency (measured) ═══════════ */

const pings = [];

async function samplePing() {
  const t0 = performance.now();
  try {
    await fetch('/login.html', { method: 'HEAD', cache: 'no-store' });
    const ms = Math.round(performance.now() - t0);
    pings.push(ms);
    if (pings.length > 60) pings.shift();
    $('n-ping').textContent = ms + ' ms';
    $('r-ping').textContent = ms + 'ms';
    setOnline(true);
  } catch {
    setOnline(false);
  }
  drawSpark($('pingchart'), pings, 0, 400);
}

function setOnline(ok) {
  $('rail-state').textContent = ok ? 'ONLINE' : 'OFFLINE';
  $('rail-state').style.color = ok ? '' : 'var(--danger)';
}

/* ═══════════ weather (real, via open-meteo) ═══════════ */

const WX = {
  0: ['☀', 'Clear'], 1: ['☀', 'Mostly clear'], 2: ['◔', 'Partly cloudy'], 3: ['☁', 'Overcast'],
  45: ['≈', 'Fog'], 48: ['≈', 'Rime fog'],
  51: ['☂', 'Light drizzle'], 53: ['☂', 'Drizzle'], 55: ['☂', 'Heavy drizzle'],
  61: ['☂', 'Light rain'], 63: ['☂', 'Rain'], 65: ['☂', 'Heavy rain'],
  71: ['❄', 'Light snow'], 73: ['❄', 'Snow'], 75: ['❄', 'Heavy snow'], 77: ['❄', 'Snow grains'],
  80: ['☂', 'Showers'], 81: ['☂', 'Showers'], 82: ['☂', 'Violent showers'],
  95: ['⚡', 'Thunderstorm'], 96: ['⚡', 'Storm + hail'], 99: ['⚡', 'Storm + hail'],
};

function initWeather() {
  if (!navigator.geolocation) { $('loc-name').textContent = 'NO GEOLOCATION'; return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => loadWeather(pos.coords.latitude, pos.coords.longitude),
    () => { $('loc-name').textContent = 'LOCATION OFF'; $('wx-cond').textContent = 'permission denied'; },
    { timeout: 10000 }
  );
}

async function loadWeather(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  $('loc-coord').textContent = `${Math.abs(lat).toFixed(4)}° ${ns}   ${Math.abs(lon).toFixed(4)}° ${ew}`;

  fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`)
    .then((r) => r.json())
    .then((g) => {
      const city = g.city || g.locality || g.principalSubdivision || 'UNKNOWN';
      const region = g.principalSubdivisionCode ? g.principalSubdivisionCode.split('-').pop() : '';
      $('loc-name').textContent = region ? `${city}, ${region}` : city;
    })
    .catch(() => { $('loc-name').textContent = 'LOCATED'; });

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,surface_pressure` +
    `&hourly=temperature_2m&daily=temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1&timezone=auto`;

  try {
    const w = await (await fetch(url)).json();
    const c = w.current;
    const [ico, cond] = WX[c.weather_code] || ['◌', 'Unknown'];

    $('wx-ico').textContent = ico;
    $('wx-temp').textContent = Math.round(c.temperature_2m) + '°F';
    $('wx-cond').textContent = cond;
    $('wx-hl').textContent = `H: ${Math.round(w.daily.temperature_2m_max[0])}°  L: ${Math.round(w.daily.temperature_2m_min[0])}°`;

    $('e-temp').textContent = Math.round(c.temperature_2m) + '°F';
    $('e-hum').textContent = c.relative_humidity_2m + '%';
    $('e-wind').textContent = Math.round(c.wind_speed_10m) + ' MPH';
    $('e-pres').textContent = Math.round(c.surface_pressure) + ' hPa';

    drawSpark($('wxchart'), w.hourly.temperature_2m.slice(0, 24));
  } catch {
    $('wx-cond').textContent = 'weather unavailable';
  }
}

/* ═══════════ sparkline ═══════════ */

function drawSpark(canvas, data, forceMin, forceMax) {
  if (!canvas || !data || data.length < 2) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const min = forceMin !== undefined ? forceMin : Math.min(...data);
  const max = forceMax !== undefined ? forceMax : Math.max(...data);
  const span = max - min || 1;
  const px = (i) => (i / (data.length - 1)) * w;
  const py = (v) => h - 3 - ((v - min) / span) * (h - 6);

  ctx.strokeStyle = 'rgba(150, 215, 255, 0.09)';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 2; g++) {
    const y = 3 + (g / 2) * (h - 6);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(168, 220, 255, 0.28)');
  grad.addColorStop(1, 'rgba(168, 220, 255, 0)');
  ctx.beginPath();
  ctx.moveTo(px(0), py(data[0]));
  data.forEach((v, i) => ctx.lineTo(px(i), py(v)));
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  ctx.moveTo(px(0), py(data[0]));
  data.forEach((v, i) => ctx.lineTo(px(i), py(v)));
  ctx.strokeStyle = '#a8dcff';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const lx = px(data.length - 1), ly = py(data[data.length - 1]);
  ctx.fillStyle = '#eaf7ff';
  ctx.fillRect(lx - 1.5, ly - 1.5, 3, 3);
}

/* ═══════════ waveforms ═══════════ */

function drawWave(canvas, peaked) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const mid = h / 2;
  const step = 3;
  const t = performance.now() / 260;

  for (let x = 0; x < w; x += step) {
    const n = x / w;
    const env = peaked ? Math.pow(Math.max(0, 1 - Math.abs(n - 0.5) * 2), 1.7) : 1;
    const wobble =
      Math.sin(n * 22 + t) * 0.5 +
      Math.sin(n * 47 - t * 1.7) * 0.3 +
      Math.sin(n * 91 + t * 2.3) * 0.2;
    const a = Math.abs(wobble) * env * amp * (h / 2);
    const bar = Math.max(1, a);

    ctx.fillStyle = `rgba(168, 220, 255, ${(0.25 + env * 0.65).toFixed(3)})`;
    ctx.fillRect(x, mid - bar, 1.4, bar * 2);
  }
}

/* ═══════════ mini wireframe globe ═══════════ */

function drawMiniGlobe(canvas, rot) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.42;
  ctx.strokeStyle = 'rgba(150, 215, 255, 0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

  ctx.strokeStyle = 'rgba(150, 215, 255, 0.26)';
  for (let i = 1; i <= 3; i++) {
    const ry = r * (i / 4);
    ctx.beginPath(); ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2); ctx.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const rx = Math.abs(Math.cos(rot + (i * Math.PI) / 4)) * r;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, r, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

/* ═══════════ animation loop ═══════════ */

let miniRot = 0;

function loop() {
  sampleFps();
  const target = busy ? 1 : 0.34;
  amp += (target - amp) * 0.06;
  miniRot += 0.006;

  drawWave($('wave'), false);
  drawWave($('bigwave'), true);
  drawMiniGlobe($('minigl'), miniRot);

  requestAnimationFrame(loop);
}

/* ═══════════ boot ═══════════ */

loadHistory();
refreshWidgets();
tickClock();
sampleMemory();
sampleStorage();
sampleBattery();
sampleConnection();
samplePing();
initWeather();
loop();

setInterval(tickClock, 1000);
setInterval(sampleMemory, 2000);
setInterval(samplePing, 5000);
setInterval(sampleStorage, 30000);
setInterval(refreshWidgets, 60000);
