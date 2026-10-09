import { Oracle3D, MOOD_COLORS } from './oracle3d.js';
import { Ambience } from './ambience.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const oracle = new Oracle3D($('#stage'));
// Voice-direction tags like [warm] or [slow] are for the speech engine, not for reading.
const stripTags = (text) => text.replace(/\[(?:mood:\s*)?[a-z][a-z \-]{0,24}\]\s*/gi, '');
const ambience = new Ambience();

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const settings = { voice: true, handsfree: false, ambience: false, voiceId: '', browserVoice: '', token: '', ...store.get('oracle.settings', {}) };
const persist = () => store.set('oracle.settings', settings);

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (settings.token) headers['x-access-token'] = settings.token;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
  }
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (err.locked) showLock(err.error);
    throw new Error(err.error || res.statusText);
  }
  return res;
}

// ───────────────── Passcode lock (cloud) ─────────────────
function showLock(message) {
  const lock = $('#lock');
  if (!lock.hidden) return;
  lock.hidden = false;
  $('#lock-msg').textContent = message === 'Passcode required.' ? 'Enter your passcode to wake the Oracle.' : message;
  setTimeout(() => $('#lock-input').focus(), 50);
}
$('#lock-form').onsubmit = async (e) => {
  e.preventDefault();
  settings.token = $('#lock-input').value.trim();
  persist();
  const res = await fetch('/api/status', { headers: { 'x-access-token': settings.token } });
  if (res.ok) {
    $('#lock').hidden = true;
    $('#token').value = settings.token;
    location.reload();
  } else {
    $('#lock-msg').textContent = 'That is not the passcode.';
    $('#lock-input').select();
  }
};
const getJSON = async (path, opts) => (await api(path, opts)).json();

// ───────────────── Views ─────────────────
function showView(name) {
  document.body.dataset.view = name;
  for (const v of $$('.view')) v.hidden = v.id !== `view-${name}`;
  for (const t of $$('.tabs button')) t.classList.toggle('on', t.dataset.viewLink === name);
  if (name === 'library') refreshLibrary();
  if (name === 'discover' && !$('#gut-grid').children.length) loadClassics();
  if (name === 'soul') refreshSoul();
  if (name === 'integrations') loadStatus();
  oracle.setFocus(name === 'oracle');
}
$$('[data-view-link]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); showView(b.dataset.viewLink); }));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#log').classList.remove('open'); showView('oracle'); }
});

// ───────────────── State & mood ─────────────────
const STATE_WORDS = { idle: 'Present', listening: 'Listening', thinking: 'Contemplating', speaking: 'Speaking' };
let currentMood = 'serene';
function setState(s) {
  oracle.setState(s);
  ambience.setState(s);
  if (!$('#mood-badge').dataset.mood) $('#mood-badge').textContent = STATE_WORDS[s];
}
function setMood(mood) {
  currentMood = MOOD_COLORS[mood] ? mood : 'serene';
  oracle.setMood(currentMood);
  ambience.setMood(currentMood);
  document.documentElement.style.setProperty('--mood', MOOD_COLORS[currentMood][0]);
  $('#mood-badge').textContent = currentMood;
  $('#mood-badge').dataset.mood = currentMood;
}

// ───────────────── Voice out ─────────────────
// Sentences are voiced as they stream in, so the Oracle starts speaking fast.
let audioCtx;
let analyser;
const speechQueue = [];
let speaking = false;
let pendingDone = null;
let elevenAvailable = false;
let usingBrowserVoice = false;
let lastSpoken = [];

