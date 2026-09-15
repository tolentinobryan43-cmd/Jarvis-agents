// Voice: custom wake word (trained on your voice, in your browser) → record →
// transcribe (Gemini) → speak.
//
// The wake word is a TensorFlow.js transfer model over the speech-commands base
// network. It trains and runs entirely on this machine — no account, no service,
// and no audio leaves the browser until a command is actually recorded.
(function () {
  const $ = (id) => document.getElementById(id);
  const micBtn = $('mic-btn');
  const talkBtn = $('talk-btn');
  const trainBtn = $('train-btn');
  const stateEl = $('voice-state');
  const heardEl = $('voice-heard');
  const diagEl = $('voice-diag');
  const countEl = $('voice-count');
  const coreState = $('core-state');

  const TFJS = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
  const SPEECH = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/speech-commands@0.5.4/dist/speech-commands.min.js';

  const WAKE = 'jarvis';
  const NOISE = '_background_noise_';
  const MODEL_NAME = 'jarvis-wake';
  const WAKE_SAMPLES = 14;
  const NOISE_SAMPLES = 12;
  const THRESHOLD = 0.93;
  const COOLDOWN_MS = 1500;

  const MAX_RECORD_MS = 10000;
  const SILENCE_MS = 1400;
  const SILENCE_LEVEL = 0.006;

  let base = null;
  let wake = null;          // transfer recognizer
  let trained = false;
  let listening = false;
  let recording = false;
  let lastFire = 0;
  let heardCount = 0;
  let activity = 0;

  const setState = (t, c) => { if (stateEl) { stateEl.textContent = t; stateEl.style.color = c || ''; } };
  const heard = (t) => { if (heardEl) heardEl.textContent = t ? '“' + t + '”' : '—'; };
  const diag = (t) => { if (diagEl) diagEl.textContent = t; };

  (function decay() {
    activity *= 0.92;
    window.Jarvis.micLevel = Math.max(window.Jarvis.micLevel || 0, activity) * 0.92;
    requestAnimationFrame(decay);
  })();

  // A stalled network request (blocked CDN, dead wifi) resolves neither way
  // and hangs forever with nothing else here to notice — race it against a
  // timer so it always settles one way or the other.
  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out after ' + (ms / 1000) + 's')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  /* ─────────── library loading ─────────── */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('cdn blocked: ' + src));
      document.head.appendChild(s);
    });
  }

  let libsPromise = null;
  function loadLibs() {
    if (!libsPromise) {
      libsPromise = (async () => {
        diag('loading engine…');
        await withTimeout(loadScript(TFJS), 15000, 'loading tfjs');
        await withTimeout(loadScript(SPEECH), 15000, 'loading speech-commands');
        base = window.speechCommands.create('BROWSER_FFT');
        await withTimeout(base.ensureModelLoaded(), 15000, 'loading base model');
      })().catch((err) => {
        libsPromise = null;   // let a retry actually retry the network, not replay this failure forever
        throw err;
      });
    }
    return libsPromise;
  }

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
        setState('SPEAKING', 'var(--amber)');
        if (coreState) coreState.textContent = 'SPEAKING';
      };
      u.onend = u.onerror = () => {
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
        if (onLevel && now - lastReport > 120) { lastReport = now; onLevel(level, spoke); }

        if ((spoke && now - lastLoud > SILENCE_MS) ||
            now - started > MAX_RECORD_MS ||
            (!spoke && now - started > 6000)) return resolve();
        requestAnimationFrame(watch);
      })();
    });

    recorder.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});

    return spoke ? new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }) : null;
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
    const wasListening = listening;
    await stopListening();   // the wake model holds the mic; let it go

    try {
      setState('LISTENING…', 'var(--ice)');
      if (coreState) coreState.textContent = 'LISTENING…';

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
    } finally {
      recording = false;
      lastFire = Date.now();
      if (wasListening) await startListening();
      else setState('OFFLINE');
    }
  }

  /* ─────────── wake word ─────────── */

  async function startListening() {
    if (!trained || listening || recording) return;
    try {
      await wake.listen(
        (result) => {
          const labels = wake.wordLabels();
          const scores = Array.from(result.scores);
          const i = labels.indexOf(WAKE);
          const score = i >= 0 ? scores[i] : 0;
          activity = Math.max(activity, 0.25);
          if (score >= THRESHOLD && Date.now() - lastFire > COOLDOWN_MS) {
            lastFire = Date.now();
            diag('woke (' + score.toFixed(2) + ')');
            runExchange();
          }
        },
        { probabilityThreshold: THRESHOLD, overlapFactor: 0.5, invokeCallbackOnNoiseAndUnknown: false }
      );
      listening = true;
      setState('LISTENING', 'var(--ok)');
      diag('say “jarvis”');
      micBtn.textContent = 'disable mic';
    } catch (err) {
      diag('listen failed: ' + (err.name || err.message));
    }
  }

  async function stopListening() {
    if (wake && listening) {
      try { await wake.stopListening(); } catch {}
      listening = false;
    }
  }

  async function ensureModel() {
    await loadLibs();
    if (!wake) wake = base.createTransfer(MODEL_NAME);
    if (trained) return true;
    try {
      await wake.load();            // restores a model trained in an earlier session
      trained = true;
      return true;
    } catch {
      return false;
    }
  }

  /* ─────────── training ─────────── */

  const overlay = $('train-overlay');
  const tStep = $('train-step');
  const tPrompt = $('train-prompt');
  const tBar = $('train-bar');
  const tHint = $('train-hint');
  const tAction = $('train-action');

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Cancel used to just hide the modal — anything already in flight (a
  // network fetch, a recording) kept running invisibly and could still
  // touch the UI afterward. Every stage checks this and bails out for real.
  let cancelRequested = false;
  function throwIfCancelled() {
    if (cancelRequested) throw new Error('cancelled');
  }

  async function collect(label, n, promptText, hintText) {
    for (let i = 0; i < n; i++) {
      throwIfCancelled();
      tPrompt.textContent = promptText;
      tHint.textContent = hintText;
      tStep.textContent = `${label === WAKE ? 'WAKE WORD' : 'ROOM NOISE'} — ${i + 1} / ${n}`;
      tBar.style.width = ((i / n) * 100).toFixed(0) + '%';

      tPrompt.classList.remove('live');
      await wait(550);
      throwIfCancelled();
      tPrompt.classList.add('live');      // cue to speak
      await withTimeout(wake.collectExample(label), 8000, `sample ${i + 1}/${n}`);
    }
    tPrompt.classList.remove('live');
    tBar.style.width = '100%';
  }

  async function runTraining() {
    cancelRequested = false;
    overlay.hidden = false;
    tAction.disabled = true;
    tAction.textContent = 'working…';

    try {
      await withTimeout(loadLibs(), 45000, 'loading engine');
      throwIfCancelled();
      // Retraining while the wake model is actively listening leaves the
      // mic claimed by wake.listen() — collectExample() then has nothing
      // to record from and waits forever with no error. Release it first.
      await stopListening();
      // The recognizer is created once at load; re-creating it throws.
      if (!wake) wake = base.createTransfer(MODEL_NAME);
      try { wake.clearExamples(); } catch {}

      tStep.textContent = 'PREPARING';
      tPrompt.textContent = '◌';
      tHint.textContent = 'Allow microphone access if asked.';

      await collect(WAKE, WAKE_SAMPLES, 'JARVIS',
        'Say it out loud each time the word lights up. Vary your tone a little.');

      await collect(NOISE, NOISE_SAMPLES, '· · ·',
        'Stay quiet, or talk about something else. This teaches it what to ignore.');

      throwIfCancelled();
      tStep.textContent = 'TRAINING';
      tPrompt.textContent = '◐';
      tHint.textContent = 'Building the model on your machine…';

      await withTimeout(wake.train({
        epochs: 32,
        callback: {
          onEpochEnd: async (epoch, logs) => {
            tBar.style.width = (((epoch + 1) / 32) * 100).toFixed(0) + '%';
            const acc = logs.acc ?? logs.accuracy;
            tHint.textContent = `epoch ${epoch + 1}/32 · accuracy ${((acc || 0) * 100).toFixed(0)}%`;
          },
        },
      }), 60000, 'training');

      await withTimeout(wake.save(), 8000, 'saving model');
      trained = true;

      tStep.textContent = 'READY';
      tPrompt.textContent = '✓';
      tHint.textContent = 'Wake word trained and saved to this browser.';
      tAction.textContent = 'close';
      tAction.disabled = false;

      await startListening();
    } catch (err) {
      if (err.message === 'cancelled') return;   // user hit cancel — modal's already closed, nothing more to show
      console.error('[jarvis] training failed:', err);
      tStep.textContent = 'FAILED';
      tPrompt.textContent = '✕';
      tHint.textContent = err.name === 'NotAllowedError'
        ? 'Microphone access denied.'
        : (err.message || 'training failed');
      tAction.textContent = 'close';
      tAction.disabled = false;
    }
  }

  tAction.addEventListener('click', () => {
    if (tAction.textContent === 'close') overlay.hidden = true;
  });
  $('train-cancel').addEventListener('click', () => {
    cancelRequested = true;
    overlay.hidden = true;
  });
  trainBtn.addEventListener('click', runTraining);

  /* ─────────── controls ─────────── */

  micBtn.addEventListener('click', async () => {
    if (listening) {
      await stopListening();
      micBtn.textContent = 'enable mic';
      setState('OFFLINE');
      diag('idle');
      return;
    }
    micBtn.disabled = true;
    try {
      if (await ensureModel()) await startListening();
      else {
        setState('NOT TRAINED', 'var(--amber)');
        diag('press train first');
      }
    } catch (err) {
      setState('FAILED', 'var(--danger)');
      diag((err.message || 'error').slice(0, 40));
    } finally {
      micBtn.disabled = false;
    }
  });

  talkBtn.addEventListener('click', () => runExchange());

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
  diag('press space to talk');

  // Surface a model trained in a previous session without grabbing the mic.
  ensureModel()
    .then((ok) => diag(ok ? 'wake word ready — enable mic' : 'press space to talk'))
    .catch(() => diag('press space to talk'));
})();
