// Voice: on-device wake word (Porcupine) → record → transcribe (Gemini) → speak.
//
// Chrome's Web Speech API was the previous approach and proved unreliable, so
// nothing here depends on it. Porcupine detects "Jarvis" locally via WebAssembly;
// the command itself is recorded and sent to our own /api/transcribe.
(function () {
  const micBtn = document.getElementById('mic-btn');
  const talkBtn = document.getElementById('talk-btn');
  const stateEl = document.getElementById('voice-state');
  const heardEl = document.getElementById('voice-heard');
  const diagEl = document.getElementById('voice-diag');
  const countEl = document.getElementById('voice-count');
  const coreState = document.getElementById('core-state');

  const PORCUPINE_URL = 'https://cdn.jsdelivr.net/npm/@picovoice/porcupine-web@4.0.1/+esm';
  const WVP_URL = 'https://cdn.jsdelivr.net/npm/@picovoice/web-voice-processor@4.0.10/+esm';
  const MODEL_PATH = '/porcupine_params.pv';

  const MAX_RECORD_MS = 10000;   // hard stop
  const SILENCE_MS = 1400;       // end of speech
  const SILENCE_LEVEL = 0.006;   // RMS floor — quiet mics still count

  let porcupine = null;
  let wvp = null;
  let enabled = false;
  let listening = false;   // wake word active
  let recording = false;
  let speaking = false;
  let heardCount = 0;
  let activity = 0;

  const setState = (t, c) => { if (stateEl) { stateEl.textContent = t; stateEl.style.color = c || ''; } };
  const heard = (t) => { if (heardEl) heardEl.textContent = t ? '“' + t + '”' : '—'; };
  const diag = (t) => { if (diagEl) diagEl.textContent = t; };

  // Waveform amplitude, shared with the HUD renderer.
  (function decay() {
    activity *= 0.92;
    window.Jarvis.micLevel = Math.max(window.Jarvis.micLevel || 0, activity) * 0.92;
    requestAnimationFrame(decay);
  })();

  /* ─────────── speech out ─────────── */

  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    for (const name of ['Daniel', 'Google UK English Male', 'Arthur', 'Oliver', 'Alex']) {
      const v = voices.find((x) => x.name.includes(name));
      if (v) return v;
    }
    return voices.find((v) => v.lang && v.lang.startsWith('en')) || null;
  }

  function forSpeech(text) {
    return text
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/[*_#`]+/g, '')
      .replace(/^\s*[-•]\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function speak(text) {
    return new Promise((resolve) => {
      if (!text) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(forSpeech(text));
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1.03;
      u.pitch = 0.92;

      u.onstart = () => {
        speaking = true;
        setState('SPEAKING', 'var(--amber)');
        if (coreState) coreState.textContent = 'SPEAKING';
      };
      u.onend = u.onerror = () => {
        speaking = false;
        if (coreState) coreState.textContent = 'STANDING BY';
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }

  /* ─────────── record one command ─────────── */

  async function recordClip(onLevel) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);

    const chunks = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();

    const started = Date.now();
    let lastLoud = Date.now();
    let spoke = false;
    let lastReport = 0;
    const buf = new Uint8Array(analyser.frequencyBinCount);

    await new Promise((resolve) => {
      (function watch() {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const level = Math.sqrt(sum / buf.length);
        activity = Math.max(activity, level * 3);

        const now = Date.now();
        if (level > SILENCE_LEVEL) { lastLoud = now; spoke = true; }

        if (onLevel && now - lastReport > 120) {
          lastReport = now;
          onLevel(level, spoke);
        }

        const quietLongEnough = spoke && now - lastLoud > SILENCE_MS;
        const tooLong = now - started > MAX_RECORD_MS;
        const nothingAtAll = !spoke && now - started > 6000;

        if (quietLongEnough || tooLong || nothingAtAll) return resolve();
        requestAnimationFrame(watch);
      })();
    });

    recorder.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});

    if (!spoke) return null;
    return new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  /* ─────────── the exchange ─────────── */

  async function runExchange() {
    if (recording) return;
    recording = true;

    // Release the mic from the wake-word engine while we record.
    await suspendWakeWord();

    try {
      setState('LISTENING…', 'var(--ice)');
      if (coreState) coreState.textContent = 'LISTENING…';
      diag('recording');

      const clip = await recordClip((level, spoke) => {
        const bars = '▁▂▃▄▅▆▇█';
        const i = Math.min(bars.length - 1, Math.round(level * 90));
        diag((spoke ? 'recording ' : 'waiting ') + bars[i].repeat(3));
      });
      if (!clip) { diag('heard nothing'); return; }

      setState('TRANSCRIBING', 'var(--amber)');
      diag('transcribing ' + Math.round(clip.size / 1024) + 'kb');

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: await blobToBase64(clip), mimeType: clip.type.split(';')[0] }),
      });
      const data = await res.json();
      const text = (data.text || '').trim();

      if (data.error) { diag('error: ' + data.error); return; }
      if (!text) { diag('no speech found'); return; }

      heard(text);
      heardCount++;
      if (countEl) countEl.textContent = heardCount;

      setState('TRANSMITTING', 'var(--amber)');
      diag('sent');
      const reply = await window.Jarvis.send(text);
      if (reply) await speak(reply);
    } catch (err) {
      const reasons = {
        NotAllowedError: 'allow mic access in chrome',
        NotFoundError: 'no microphone detected',
        NotReadableError: 'mic busy in another app',
        SecurityError: 'needs https',
      };
      diag(reasons[err.name] || ('failed: ' + (err.name || err.message)));
      setState('MIC BLOCKED', 'var(--danger)');
    } finally {
      recording = false;
      if (enabled) await resumeWakeWord();
      else setState('OFFLINE');
    }
  }

  /* ─────────── wake word ─────────── */

  async function suspendWakeWord() {
    if (wvp && porcupine && listening) {
      try { await wvp.unsubscribe(porcupine); } catch {}
      listening = false;
    }
  }

  async function resumeWakeWord() {
    if (wvp && porcupine && !listening && !recording) {
      try {
        await wvp.subscribe(porcupine);
        listening = true;
        setState('LISTENING', 'var(--ok)');
        diag('say “jarvis”');
      } catch (err) {
        diag('resume failed: ' + err.message);
      }
    }
  }

  async function initWakeWord() {
    setState('STARTING', 'var(--amber)');
    diag('fetching key…');

    const cfg = await (await fetch('/api/config')).json();
    if (!cfg.picovoiceKey) {
      setState('NO WAKE KEY', 'var(--danger)');
      diag('set PICOVOICE_ACCESS_KEY');
      return false;
    }

    diag('loading engine…');
    const [pv, wv] = await Promise.all([import(PORCUPINE_URL), import(WVP_URL)]);

    porcupine = await pv.PorcupineWorker.create(
      cfg.picovoiceKey,
      { builtin: pv.BuiltInKeyword.Jarvis, sensitivity: 0.7 },
      () => { activity = 0.6; runExchange(); },
      { publicPath: MODEL_PATH }
    );

    wvp = wv.WebVoiceProcessor;
    return true;
  }

  /* ─────────── controls ─────────── */

  async function enable() {
    micBtn.disabled = true;
    try {
      if (!porcupine && !(await initWakeWord())) { micBtn.disabled = false; return; }
      enabled = true;
      micBtn.textContent = 'disable mic';
      await resumeWakeWord();
    } catch (err) {
      setState('FAILED', 'var(--danger)');
      diag(err.message ? err.message.slice(0, 44) : 'init error');
      enabled = false;
    } finally {
      micBtn.disabled = false;
    }
  }

  async function disable() {
    enabled = false;
    await suspendWakeWord();
    speechSynthesis.cancel();
    micBtn.textContent = 'enable mic';
    setState('OFFLINE');
    heard('');
    diag('idle');
  }

  micBtn.addEventListener('click', () => (enabled ? disable() : enable()));

  // Push to talk: records immediately, no wake word or access key needed.
  talkBtn.addEventListener('click', () => runExchange());

  // Spacebar does the same, unless you're typing in the command bar.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    e.preventDefault();
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
    runExchange();
  });

  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
  setState('OFFLINE');
  diag('idle');
})();