function ensureAudio() {
  // Phones only allow sound that starts from a tap; resuming here (always called
  // from a tap or submit) keeps the context unlocked for the voice that follows.
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const silent = audioCtx.createBufferSource();
  silent.buffer = audioCtx.createBuffer(1, 1, 22050);
  silent.connect(audioCtx.destination);
  silent.start();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.connect(audioCtx.destination);
  ambience.attach(audioCtx);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    if (speaking && !usingBrowserVoice) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      oracle.setEnergy(Math.sqrt(sum / buf.length) * 4.5);
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function enqueueSpeech(text) {
  const clean = stripTags(text).replace(/[*_#>`]/g, '').trim();
  if (!clean) return;
  lastSpoken.push(clean);
  if (!settings.voice) return;
  speechQueue.push({ text: clean, mood: currentMood, audio: elevenAvailable ? fetchVoice(clean, currentMood) : null });
  if (!speaking) playNext();
}

async function fetchVoice(text, mood) {
  try {
    const res = await api('/api/tts', { method: 'POST', json: { text, mood, voiceId: settings.voiceId } });
    return await audioCtx.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function playNext() {
  const item = speechQueue.shift();
  if (!item) {
    speaking = false;
    oracle.setEnergy(0);
    if (pendingDone) { const f = pendingDone; pendingDone = null; f(); }
    return;
  }
  speaking = true;
  setState('speaking');
  // Decoded audio plays through the (already unlocked) AudioContext — reliable on iPhone too.
  const buffer = item.audio ? await item.audio : null;
  if (buffer) {
    usingBrowserVoice = false;
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(analyser);
    src.onended = () => playNext();
    src.start();
  } else {
    speakWithBrowser(item.text).then(playNext);
  }
}

function speakWithBrowser(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    usingBrowserVoice = true;
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => x.name === settings.browserVoice);
    if (v) u.voice = v;
    u.rate = 0.92;
    u.pitch = 0.85;
    // No audio stream to analyse here, so animate the voice from word boundaries.
    const pulse = setInterval(() => oracle.setEnergy(0.25 + Math.random() * 0.45), 90);
    u.onboundary = () => oracle.setEnergy(0.8);
    u.onend = u.onerror = () => { clearInterval(pulse); oracle.setEnergy(0); resolve(); };
    speechSynthesis.speak(u);
  });
}

function stopSpeaking() {
  speechQueue.length = 0;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

$('#replay').onclick = () => {
  ensureAudio();
  stopSpeaking();
  const lines = lastSpoken;
  lastSpoken = [];
  lines.forEach(enqueueSpeech);
};

// ───────────────── Voice in ─────────────────
// Browser speech recognition when available; otherwise record and transcribe with ElevenLabs Scribe.
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec;
let recorder;
let listening = false;

function setListening(on) {
  listening = on;
  $('#mic').classList.toggle('live', on);
  $('#talk').textContent = on ? '■ Stop' : '● Talk';
  if (on) setState('listening');
}

async function listen() {
  ensureAudio();
  stopSpeaking();
  showView('oracle');
  if (Rec) {
    rec = new Rec();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (const r of e.results) (r.isFinal ? (finalText = r[0].transcript) : (interim = r[0].transcript));
      $('#input').value = finalText || interim;
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) ask(finalText.trim());
      else setState('idle');
    };
    rec.start();
    setListening(true);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      setState('thinking');
      const fd = new FormData();
      fd.append('audio', new Blob(chunks, { type: recorder.mimeType }), 'speech.webm');
      try {
        const { text } = await getJSON('/api/stt', { method: 'POST', body: fd });
        if (text.trim()) ask(text.trim());
        else setState('idle');
      } catch (err) {
        setState('idle');
        alert(err.message);
      }
    };
    recorder.start();
    setListening(true);
  } catch {
    alert('Microphone unavailable.');
  }
}
function stopListening() {
  if (rec) rec.stop();
  if (recorder?.state === 'recording') recorder.stop();
}
const toggleMic = () => {
  // Live conversation (ElevenLabs) is the primary way to talk when it's set up.
  if (liveAvailable || live) return live ? endLive() : startLive();
  return listening ? stopListening() : listen();
};
$('#mic').onclick = toggleMic;
$('#talk').onclick = toggleMic;

// ───────────────── Live conversation (ElevenLabs Agents, WebRTC) ─────────────────
// Full-duplex: you talk, it answers in real time, and you can interrupt it.
// Eleven v4 Turbo voice; the brain is Claude inside the ElevenLabs agent, fed with
// your Soul profile and reading your library through the consult_library tool.
const ELEVEN_CLIENT = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.26.0/+esm';
let liveAvailable = false;
let live = null;
let liveTurns = [];
let liveRaf = 0;

