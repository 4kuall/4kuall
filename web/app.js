import { Oracle3D } from './oracle3d.js';

const $ = (s) => document.querySelector(s);
const oracle = new Oracle3D($('#stage'));

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const settings = store.get('oracle.settings', { voice: true, handsfree: false, voiceId: '', browserVoice: '', lens: 'oracle', token: '' });
const persist = () => store.set('oracle.settings', settings);

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (settings.token) headers['x-access-token'] = settings.token;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
  }
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok && !res.headers.get('content-type')?.includes('event-stream')) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res;
}

// ---------------- State label ----------------
const STATE_WORDS = { idle: 'resting', listening: 'listening', thinking: 'contemplating', speaking: 'speaking' };
function setState(s) {
  oracle.setState(s);
  $('#state-label').textContent = STATE_WORDS[s];
}

// ---------------- Voice out ----------------
// Sentences are voiced as they stream in, so the Oracle starts speaking quickly.
let audioCtx;
let analyser;
const speechQueue = [];
let speaking = false;
let currentMood = 'serene';
let pendingDone = null;

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.connect(audioCtx.destination);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    if (speaking && analyser) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      if (!usingBrowserVoice) oracle.setEnergy(rms * 4.5);
    }
    requestAnimationFrame(tick);
  };
  tick();
}

let elevenAvailable = true;
let usingBrowserVoice = false;

