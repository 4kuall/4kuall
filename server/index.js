import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import * as library from './library.js';
import * as oracle from './oracle.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.resolve('web')));

// Optional shared-secret gate so you can host it without the world reading your soul.
app.use('/api', (req, res, next) => {
  const secret = process.env.ACCESS_TOKEN;
  if (!secret || req.get('x-access-token') === secret) return next();
  res.status(401).json({ error: 'Access token required.' });
});

app.get('/api/status', (_req, res) => {
  const lib = library.stats();
  const claude = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const eleven = Boolean(process.env.ELEVENLABS_API_KEY);
  res.json({
    claude,
    elevenlabs: eleven,
    library: lib,
    integrations: [
      { id: 'claude', name: 'Claude', role: 'Mind · reasoning · memory', connected: claude, detail: claude ? process.env.ORACLE_MODEL || 'claude-opus-5-5' : 'Set ANTHROPIC_API_KEY' },
      { id: 'websearch', name: 'Web Search', role: 'Live knowledge beyond your library', connected: claude, detail: 'Toggle "Web" in the composer' },
      { id: 'elevenlabs', name: 'ElevenLabs', role: 'Voice out · speech-to-text in', connected: eleven, detail: eleven ? 'Voice + Scribe STT' : 'Set ELEVENLABS_API_KEY (browser voice used meanwhile)' },
      { id: 'huggingface', name: 'Hugging Face', role: 'Semantic search (local embeddings)', connected: lib.semantic.enabled && lib.semantic.ready, detail: lib.semantic.error || (lib.semantic.ready ? `${lib.semantic.indexedWorks}/${lib.works} works indexed${lib.semantic.pending ? ` · ${lib.semantic.pending} passages queued` : ''}` : 'Loads on first use') },
      { id: 'gutenberg', name: 'Project Gutenberg', role: '70,000+ free classics, one click', connected: true, detail: 'Open Discover' },
      { id: 'web', name: 'Blogs · Reddit · GitHub', role: 'Absorb any link', connected: true, detail: 'Paste a URL in the Library' },
    ],
    lenses: Object.entries(oracle.LENSES).map(([id, l]) => ({ id, name: l.name })),
  });
});

// ---------- Library ----------
app.get('/api/library', (_req, res) => res.json(library.listDocs()));

app.post('/api/library/upload', upload.array('files', 50), async (req, res) => {
  const added = [];
  const failed = [];
  for (const file of req.files || []) {
    try {
      const r = await library.extractFromFile(file);
      added.push(library.addDocument({ ...r, author: req.body.author || r.author, source: file.originalname }));
    } catch (err) {
      failed.push({ name: file.originalname, error: err.message });
    }
  }
  res.json({ added, failed });
});

app.post('/api/library/url', async (req, res) => {
  try {
    const r = await library.extractFromUrl(String(req.body.url || ''));
    res.json(library.addDocument({ ...r, source: req.body.url }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/library/text', (req, res) => {
  try {
    const { title, author, text } = req.body;
    res.json(library.addDocument({ title, author, text, type: 'note', source: 'pasted' }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/gutenberg/classics', (_req, res) => res.json(library.CLASSICS));
app.get('/api/gutenberg/search', async (req, res) => {
  try {
    res.json(await library.searchGutenberg(String(req.query.q || '')));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
app.post('/api/gutenberg/import', async (req, res) => {
  try {
    res.json(await library.importGutenberg(req.body.id, { title: req.body.title, author: req.body.author }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/library/:id', (req, res) => {
  library.removeDocument(req.params.id);
  res.json({ ok: true });
});

// ---------- Soul profile & memory ----------
app.get('/api/profile', (_req, res) => res.json(oracle.getProfile()));
app.put('/api/profile', (req, res) => res.json(oracle.setProfile(req.body || {})));
app.get('/api/history', (_req, res) => res.json(oracle.getHistory().slice(-60)));
app.delete('/api/history', (_req, res) => {
  oracle.clearHistory();
  res.json({ ok: true });
});

// ---------- Conversation (Server-Sent Events) ----------
app.post('/api/chat', async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Say something.' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    await oracle.converse({ message, lens: req.body.lens, web: Boolean(req.body.web) }, emit);
  } catch (err) {
    console.error('[chat]', err);
    emit('error', err.status === 401 || /authentication/i.test(err.message) ? 'The Oracle has no key to the world yet — set ANTHROPIC_API_KEY.' : err.message);
  }
  res.end();
});

// ---------- Voice (ElevenLabs) ----------
const MOOD_VOICE = {
  serene: { stability: 0.6, style: 0.2 },
  compassionate: { stability: 0.5, style: 0.35 },
  joyful: { stability: 0.35, style: 0.55 },
  grave: { stability: 0.7, style: 0.25 },
  fierce: { stability: 0.3, style: 0.7 },
  curious: { stability: 0.45, style: 0.45 },
  melancholic: { stability: 0.6, style: 0.4 },
  awed: { stability: 0.4, style: 0.5 },
};

app.post('/api/tts', async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(501).json({ error: 'ELEVENLABS_API_KEY not set; using browser voice.' });
  const voiceId = req.body.voiceId || process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) return res.status(400).json({ error: 'Set ELEVENLABS_VOICE_ID or choose a voice in Settings.' });
  const mood = MOOD_VOICE[req.body.mood] || MOOD_VOICE.serene;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: String(req.body.text || '').slice(0, 2500),
      model_id: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
      voice_settings: { ...mood, similarity_boost: 0.8, use_speaker_boost: true },
    }),
  });
  if (!r.ok) return res.status(r.status).json({ error: await r.text() });
  res.setHeader('Content-Type', 'audio/mpeg');
  res.send(Buffer.from(await r.arrayBuffer()));
});

// Speech-to-text fallback (ElevenLabs Scribe) for browsers without built-in recognition.
app.post('/api/stt', upload.single('audio'), async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.status(501).json({ error: 'Voice input needs Chrome/Edge/Safari, or set ELEVENLABS_API_KEY.' });
  if (!req.file) return res.status(400).json({ error: 'No audio received.' });
  const fd = new FormData();
  fd.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v1');
  fd.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), 'speech.webm');
  const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
  if (!r.ok) return res.status(r.status).json({ error: await r.text() });
  const data = await r.json();
  res.json({ text: data.text || '' });
});

app.get('/api/voices', async (_req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return res.json([]);
  const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
  if (!r.ok) return res.json([]);
  const data = await r.json();
  res.json((data.voices || []).map((v) => ({ id: v.voice_id, name: v.name })));
});

const port = Number(process.env.PORT || 3333);
app.listen(port, () => console.log(`\n  ◉  The Oracle is awake at http://localhost:${port}\n`));