function setLiveUI(on, label) {
  document.body.classList.toggle('is-live', on);
  $('#mic').classList.toggle('live', on);
  $('#talk').textContent = on ? '■ End' : '● Go live';
  $('#hint').textContent = label || (on ? 'Live — just talk. Interrupt any time.' : 'It reads what you need. Just speak.');
}

async function startLive() {
  if (live) return;
  ensureAudio();
  stopSpeaking();
  showView('oracle');
  setLiveUI(true, 'Connecting…');
  setState('thinking');
  try {
    // Ask for the mic first so the browser prompt appears right away (and works on iPhone).
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    mic.getTracks().forEach((t) => t.stop());
    const [{ Conversation }, session] = await Promise.all([import(ELEVEN_CLIENT), getJSON('/api/live/start')]);
    liveTurns = [];
    $('#hero').hidden = true;
    showAnswer();
    delete $('#mood-badge').dataset.mood;
    live = await Conversation.startSession({
      conversationToken: session.conversationToken,
      connectionType: 'webrtc',
      dynamicVariables: session.dynamicVariables,
      clientTools: {
        consult_library: async ({ query }) => {
          showReflection(`Consulting the library: ${query}`);
          try {
            const r = await getJSON('/api/live/library', { method: 'POST', json: { query } });
            if (r.sources) renderSources(r.sources);
            return r.result;
          } catch (err) {
            return `The library could not be reached (${err.message}).`;
          }
        },
      },
      onConnect: () => { setLiveUI(true); setState('listening'); },
      onModeChange: ({ mode }) => setState(mode === 'speaking' ? 'speaking' : 'listening'),
      onMessage: ({ message: raw, role, event_id: eventId, response_id: responseId }) => {
        const r = role === 'agent' ? 'assistant' : 'user';
        const message = stripTags(raw);
        // Streamed parts/resends share an id: update that turn instead of adding a duplicate.
        const key = `${r}:${responseId ?? eventId}`;
        const existing = liveTurns.find((t) => t.key === key);
        if (existing) {
          existing.text = message;
          existing.el.textContent = message;
        } else {
          liveTurns.push({ key, role: r, text: message, el: addLog(r, message) });
        }
        showAnswer();
        if (r === 'user') { $('#you').textContent = message; $('#said').textContent = ''; $('#sources').innerHTML = ''; }
        else $('#said').textContent = message;
      },
      onError: (message) => showReflection(`Live error: ${message}`),
      onDisconnect: () => finishLive(),
    });
    // Drive the orb from the real voices: the Oracle's when it speaks, yours when it listens.
    const tick = () => {
      if (!live) return;
      const v = oracle.state === 'speaking' ? live.getOutputVolume() : live.getInputVolume() * 0.5;
      oracle.setEnergy(Math.min(1, v * 0.75));
      liveRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch (err) {
    live = null;
    setLiveUI(false);
    setState('idle');
    showAnswer();
    $('#said').textContent = err.name === 'NotAllowedError' ? 'The Oracle needs your microphone to talk live. Allow it in your browser settings.' : `Couldn't go live: ${err.message}`;
  }
}

async function endLive() {
  if (!live) return;
  const session = live;
  await session.endSession().catch(() => {});
  finishLive();
}

function finishLive() {
  if (!live && !liveTurns.length) return;
  live = null;
  cancelAnimationFrame(liveRaf);
  oracle.setEnergy(0);
  setLiveUI(false);
  setState('idle');
  const turns = liveTurns.map(({ role, text }) => ({ role, text }));
  liveTurns = [];
  if (turns.length) api('/api/live/transcript', { method: 'POST', json: { turns } }).then(() => setTimeout(refreshSoul, 4000)).catch(() => {});
}
// Closing the tab mid-conversation still saves what was said.
addEventListener('pagehide', () => {
  if (!liveTurns.length) return;
  const turns = liveTurns.map(({ role, text }) => ({ role, text }));
  navigator.sendBeacon?.(`/api/live/transcript?t=${encodeURIComponent(settings.token || '')}`, new Blob([JSON.stringify({ turns })], { type: 'application/json' }));
});

// ───────────────── Conversation ─────────────────
let busy = false;
function addLog(role, text) {
  const d = el('div', `msg ${role}`, text);
  $('#log-body').append(d);
  $('#log-body').scrollTop = 1e9;
  return d;
}
$('#toggle-log').onclick = () => $('#log').classList.toggle('open');
$('#close-log').onclick = () => $('#log').classList.remove('open');

function showReflection(text) {
  const p = el('p', '', text);
  $('#reflections').append(p);
  setTimeout(() => p.remove(), 7000);
  while ($('#reflections').children.length > 3) $('#reflections').firstChild.remove();
}

const coverCache = new Map();
function renderSources(list) {
  const box = $('#sources');
  box.innerHTML = '';
  const seen = new Set();
  for (const s of list) {
    if (seen.has(s.title)) continue;
    seen.add(s.title);
    const chip = el('span');
    chip.title = s.excerpt;
    const cover = coverCache.get(s.docId);
    if (cover) {
      const img = el('img');
      img.src = cover;
      img.alt = '';
      chip.append(img);
    } else {
      const sw = el('i', 'sw');
      sw.style.background = gradientFor(s.title);
      chip.append(sw);
    }
    chip.append(s.title);
    box.append(chip);
  }
}

async function ask(message) {
  if (live && message) {
    // Typing while live: the agent hears it as if you'd said it.
    live.sendUserMessage(message);
    $('#input').value = '';
    autoGrow();
    return;
  }
  if (busy || !message) return;
  busy = true;
  showView('oracle');
  ensureAudio();
  stopSpeaking();
  lastSpoken = [];
  $('#input').value = '';
  autoGrow();
  setState('thinking');
  $('#hero').hidden = true;
  showAnswer();
  $('#sources').innerHTML = '';
  delete $('#mood-badge').dataset.mood;
  $('#mood-badge').textContent = 'Contemplating';
  $('#you').textContent = message;
  const said = $('#said');
  said.textContent = '';
  said.classList.add('thinking');
  $('#send').disabled = true;
  addLog('user', message);
  const logEntry = addLog('assistant', '');

  let full = '';
  let shown = '';
  let sentenceBuf = '';
  let reflectBuf = '';
  let moodParsed = false;

  const handleText = (chunk) => {
    full += chunk;
    if (!moodParsed) {
      const m = full.match(/^\s*\[mood:\s*([a-z]+)\s*\]\s*/i);
      if (m) {
        setMood(m[1].toLowerCase());
        moodParsed = true;
        chunk = full.slice(m[0].length);
      } else if (full.length < 40 && full.trimStart().startsWith('[')) {
        return; // tag still arriving
      } else {
        moodParsed = true;
        chunk = full;
      }
    }
    if (oracle.state === 'thinking') setState('speaking');
    shown += chunk;
    said.textContent = stripTags(shown);
    logEntry.textContent = stripTags(shown);
    said.scrollTop = 1e9;
    sentenceBuf += chunk;
    // Voice each complete sentence (or paragraph) as soon as it lands.
    const parts = sentenceBuf.split(/(?<=[.!?…])\s+|\n{2,}/);
    sentenceBuf = parts.pop();
    const ready = parts.join(' ').trim();
    if (ready) enqueueSpeech(ready);
  };

  try {
    const res = await api('/api/chat', { method: 'POST', json: { message } });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const event = raw.match(/^event: (.+)$/m)?.[1];
        const data = JSON.parse(raw.match(/^data: (.*)$/m)?.[1] ?? 'null');
        if (event === 'text') handleText(data);
        else if (event === 'reflection') {
          reflectBuf += data;
          const lines = reflectBuf.split(/(?<=[.!?])\s+/);
          reflectBuf = lines.pop();
          lines.filter((l) => l.length > 12).forEach(showReflection);
        } else if (event === 'sources') renderSources(data);
        else if (event === 'searching') showReflection('Searching beyond the library…');
        else if (event === 'web') {
          for (const w of data) {
            const a = el('a', 'web', `⌁ ${w.title || new URL(w.url).hostname}`);
            a.href = w.url;
            a.target = '_blank';
            a.rel = 'noopener';
            $('#sources').append(a);
          }
        } else if (event === 'error' || event === 'refusal') {
          said.textContent = data;
          logEntry.textContent = data;
        }
      }
    }
    if (sentenceBuf.trim()) enqueueSpeech(sentenceBuf);
  } catch (err) {
    said.textContent = `The Oracle is silent: ${err.message}`;
  } finally {
    busy = false;
    said.classList.remove('thinking');
    $('#send').disabled = false;
    const finish = () => {
      setState('idle');
      if (settings.handsfree && settings.voice) setTimeout(listen, 400);
      refreshSoul();
    };
    if (speaking || speechQueue.length) pendingDone = finish;
    else finish();
  }
}

