// Wake-word listening + spoken replies, built on the browser's Web Speech API.
// Chrome/Edge only: Firefox has no SpeechRecognition implementation.
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById('mic-btn');
  const stateEl = document.getElementById('voice-state');
  const heardEl = document.getElementById('voice-heard');
  const coreState = document.getElementById('core-state');

  // "jarvis" is routinely misheard; accept the usual neighbours.
  const WAKE = /\b(?:hey|hay|a|ok|okay)[,\s]+(jarvis|jervis|travis|charvis|jarvi{1,2}s|service)\b/i;
  const STOP_SPEAKING = /\b(?:stop|quiet|shut up|never mind)\b/i;

  const ARM_WINDOW_MS = 9000;

  let rec = null;
  let enabled = false;
  let armed = false;
  let armTimer = null;
  let speaking = false;
  let restartTimer = null;
  let audioCtx = null;
  let analyser = null;
  let micStream = null;

  function setState(text, cls) {
    if (!stateEl) return;
    stateEl.textContent = text;
    stateEl.style.color = cls || '';
  }

  function heard(text) {
    if (heardEl) heardEl.textContent = text ? '“' + text + '”' : '—';
  }

  if (!SR) {
    setState('UNSUPPORTED', 'var(--danger)');
    heard('Chrome or Edge required');
    if (micBtn) { micBtn.disabled = true; micBtn.textContent = 'no speech api'; }
    return;
  }

  /* ─────────── mic level (drives the waveform) ─────────── */

  async function startMeter() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      meter();
      return true;
    } catch {
      setState('MIC DENIED', 'var(--danger)');
      return false;
    }
  }

  function meter() {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    window.Jarvis.micLevel = Math.sqrt(sum / buf.length);
    requestAnimationFrame(meter);
  }

  function stopMeter() {
    window.Jarvis.micLevel = 0;
    analyser = null;
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
  }

  /* ─────────── speech output ─────────── */

  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    const preferred = ['Daniel', 'Google UK English Male', 'Arthur', 'Oliver', 'Alex'];
    for (const name of preferred) {
      const v = voices.find((x) => x.name.includes(name));
      if (v) return v;
    }
    return voices.find((v) => v.lang && v.lang.startsWith('en')) || null;
  }

  // Markdown reads badly aloud — strip it to plain prose.
  function forSpeech(text) {
    return text
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/[*_#`]+/g, '')
      .replace(/^\s*[-•]\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function speak(text) {
    if (!text) return;
    speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(forSpeech(text));
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.03;
    u.pitch = 0.92;

    // Pause recognition while talking so Jarvis doesn't transcribe himself.
    u.onstart = () => {
      speaking = true;
      setState('SPEAKING', 'var(--amber)');
      if (coreState) coreState.textContent = 'SPEAKING';
      stopRecognition();
    };
    u.onend = u.onerror = () => {
      speaking = false;
      if (coreState) coreState.textContent = 'STANDING BY';
      if (enabled) { setState('LISTENING', 'var(--ok)'); startRecognition(); }
    };

    speechSynthesis.speak(u);
  }

  /* ─────────── recognition ─────────── */

  function startRecognition() {
    if (!enabled || speaking || rec) return;
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript.trim();
        if (!result.isFinal) { heard(text); continue; }
        heard(text);
        handleUtterance(text);
      }
    };

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setState('MIC DENIED', 'var(--danger)');
        enabled = false;
        if (micBtn) micBtn.textContent = 'enable mic';
      }
    };

    // Chrome ends the stream on its own after a stretch of silence; restart it.
    rec.onend = () => {
      rec = null;
      if (enabled && !speaking) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(startRecognition, 350);
      }
    };

    try { rec.start(); } catch { rec = null; }
  }

  function stopRecognition() {
    clearTimeout(restartTimer);
    if (rec) { rec.onend = null; try { rec.stop(); } catch {} rec = null; }
  }

  function disarm() {
    armed = false;
    clearTimeout(armTimer);
    if (enabled && !speaking) setState('LISTENING', 'var(--ok)');
    if (coreState && !speaking) coreState.textContent = 'STANDING BY';
  }

  function arm() {
    armed = true;
    setState('AWAITING COMMAND', 'var(--ice)');
    if (coreState) coreState.textContent = 'LISTENING…';
    clearTimeout(armTimer);
    armTimer = setTimeout(disarm, ARM_WINDOW_MS);
  }

  async function dispatch(command) {
    disarm();
    setState('TRANSMITTING', 'var(--amber)');
    const reply = await window.Jarvis.send(command);
    if (reply) speak(reply);
    else if (enabled) setState('LISTENING', 'var(--ok)');
  }

  function handleUtterance(text) {
    if (speechSynthesis.speaking && STOP_SPEAKING.test(text)) {
      speechSynthesis.cancel();
      return;
    }

    const match = text.match(WAKE);
    if (match) {
      // Anything after the wake word in the same breath is the command.
      const rest = text.slice(match.index + match[0].length).replace(/^[,.\s]+/, '');
      if (rest.split(/\s+/).filter(Boolean).length >= 2) dispatch(rest);
      else arm();
      return;
    }

    if (armed) dispatch(text);
  }

  /* ─────────── toggle ─────────── */

  async function enable() {
    if (!(await startMeter())) return;
    enabled = true;
    micBtn.textContent = 'disable mic';
    setState('LISTENING', 'var(--ok)');
    startRecognition();
  }

  function disable() {
    enabled = false;
    stopRecognition();
    stopMeter();
    speechSynthesis.cancel();
    disarm();
    micBtn.textContent = 'enable mic';
    setState('OFFLINE');
    heard('');
  }

  micBtn.addEventListener('click', () => (enabled ? disable() : enable()));

  // Voice list loads asynchronously in Chrome.
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
  setState('OFFLINE');
})();
