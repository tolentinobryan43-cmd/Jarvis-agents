// Wake-word listening + spoken replies, built on the browser's Web Speech API.
// Chrome/Edge only: Firefox has no SpeechRecognition implementation.
//
// Deliberately does NOT call getUserMedia. Holding the microphone with a media
// stream blocks Chrome's own speech capture, which silently kills recognition.
// The waveform is driven by speech events instead.
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById('mic-btn');
  const talkBtn = document.getElementById('talk-btn');
  const stateEl = document.getElementById('voice-state');
  const heardEl = document.getElementById('voice-heard');
  const diagEl = document.getElementById('voice-diag');
  const countEl = document.getElementById('voice-count');
  const coreState = document.getElementById('core-state');

  // "jarvis" is routinely misheard. Accept it bare at the start of an utterance
  // as well as after a greeting — requiring "hey" doubles the chances of a miss.
  const NAME = '(?:jarvis|jervis|travis|charvis|jarviss|jarviz|service|harvest)';
  const WAKE = new RegExp('\\b(?:hey|hay|hi|ok|okay|yo|a)[,\\s]+' + NAME + '\\b', 'i');
  const BARE = new RegExp('^\\s*' + NAME + '\\b[,\\s]*', 'i');
  const STOP_SPEAKING = /\b(?:stop|quiet|shut up|never mind|nevermind)\b/i;

  const ARM_WINDOW_MS = 12000;

  let rec = null;
  let enabled = false;
  let armed = false;
  let armTimer = null;
  let speaking = false;
  let restartTimer = null;
  let backoff = 300;
  let finals = 0;
  let activity = 0;

  const setState = (t, c) => { if (stateEl) { stateEl.textContent = t; stateEl.style.color = c || ''; } };
  const heard = (t) => { if (heardEl) heardEl.textContent = t ? '“' + t + '”' : '—'; };
  const diag = (t) => { if (diagEl) diagEl.textContent = t; };

  if (!SR) {
    setState('UNSUPPORTED', 'var(--danger)');
    diag('needs chrome or edge');
    if (micBtn) { micBtn.disabled = true; micBtn.textContent = 'no speech api'; }
    if (talkBtn) talkBtn.disabled = true;
    return;
  }

  // Waveform reacts to speech events rather than a mic stream.
  (function decay() {
    activity *= 0.93;
    window.Jarvis.micLevel = activity;
    requestAnimationFrame(decay);
  })();

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

    // Stop listening while talking so Jarvis doesn't transcribe himself.
    u.onstart = () => {
      speaking = true;
      activity = 0.5;
      setState('SPEAKING', 'var(--amber)');
      if (coreState) coreState.textContent = 'SPEAKING';
      stopRecognition();
    };
    u.onend = u.onerror = () => {
      speaking = false;
      activity = 0;
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

    rec.onstart = () => { backoff = 300; diag('capturing'); };

    rec.onresult = (e) => {
      activity = 0.55;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript.trim();
        heard(text);
        if (!result.isFinal) continue;
        finals++;
        if (countEl) countEl.textContent = finals;
        handleUtterance(text);
      }
    };

    rec.onerror = (e) => {
      switch (e.error) {
        case 'no-speech':
          diag('silence');              // normal; onend restarts
          break;
        case 'aborted':
          diag('aborted — restarting');
          break;
        case 'not-allowed':
        case 'service-not-allowed':
          setState('MIC BLOCKED', 'var(--danger)');
          diag('allow mic for this site');
          enabled = false;
          if (micBtn) micBtn.textContent = 'enable mic';
          break;
        case 'audio-capture':
          setState('NO MICROPHONE', 'var(--danger)');
          diag('no input device');
          break;
        case 'network':
          setState('NO SPEECH SERVICE', 'var(--danger)');
          diag('cannot reach speech api');
          break;
        default:
          diag('err: ' + e.error);
      }
    };

    // Chrome ends the stream on its own after silence; bring it straight back.
    rec.onend = () => {
      rec = null;
      if (!enabled || speaking) return;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(startRecognition, backoff);
    };

    try {
      rec.start();
    } catch (err) {
      rec = null;
      backoff = Math.min(backoff * 2, 5000);
      diag('restart in ' + backoff + 'ms');
      clearTimeout(restartTimer);
      restartTimer = setTimeout(startRecognition, backoff);
    }
  }

  function stopRecognition() {
    clearTimeout(restartTimer);
    if (rec) {
      rec.onend = null;
      try { rec.stop(); } catch {}
      rec = null;
    }
  }

  /* ─────────── wake word + dispatch ─────────── */

  function disarm() {
    armed = false;
    clearTimeout(armTimer);
    if (enabled && !speaking) setState('LISTENING', 'var(--ok)');
    if (coreState && !speaking) coreState.textContent = 'STANDING BY';
  }

  function arm(reason) {
    armed = true;
    setState('AWAITING COMMAND', 'var(--ice)');
    if (coreState) coreState.textContent = 'LISTENING…';
    diag(reason || 'wake heard');
    clearTimeout(armTimer);
    armTimer = setTimeout(disarm, ARM_WINDOW_MS);
  }

  async function dispatch(command) {
    disarm();
    setState('TRANSMITTING', 'var(--amber)');
    diag('sent: ' + command.slice(0, 30));
    const reply = await window.Jarvis.send(command);
    if (reply) speak(reply);
    else if (enabled) setState('LISTENING', 'var(--ok)');
  }

  function handleUtterance(text) {
    if (speechSynthesis.speaking && STOP_SPEAKING.test(text)) {
      speechSynthesis.cancel();
      diag('stopped');
      return;
    }

    // "hey jarvis ..." anywhere, or "jarvis ..." opening the utterance.
    const m = text.match(WAKE);
    const bare = m ? null : text.match(BARE);

    if (m || bare) {
      const cut = m ? m.index + m[0].length : bare[0].length;
      const rest = text.slice(cut).replace(/^[,.\s]+/, '');
      if (rest.split(/\s+/).filter(Boolean).length >= 2) dispatch(rest);
      else arm();
      return;
    }

    if (armed) dispatch(text);
    else diag('heard, no wake word');
  }

  /* ─────────── controls ─────────── */

  function enable() {
    enabled = true;
    finals = 0;
    backoff = 300;
    if (countEl) countEl.textContent = '0';
    micBtn.textContent = 'disable mic';
    setState('LISTENING', 'var(--ok)');
    diag('starting…');
    startRecognition();
  }

  function disable() {
    enabled = false;
    stopRecognition();
    speechSynthesis.cancel();
    disarm();
    micBtn.textContent = 'enable mic';
    setState('OFFLINE');
    heard('');
    diag('idle');
  }

  micBtn.addEventListener('click', () => (enabled ? disable() : enable()));

  // Push to talk: skips the wake word entirely.
  if (talkBtn) {
    talkBtn.addEventListener('click', () => {
      if (!enabled) enable();
      arm('push to talk — speak now');
    });
  }

  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
  setState('OFFLINE');
  diag('idle');
})();