$('#ask').onsubmit = (e) => { e.preventDefault(); ask($('#input').value.trim()); };
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($('#input').value.trim()); }
});
function autoGrow() { const t = $('#input'); t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 160)}px`; }
$('#input').addEventListener('input', () => { autoGrow(); oracle.notice('typing'); });
addEventListener('pointerdown', () => oracle.notice('touch'));

// ───────────────── Show / hide the conversation card ─────────────────
function showAnswer() {
  $('#answer').hidden = false;
  $('#hero').hidden = true;
  $('#show-answer').hidden = true;
}
function hideAnswer() {
  $('#answer').hidden = true;
  const hasConversation = $('#said').textContent.trim() || $('#you').textContent.trim();
  $('#show-answer').hidden = !hasConversation;
  $('#hero').hidden = Boolean(live);
}
$('#close-answer').onclick = hideAnswer;
$('#show-answer').onclick = showAnswer;
// Tapping the Oracle itself toggles the card, so the eye can have the whole screen.
$('#stage').addEventListener('click', () => {
  if (document.body.dataset.view !== 'oracle') return;
  if (!$('#answer').hidden) hideAnswer();
  else if (!$('#show-answer').hidden) showAnswer();
});

// ───────────────── Status & integrations ─────────────────
const INT_COLORS = { claude: '#d97757', websearch: '#7cc4ff', elevenlabs: '#f5f6f7', huggingface: '#ffd21e', gutenberg: '#c9a6ff', web: '#d4ff3a' };
let voicesLoaded = false;
async function loadStatus() {
  let s;
  try {
    s = await getJSON('/api/status');
  } catch (err) {
    $('#eyebrow').innerHTML = '';
    $('#eyebrow').append(el('i', 'dot'), ` ${err.message}`);
    return;
  }
  elevenAvailable = s.elevenlabs;
  liveAvailable = Boolean(s.live);
  if (!live) $('#talk').textContent = liveAvailable ? '● Go live' : '● Talk';
  $('#pill-mind').className = `pill status ${s.claude ? 'on' : 'off'}`;
  $('#pill-voice').className = `pill status ${s.elevenlabs ? 'on' : ''}`;
  $('#lib-count').textContent = s.library.works;
  const eyebrow = s.storageError
    ? `⚠ Memory isn't being saved — ${s.storageError}`
    : !s.claude
    ? 'Asleep — set ANTHROPIC_API_KEY on the server'
    : s.library.works
      ? `${s.library.works} works${s.library.studied ? ` · ${s.library.studied} studied` : ''}${s.library.studying ? ` · studying ${s.library.studying}…` : ''}`
      : 'Awake — feed it books in Library or Discover';
  $('#eyebrow').innerHTML = '';
  $('#eyebrow').append(el('i', 'dot'), ` ${eyebrow}`);
  // The Oracle's own first words, written after your last conversation.
  if (s.opening) { $('#hero-line').textContent = `“${s.opening}”`; $('#hero-line').classList.add('opening'); }

  if (!voicesLoaded && s.elevenlabs) {
    voicesLoaded = true;
    const voices = await getJSON('/api/voices').catch(() => []);
    for (const v of voices) $('#voice-select').append(new Option(v.name, v.id, false, v.id === settings.voiceId));
  }

  const grid = $('#int-grid');
  grid.innerHTML = '';
  for (const i of s.integrations) {
    const c = el('div', 'card integration');
    const top = el('div', 'top');
    const mark = el('span', 'mark', i.name[0]);
    mark.style.background = INT_COLORS[i.id] || 'var(--lime)';
    top.append(mark, el('span', `state ${i.connected ? 'on' : 'off'}`, i.connected ? 'Connected' : 'Setup'));
    c.append(top, el('b', '', i.name), el('small', '', i.role), el('div', 'detail', i.detail));
    grid.append(c);
  }
}

