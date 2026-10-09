// Background study: when a book arrives, the Oracle reads the whole thing (Claude's
// 1M-token context fits most books in one pass) and writes its own study notes —
// essence, key ideas, how to live them, the author's way of thinking, and a few
// passages worth quoting. Quotes are kept only if they appear verbatim in the text.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.STUDY_MODEL || process.env.ORACLE_MODEL || 'claude-opus-5-5';
const MAX_CHARS = Number(process.env.STUDY_MAX_CHARS || 1_200_000); // ~300k tokens
export const enabled = process.env.STUDY_BOOKS !== 'off';

let client;
const queue = [];
let working = false;
let hooks;

/** hooks: { getText(docId) -> string, getDoc(docId) -> doc, save(doc) -> Promise } */
export function init(h) {
  hooks = h;
}

export function enqueue(docId) {
  if (!enabled || !hooks || queue.includes(docId)) return;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return;
  const doc = hooks.getDoc(docId);
  if (!doc) return;
  doc.studyStatus = 'queued';
  hooks.save(doc).catch(() => {});
  queue.push(docId);
  if (!working) drain();
}

async function drain() {
  working = true;
  while (queue.length) {
    const id = queue.shift();
    const doc = hooks.getDoc(id);
    if (!doc) continue;
    try {
      doc.studyStatus = 'studying';
      await hooks.save(doc);
      doc.study = await study(doc, hooks.getText(id));
      doc.studyStatus = 'done';
    } catch (err) {
      console.warn(`[study] "${doc.title}" failed:`, err.message);
      doc.studyStatus = 'failed';
      doc.studyError = err.message.slice(0, 200);
    }
    if (hooks.getDoc(id)) await hooks.save(doc).catch(() => {});
  }
  working = false;
}

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function study(doc, fullText) {
  client ??= new Anthropic();
  const text = fullText.length > MAX_CHARS ? fullText.slice(0, MAX_CHARS) : fullText;
  const truncated = text.length < fullText.length;
  const prompt = `<book title="${doc.title.replace(/"/g, "'")}" author="${(doc.author || 'unknown').replace(/"/g, "'")}">
${text}
</book>
${truncated ? '\n(The book was too long to include completely; this is its first part.)\n' : ''}
You are a wise guide who will counsel one person using this book. Study it closely and write your private study notes.

Return ONLY a JSON object:
{"essence": "the heart of this work in 80-150 words, in your own words",
 "key_ideas": ["8-15 distinct ideas, each one sentence, concrete enough to apply"],
 "how_to_apply": ["4-8 practical ways someone could live these ideas in daily life"],
 "author_voice": "how this author thinks and speaks — tone, favourite moves, what they'd push back on — in 40-80 words, so you can speak in their spirit",
 "for_moments": ["4-8 life situations where this book is especially worth drawing on, e.g. 'when grieving', 'before a hard decision'"],
 "passages": ["3-8 short passages worth quoting, copied EXACTLY, word for word, from the book, each under 45 words"]}`;

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: prompt }],
  });
  const res = await stream.finalMessage();
  if (res.stop_reason === 'refusal') throw new Error('The model declined to study this text.');
  const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const haystack = norm(fullText);
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const list = (v, n, len) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, n).map((x) => x.slice(0, len)) : []);
  return {
    essence: str(json.essence, 1500),
    keyIdeas: list(json.key_ideas, 15, 300),
    howToApply: list(json.how_to_apply, 8, 300),
    authorVoice: str(json.author_voice, 800),
    forMoments: list(json.for_moments, 8, 120),
    // Never keep a "quote" that isn't really in the book.
    passages: list(json.passages, 8, 400).filter((q) => norm(q).length > 15 && haystack.includes(norm(q))),
    partial: truncated,
    at: new Date().toISOString(),
  };
}

/** Compact text of a work's study notes, for prompts. */
export function brief(doc, full = false) {
  const s = doc.study;
  if (!s) return '';
  const parts = [`${doc.title}${doc.author ? ` — ${doc.author}` : ''}: ${s.essence}`];
  if (full) {
    if (s.keyIdeas.length) parts.push(`Key ideas: ${s.keyIdeas.join(' | ')}`);
    if (s.authorVoice) parts.push(`Voice: ${s.authorVoice}`);
    if (s.forMoments.length) parts.push(`Especially for: ${s.forMoments.join(', ')}`);
    if (s.passages.length) parts.push(`Verified quotable passages: ${s.passages.map((q) => `"${q}"`).join(' ')}`);
  }
  return parts.join('\n');
}