function enqueueSpeech(text) {
  const clean = text.replace(/\[mood:[^\]]*\]/gi, '').replace(/[*_#>`]/g, '').trim();
  if (!clean || !settings.voice) return;
  speechQueue.push({ text: clean, mood: currentMood, audio: elevenAvailable ? fetchVoice(clean, currentMood) : null });
  if (!speaking) playNext();
}

async function fetchVoice(text, mood) {
  try {
    const res = await api('/api/tts', { method: 'POST', json: { text, mood, voiceId: settings.voiceId } });
    return URL.createObjectURL(await res.blob());
  } catch {
    elevenAvailable = false;
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
  const url = item.audio ? await item.audio : null;
  if (url) {
    usingBrowserVoice = false;
    const el = new Audio(url);
    audioCtx.createMediaElementSource(el).connect(analyser);
    el.onended = () => { URL.revokeObjectURL(url); playNext(); };
    el.onerror = () => playNext();
    el.play().catch(() => playNext());
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

// ---------------- Voice in ----------------
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec;
let listening = false;
function listen() {
  if (!Rec) { alert('Voice input needs Chrome, Edge or Safari.'); return; }
  ensureAudio();
  stopSpeaking();
  rec = new Rec();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (const r of e.results) (r.isFinal ? (finalText = r[0].transcript) : (interim = r[0].transcript));
    $('#input').value = finalText || interim;
  };
  rec.onend = () => {
    listening = false;
    $('#mic').classList.remove('live');
    if (finalText.trim()) ask(finalText.trim());
    else setState('idle');
  };
  rec.start();
  listening = true;
  $('#mic').classList.add('live');
  setState('listening');
}
$('#mic').onclick = () => (listening ? rec.stop() : listen());

// ---------------- Conversation ----------------
let busy = false;
function addLog(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  $('#log-body').append(div);
  $('#log').scrollTop = 1e9;
  return div;
}

function showReflection(text) {
  const p = document.createElement('p');
  p.textContent = text;
  $('#reflections').append(p);
  setTimeout(() => p.remove(), 7000);
  while ($('#reflections').children.length > 3) $('#reflections').firstChild.remove();
}

async function ask(message) {
  if (busy || !message) return;
  busy = true;
  ensureAudio();
  stopSpeaking();
  $('#input').value = '';
  autoGrow();
  setState('thinking');
  $('#sources').innerHTML = '';
  const out = $('#utterance');
  out.innerHTML = '';
  const you = document.createElement('p');
  you.className = 'you';
  you.textContent = `“${message}”`;
  const said = document.createElement('p');
  out.append(you, said);
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
        currentMood = m[1].toLowerCase();
        oracle.setMood(currentMood);
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
    said.textContent = shown;
    logEntry.textContent = shown;
    out.scrollTop = 1e9;
    sentenceBuf += chunk;
    // Voice each complete sentence (or paragraph) as soon as it lands.
    const parts = sentenceBuf.split(/(?<=[.!?…])\s+|\n{2,}/);
    sentenceBuf = parts.pop();
    const ready = parts.join(' ').trim();
    if (ready.length) enqueueSpeech(ready);
  };

  try {
    const res = await api('/api/chat', { method: 'POST', json: { message, lens: settings.lens } });
    if (!res.ok) throw new Error((await res.json()).error);
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
        } else if (event === 'sources') {
          const seen = new Set();
          $('#sources').innerHTML = '';
          for (const s of data) {
            if (seen.has(s.title)) continue;
            seen.add(s.title);
            const tag = document.createElement('span');
            tag.textContent = `📖 ${s.title}`;
            tag.title = s.excerpt;
            $('#sources').append(tag);
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
function autoGrow() { const t = $('#input'); t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 140)}px`; }
$('#input').addEventListener('input', autoGrow);
document.querySelectorAll('[data-prompt]').forEach((b) => (b.onclick = () => ask(b.dataset.prompt)));

// ---------------- Panels ----------------
function closePanels() {
  document.querySelectorAll('.panel.open').forEach((p) => p.classList.remove('open'));
  $('#veil').hidden = true;
}
function openPanel(id) {
  const wasOpen = $(`#${id}`).classList.contains('open');
  closePanels();
  if (wasOpen) return;
  $(`#${id}`).classList.add('open');
  $('#veil').hidden = false;
  if (id === 'library') refreshLibrary();
  if (id === 'soul') refreshSoul();
}
document.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openPanel(b.dataset.open)));
$('#toggle-log').onclick = () => openPanel('log');
$('#veil').onclick = closePanels;
addEventListener('keydown', (e) => e.key === 'Escape' && closePanels());

// ---------------- Lenses ----------------
async function loadStatus() {
  try {
    const s = await (await api('/api/status')).json();
    $('#lenses').innerHTML = '';
    for (const l of s.lenses) {
      const b = document.createElement('button');
      b.textContent = l.name;
      b.className = l.id === settings.lens ? 'on' : '';
      b.onclick = () => {
        settings.lens = l.id;
        persist();
        $('#lens-name').textContent = l.name;
        document.querySelectorAll('#lenses button').forEach((x) => x.classList.toggle('on', x === b));
      };
      if (l.id === settings.lens) $('#lens-name').textContent = l.name;
      $('#lenses').append(b);
    }
    elevenAvailable = s.elevenlabs;
    $('#status').innerHTML = `Mind (Claude): ${s.claude ? '✓ connected' : '✗ set ANTHROPIC_API_KEY'}<br>Voice (ElevenLabs): ${s.elevenlabs ? '✓ connected' : '– using browser voice'}<br>Library: ${s.library.works} works, ${s.library.passages} passages`;
    if (!s.claude) $('#utterance').innerHTML = '<p>I am not yet awake. Give me a key to the world — set <b>ANTHROPIC_API_KEY</b> on the server.</p>';
    else if (!s.library.works) $('#utterance').innerHTML = '<p>I am here. Open the Library and give me the books that shaped you — then speak.</p>';
    if (s.elevenlabs) {
      const voices = await (await api('/api/voices')).json();
      for (const v of voices) $('#voice-select').append(new Option(v.name, v.id, false, v.id === settings.voiceId));
    }
  } catch (err) {
    $('#status').textContent = err.message;
  }
}

// ---------------- Library ----------------
async function refreshLibrary() {
  const docs = await (await api('/api/library')).json();
  $('#lib-stats').textContent = `${docs.length} works`;
  $('#lib-list').innerHTML = '';
  for (const d of docs.slice().reverse()) {
    const li = document.createElement('li');
    li.innerHTML = '<div><div class="t"></div><div class="m"></div></div><button title="Remove">✕</button>';
    li.querySelector('.t').textContent = d.title;
    li.querySelector('.m').textContent = `${d.author ? `${d.author} · ` : ''}${d.type} · ${d.words.toLocaleString()} words`;
    li.querySelector('button').onclick = async () => {
      if (!confirm(`Remove “${d.title}” from the library?`)) return;
      await api(`/api/library/${d.id}`, { method: 'DELETE' });
      refreshLibrary();
    };
    $('#lib-list').append(li);
  }
}

async function uploadFiles(files) {
  if (!files.length) return;
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  $('#lib-status').textContent = `Absorbing ${files.length} work(s)… large books take a moment.`;
  setState('thinking');
  try {
    const r = await (await api('/api/library/upload', { method: 'POST', body: fd })).json();
    $('#lib-status').textContent = `Absorbed ${r.added.length}.${r.failed.length ? ` Could not read: ${r.failed.map((f) => `${f.name} (${f.error})`).join(', ')}` : ''}`;
  } catch (err) {
    $('#lib-status').textContent = err.message;
  }
  setState('idle');
  refreshLibrary();
}
$('#files').onchange = (e) => uploadFiles([...e.target.files]);
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('hover'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('hover'); }));
drop.addEventListener('drop', (e) => uploadFiles([...e.dataTransfer.files]));