// ───────────────── Library ─────────────────
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
function gradientFor(title) {
  const h = hash(title || '');
  const a = h % 360;
  return `radial-gradient(120% 90% at 20% 10%, hsl(${a} 85% 62%), transparent 60%), radial-gradient(100% 80% at 90% 90%, hsl(${(a + 70) % 360} 80% 45%), transparent 60%), #15171a`;
}
function bookCard({ title, author, cover, tag, meta }) {
  const card = el('article', 'book');
  const cv = el('div', 'cover');
  const gen = () => {
    cv.style.background = gradientFor(title);
    const g = el('div', 'gen');
    g.append(el('b', '', title), el('small', '', author || ''));
    cv.append(g);
  };
  if (cover) {
    const img = el('img');
    img.src = cover;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => { img.remove(); gen(); };
    cv.append(img);
  } else gen();
  if (tag) { const t = el('span', 'badge tag', tag); card.append(t); }
  const m = el('div', 'meta');
  m.append(el('b', '', title), el('small', '', meta || author || ''));
  card.append(cv, m);
  return { card, meta: m };
}

let libraryDocs = [];
async function refreshLibrary() {
  try { libraryDocs = await getJSON('/api/library'); } catch { return; }
  for (const d of libraryDocs) if (d.cover) coverCache.set(d.id, d.cover);
  $('#lib-count').textContent = libraryDocs.length;
  const words = libraryDocs.reduce((s, d) => s + d.words, 0);
  $('#lib-stats').innerHTML = '';
  const pill = (n, label) => { const p = el('span', 'pill'); p.append(el('b', '', n), ` ${label}`); return p; };
  $('#lib-stats').append(pill(libraryDocs.length, 'works'), pill(words.toLocaleString(), 'words'));
  const list = $('#lib-list');
  list.innerHTML = '';
  if (!libraryDocs.length) list.append(el('p', 'empty', 'Nothing here yet. Drop a book above, or open Discover for one-click classics.'));
  for (const d of libraryDocs.slice().reverse()) {
    const studyTag = { queued: 'Studying…', studying: 'Studying…', done: 'Studied ✓', failed: 'Not studied' }[d.studyStatus];
    const { card } = bookCard({ title: d.title, author: d.author, cover: d.cover, tag: studyTag || (d.type === 'book' ? null : d.type), meta: `${d.author ? `${d.author} · ` : ''}${d.words.toLocaleString()} words` });
    if (d.studyStatus === 'done') card.querySelector('.tag')?.classList.add('done');
    card.onclick = (e) => { if (!e.target.closest('.remove')) openStudy(d); };
    const rm = el('button', 'remove', '✕');
    rm.title = 'Remove from library';
    rm.onclick = async () => {
      if (!confirm(`Remove “${d.title}” from the library?`)) return;
      await api(`/api/library/${d.id}`, { method: 'DELETE' });
      refreshLibrary();
    };
    card.append(rm);
    list.append(card);
  }
}

function toast(id, msg, err = false) {
  $(id).textContent = msg;
  $(id).classList.toggle('err', err);
}

function openStudy(d) {
  const box = $('#study-body');
  box.innerHTML = '';
  box.append(el('span', 'kicker', d.author || ''), el('h3', '', d.title));
  const s = d.study;
  if (!s) {
    box.append(el('p', 'muted', d.studyStatus === 'failed'
      ? `The Oracle couldn't study this one (${d.studyError || 'unknown error'}). It can still quote and search it.`
      : 'The Oracle is reading this right now. Its notes will appear here in a few minutes.'));
  } else {
    box.append(el('p', 'essence', s.essence));
    const section = (title, items) => {
      if (!items?.length) return;
      box.append(el('b', 'sec', title));
      const ul = el('ul');
      for (const it of items) ul.append(el('li', '', it));
      box.append(ul);
    };
    section('Key ideas', s.keyIdeas);
    section('Living it', s.howToApply);
    section('Especially for', s.forMoments);
    if (s.authorVoice) { box.append(el('b', 'sec', 'How the author thinks')); box.append(el('p', '', s.authorVoice)); }
    section('Passages (verified word-for-word)', s.passages.map((q) => `“${q}”`));
    if (s.partial) box.append(el('p', 'muted', 'This book was very long; the notes cover its first part.'));
  }
  $('#study').hidden = false;
}
$('#study').onclick = (e) => { if (e.target.id === 'study' || e.target.id === 'close-study') $('#study').hidden = true; };