$('#url-form').onsubmit = async (e) => {
  e.preventDefault();
  const url = $('#url').value.trim();
  if (!url) return;
  $('#lib-status').textContent = 'Reaching out…';
  try {
    const d = await (await api('/api/library/url', { method: 'POST', json: { url } })).json();
    $('#lib-status').textContent = `Absorbed “${d.title}”.`;
    $('#url').value = '';
  } catch (err) {
    $('#lib-status').textContent = err.message;
  }
  refreshLibrary();
};

$('#text-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/library/text', { method: 'POST', json: { title: $('#text-title').value, author: $('#text-author').value, text: $('#text-body').value } });
    e.target.reset();
    $('#lib-status').textContent = 'Absorbed.';
  } catch (err) {
    $('#lib-status').textContent = err.message;
  }
  refreshLibrary();
};

// ---------------- Soul ----------------
async function refreshSoul() {
  try {
    const p = await (await api('/api/profile')).json();
    const form = $('#soul-form');
    for (const k of ['name', 'about', 'values', 'goals', 'struggles']) {
      if (document.activeElement !== form[k]) form[k].value = p[k] || '';
    }
    $('#traits').innerHTML = '';
    for (const [k, v] of Object.entries(p.traits || {})) {
      const d = document.createElement('div');
      d.innerHTML = '<b></b> — <span></span>';
      d.querySelector('b').textContent = k;
      d.querySelector('span').textContent = v;
      $('#traits').append(d);
    }
    $('#insights').innerHTML = '';
    for (const [i, s] of (p.insights || []).entries()) {
      const li = document.createElement('li');
      li.textContent = s;
      li.title = 'Click to forget this';
      li.style.cursor = 'pointer';
      li.onclick = async () => {
        if (!confirm('Have the Oracle forget this?')) return;
        await api('/api/profile', { method: 'PUT', json: { insights: p.insights.filter((_, j) => j !== i) } });
        refreshSoul();
      };
      $('#insights').append(li);
    }
  } catch { /* server offline */ }
}
$('#soul-form').onsubmit = async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  await api('/api/profile', { method: 'PUT', json: data });
  e.target.querySelector('button').textContent = 'Saved ✓';
  setTimeout(() => (e.target.querySelector('button').textContent = 'Save'), 1500);
};

// ---------------- Settings ----------------
$('#voice-on').checked = settings.voice;
$('#handsfree').checked = settings.handsfree;
$('#token').value = settings.token;
$('#voice-on').onchange = (e) => { settings.voice = e.target.checked; if (!settings.voice) stopSpeaking(); persist(); };
$('#handsfree').onchange = (e) => { settings.handsfree = e.target.checked; persist(); };
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

// ---------------- Boot ----------------
(async () => {
  await loadStatus();
  try {
    const hist = await (await api('/api/history')).json();
    for (const m of hist) addLog(m.role, m.content.replace(/^\s*\[mood:[^\]]*\]\s*/i, ''));
  } catch { /* empty */ }
})();