async function uploadFiles(files) {
  if (!files.length) return;
  showReflection(`Absorbing ${files.length === 1 ? files[0].name : `${files.length} works`}…`);
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  toast('#lib-status', `Absorbing ${files.length} work(s)… large books take a moment.`);
  setState('thinking');
  try {
    const r = await getJSON('/api/library/upload', { method: 'POST', body: fd });
    toast('#lib-status', `Absorbed ${r.added.length}.${r.failed.length ? ` Could not read: ${r.failed.map((f) => `${f.name} (${f.error})`).join(', ')}` : ''}`, r.failed.length > 0);
  } catch (err) {
    toast('#lib-status', err.message, true);
  }
  setState('idle');
  refreshLibrary();
}
$('#files').onchange = (e) => uploadFiles([...e.target.files]);
// Add books straight from the home screen; the Oracle studies them in the background.
$('#attach').onclick = () => $('#quick-files').click();
$('#quick-files').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  await uploadFiles(files);
  showReflection('It will study them in the background and draw on them when you talk.');
  loadStatus();
};
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('hover'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('hover'); }));
drop.addEventListener('drop', (e) => uploadFiles([...e.dataTransfer.files]));

$('#url-form').onsubmit = async (e) => {
  e.preventDefault();
  const url = $('#url').value.trim();
  if (!url) return;
  toast('#lib-status', 'Reaching out…');
  try {
    const d = await getJSON('/api/library/url', { method: 'POST', json: { url } });
    toast('#lib-status', `Absorbed “${d.title}”.`);
    $('#url').value = '';
  } catch (err) {
    toast('#lib-status', err.message, true);
  }
  refreshLibrary();
};

$('#text-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/library/text', { method: 'POST', json: { title: $('#text-title').value, author: $('#text-author').value, text: $('#text-body').value } });
    e.target.reset();
    toast('#lib-status', 'Absorbed.');
  } catch (err) {
    toast('#lib-status', err.message, true);
  }
  refreshLibrary();
};

// ───────────────── Discover (Project Gutenberg) ─────────────────
function renderGutenberg(books, { tagKey } = {}) {
  const grid = $('#gut-grid');
  grid.innerHTML = '';
  if (!books.length) grid.append(el('p', 'empty', 'No books found. Try another name.'));
  const owned = new Set(libraryDocs.map((d) => d.source));
  for (const b of books) {
    const { card, meta } = bookCard({ title: b.title, author: b.author, cover: b.cover, tag: tagKey ? b[tagKey] : null });
    const act = el('div', 'act');
    if (owned.has(`gutenberg:${b.id}`)) act.append(el('span', 'owned', '✓ In your library'));
    else {
      const btn = el('button', 'btn-lime', '+ Absorb');
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'Absorbing…';
        try {
          const d = await getJSON('/api/gutenberg/import', { method: 'POST', json: { id: b.id, title: b.title, author: b.author } });
          libraryDocs.push(d);
          act.innerHTML = '';
          act.append(el('span', 'owned', `✓ ${d.words.toLocaleString()} words absorbed`));
          toast('#gut-status', `“${d.title}” is now part of the Oracle.`);
          loadStatus();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '+ Absorb';
          toast('#gut-status', err.message, true);
        }
      };
      act.append(btn);
    }
    meta.append(act);
    grid.append(card);
  }
}
async function loadClassics() {
  if (!libraryDocs.length) await refreshLibrary();
  try { renderGutenberg(await getJSON('/api/gutenberg/classics'), { tagKey: 'tradition' }); } catch (err) { toast('#gut-status', err.message, true); }
}
$('#gut-search').onsubmit = async (e) => {
  e.preventDefault();
  const q = $('#gut-q').value.trim();
  if (!q) return loadClassics();
  toast('#gut-status', 'Searching the archive…');
  try {
    renderGutenberg(await getJSON(`/api/gutenberg/search?q=${encodeURIComponent(q)}`));
    toast('#gut-status', '');
  } catch (err) {
    toast('#gut-status', err.message, true);
  }
};

// ───────────────── Soul ─────────────────
async function refreshSoul() {
  let p;
  try { p = await getJSON('/api/profile'); } catch { return; }
  const form = $('#soul-form');
  for (const k of ['name', 'about', 'values', 'goals', 'struggles']) {
    if (document.activeElement !== form[k]) form[k].value = p[k] || '';
  }
  const traits = $('#traits');
  traits.innerHTML = '';
  const entries = Object.entries(p.traits || {});
  if (!entries.length) traits.append(el('p', 'empty', 'Talk with the Oracle and it will begin to read you.'));
  for (const [k, v] of entries) {
    const d = el('div');
    d.append(el('span', '', k), el('p', '', v));
    traits.append(d);
  }
  const ul = $('#insights');
  ul.innerHTML = '';
  if (!p.insights?.length) ul.append(el('li', 'empty', 'Nothing learned yet.'));
  for (const [i, s] of (p.insights || []).entries()) {
    const li = el('li', '', s);
    li.onclick = async () => {
      if (!confirm('Have the Oracle forget this?')) return;
      await api('/api/profile', { method: 'PUT', json: { insights: p.insights.filter((_, j) => j !== i) } });
      refreshSoul();
    };
    ul.append(li);
  }
}
$('#soul-form').onsubmit = async (e) => {
  e.preventDefault();
  await api('/api/profile', { method: 'PUT', json: Object.fromEntries(new FormData(e.target)) });
  const b = e.target.querySelector('button');
  b.textContent = 'Saved ✓';
  setTimeout(() => (b.textContent = 'Save'), 1500);
};

// ───────────────── Settings ─────────────────
const bindToggle = (id, key, after) => {
  $(id).checked = settings[key];
  $(id).onchange = (e) => { settings[key] = e.target.checked; persist(); after?.(e.target.checked); };
};
bindToggle('#voice-on', 'voice', (on) => !on && stopSpeaking());
bindToggle('#handsfree', 'handsfree');
bindToggle('#ambience-on', 'ambience', (on) => { ensureAudio(); ambience.toggle(on); });
$('#token').value = settings.token;
$('#voice-select').onchange = (e) => { settings.voiceId = e.target.value; persist(); };
$('#browser-voice').onchange = (e) => { settings.browserVoice = e.target.value; persist(); };
$('#token').onchange = (e) => { settings.token = e.target.value; persist(); loadStatus(); };
function fillBrowserVoices() {
  const sel = $('#browser-voice');
  sel.innerHTML = '';
  for (const v of speechSynthesis.getVoices()) sel.append(new Option(`${v.name} (${v.lang})`, v.name, false, v.name === settings.browserVoice));
}
if ('speechSynthesis' in window) { fillBrowserVoices(); speechSynthesis.onvoiceschanged = fillBrowserVoices; }
$('#forget').onclick = async () => {
  if (!confirm('Forget the conversation history? (Your soul profile and library stay.)')) return;
  await api('/api/history', { method: 'DELETE' });
  $('#log-body').innerHTML = '';
};
// Browsers only allow sound after a gesture; resume ambience on the first one.
addEventListener('pointerdown', () => { if (settings.ambience) { ensureAudio(); ambience.toggle(true); } }, { once: true });

// ───────────────── Install as an app ─────────────────
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// ───────────────── Boot ─────────────────
(async () => {
  await loadStatus();
  refreshLibrary();
  try {
    const hist = await getJSON('/api/history');
    for (const m of hist) addLog(m.role, stripTags(m.content));
  } catch { /* empty */ }
  setInterval(loadStatus, 15000);
})();
