// The Library: ingests books, blogs, Reddit threads and GitHub READMEs,
// splits them into passages, and retrieves the most relevant ones with BM25.
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import * as store from './store.js';
import * as semantic from './semantic.js';
import * as study from './study.js';

const CHUNK_WORDS = 220;
const CHUNK_OVERLAP = 40;

const STOPWORDS = new Set(
  `a an and are as at be but by for from has have he her his i if in into is it its
  me my of on or our she so that the their them then there these they this to was we
  were what when where which who will with you your not no do does did can could would
  should about than too very just also been being am all any some more most such only`.split(/\s+/),
);

const library = store.loadLibrary();
let index = buildIndex(library.chunks);

export const getDoc = (id) => library.docs.find((d) => d.id === id);

/** Rebuild a work's full text from its overlapping passages. */
export function fullText(id) {
  return library.chunks
    .filter((c) => c.docId === id)
    .sort((a, b) => a.i - b.i)
    .map((c, n) => (n === 0 ? c.text : c.text.split(' ').slice(CHUNK_OVERLAP).join(' ')))
    .join(' ');
}

// Every work gets studied in the background (once), and the notes are saved with it.
study.init({ getDoc, getText: fullText, save: (doc) => store.updateDoc(doc) });
for (const d of library.docs) {
  if (!d.study && d.studyStatus !== 'failed' && d.words > 300) study.enqueue(d.id);
}

// Backfill semantic vectors for any works that don't have them yet.
for (const d of library.docs) {
  if (!semantic.has(d.id)) semantic.enqueue(d.id, library.chunks.filter((c) => c.docId === d.id).map((c) => c.text));
}

function tokenize(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function buildIndex(chunks) {
  const df = new Map();
  const docs = chunks.map((c) => {
    const tf = new Map();
    const tokens = tokenize(c.text);
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { tf, len: tokens.length };
  });
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(docs.length, 1);
  return { df, docs, avgLen, n: docs.length };
}

function bm25(query, k) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !index.n) return [];
  const k1 = 1.4;
  const b = 0.75;
  const scored = [];
  index.docs.forEach((d, i) => {
    let score = 0;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const df = index.df.get(t);
      const idf = Math.log(1 + (index.n - df + 0.5) / (df + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / index.avgLen)));
    }
    if (score > 0) scored.push({ i, score });
  });
  return scored.sort((a, b2) => b2.score - a.score).slice(0, k);
}

/**
 * Hybrid retrieval: keyword (BM25) and meaning (Hugging Face embeddings),
 * merged with reciprocal-rank fusion so either signal can surface a passage.
 */
export async function search(query, k = 8) {
  const fused = new Map(); // chunk index -> score
  const add = (i, rank) => fused.set(i, (fused.get(i) || 0) + 1 / (60 + rank));
  bm25(query, 40).forEach((h, rank) => add(h.i, rank));
  const semHits = await semantic.search(query, 40);
  if (semHits.length) {
    const pos = new Map(library.chunks.map((c, i) => [`${c.docId}:${c.i}`, i]));
    semHits.forEach((h, rank) => {
      const i = pos.get(`${h.docId}:${h.i}`);
      if (i !== undefined) add(i, rank);
    });
  }
  const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]);

  // Keep variety: at most 3 passages from any single work.
  const perDoc = new Map();
  const out = [];
  for (const [i, score] of ranked) {
    const chunk = library.chunks[i];
    const count = perDoc.get(chunk.docId) || 0;
    if (count >= 3) continue;
    perDoc.set(chunk.docId, count + 1);
    const doc = library.docs.find((d) => d.id === chunk.docId);
    out.push({ ...chunk, score, title: doc?.title, author: doc?.author });
    if (out.length >= k) break;
  }
  return out;
}

function chunkText(text) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const chunks = [];
  for (let start = 0; start < words.length; start += CHUNK_WORDS - CHUNK_OVERLAP) {
    const piece = words.slice(start, start + CHUNK_WORDS).join(' ');
    if (piece.split(' ').length > 25 || chunks.length === 0) chunks.push(piece);
    if (start + CHUNK_WORDS >= words.length) break;
  }
  return chunks;
}

/** A short spoken-friendly description of the library for the live voice agent. */
export { brief as studyBrief } from './study.js';

export function overview() {
  if (!library.docs.length) return 'Their library is still empty; draw on broadly known wisdom traditions and say so.';
  const studied = library.docs.filter((d) => d.study).slice(-20);
  const rest = library.docs.filter((d) => !d.study).slice(-40).map((d) => `${d.title}${d.author ? ` by ${d.author}` : ''}`);
  const lines = [`${library.docs.length} works. Use consult_library to read from them.`];
  if (studied.length) lines.push(`Works you have studied closely:\n${studied.map((d) => `- ${d.title}${d.author ? ` (${d.author})` : ''}: ${d.study.essence.slice(0, 220)}`).join('\n')}`);
  if (rest.length) lines.push(`Other works: ${rest.join('; ')}`);
  return lines.join('\n');
}

export function listDocs() {
  return library.docs;
}

export function stats() {
  return {
    works: library.docs.length,
    passages: library.chunks.length,
    semantic: { ...semantic.state, indexedWorks: library.docs.filter((d) => semantic.has(d.id)).length },
    studied: library.docs.filter((d) => d.studyStatus === 'done').length,
    studying: library.docs.filter((d) => d.studyStatus === 'queued' || d.studyStatus === 'studying').length,
  };
}

export async function addDocument({ title, author = '', source = '', type = 'text', text, cover = '' }) {
  const clean = (text || '').trim();
  if (clean.length < 40) throw new Error('Not enough readable text found in that source.');
  const id = crypto.randomUUID();
  const pieces = chunkText(clean);
  const doc = {
    id,
    title: title || 'Untitled',
    author,
    source,
    type,
    cover,
    words: clean.split(/\s+/).length,
    passages: pieces.length,
    addedAt: new Date().toISOString(),
  };
  const chunks = pieces.map((text, i) => ({ docId: id, i, text }));
  library.docs.push(doc);
  library.chunks.push(...chunks);
  try {
    await store.putDoc(doc, chunks);
  } catch (err) {
    library.docs = library.docs.filter((d) => d.id !== id);
    library.chunks = library.chunks.filter((c) => c.docId !== id);
    throw err;
  }
  index = buildIndex(library.chunks);
  semantic.enqueue(id, pieces);
  if (doc.words > 300) study.enqueue(id);
  return doc;
}

/** Everything needed to rebuild the library elsewhere (search vectors are recomputed). */
export function exportAll() {
  return { docs: library.docs, chunks: library.chunks };
}

/** Add works from a backup; works already present (same id) are skipped. */
export async function restore({ docs = [], chunks = [] }) {
  let added = 0;
  for (const doc of docs) {
    if (!doc?.id || getDoc(doc.id)) continue;
    const mine = chunks.filter((c) => c.docId === doc.id).map((c) => ({ docId: doc.id, i: c.i, text: String(c.text) }));
    if (!mine.length) continue;
    library.docs.push(doc);
    library.chunks.push(...mine);
    try {
      await store.putDoc(doc, mine);
    } catch (err) {
      library.docs = library.docs.filter((d) => d.id !== doc.id);
      library.chunks = library.chunks.filter((c) => c.docId !== doc.id);
      throw err;
    }
    semantic.enqueue(doc.id, mine.map((c) => c.text));
    if (!doc.study && doc.words > 300) study.enqueue(doc.id);
    added++;
  }
  if (added) index = buildIndex(library.chunks);
  return added;
}

export async function removeDocument(id) {
  semantic.remove(id);
  library.docs = library.docs.filter((d) => d.id !== id);
  library.chunks = library.chunks.filter((c) => c.docId !== id);
  await store.deleteDoc(id);
  index = buildIndex(library.chunks);
}

// ---------- Extraction ----------

export function stripHtml(html) {
  return html
    .replace(/<(script|style|nav|footer|header|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|h\d|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

function epubText(buffer) {
  const zip = new AdmZip(buffer);
  const read = (p) => zip.getEntry(p)?.getData().toString('utf8');
  const container = read('META-INF/container.xml') || '';
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  const opf = opfPath ? read(opfPath) : null;
  let files = [];
  let title;
  let author;
  if (opf) {
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const manifest = new Map();
    for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
      const id = m[0].match(/\bid="([^"]+)"/)?.[1];
      const href = m[0].match(/\bhref="([^"]+)"/)?.[1];
      if (id && href) manifest.set(id, base + decodeURIComponent(href));
    }
    files = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => manifest.get(m[1])).filter(Boolean);
    title = opf.match(/<dc:title[^>]*>([^<]+)</)?.[1];
    author = opf.match(/<dc:creator[^>]*>([^<]+)</)?.[1];
  }
  if (!files.length) {
    files = zip.getEntries().map((e) => e.entryName).filter((n) => /\.x?html?$/i.test(n)).sort();
  }
  const text = files.map((f) => stripHtml(read(f) || '')).join('\n\n');
  return { text, title, author };
}

export async function extractFromFile(file) {
  const name = file.originalname || 'upload';
  const ext = name.split('.').pop().toLowerCase();
  const baseTitle = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  if (ext === 'pdf') {
    const data = await pdfParse(file.buffer);
    return { text: data.text, title: data.info?.Title || baseTitle, author: data.info?.Author || '', type: 'book' };
  }
  if (ext === 'epub') {
    const r = epubText(file.buffer);
    return { text: r.text, title: r.title || baseTitle, author: r.author || '', type: 'book' };
  }
  const raw = file.buffer.toString('utf8');
  if (ext === 'html' || ext === 'htm') return { text: stripHtml(raw), title: baseTitle, type: 'article' };
  return { text: raw, title: baseTitle, type: 'text' };
}

async function fetchText(url, accept = 'text/html') {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'OracleOfTheThirdEye/1.0 (personal knowledge library)', Accept: accept },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return res.text();
}

// Blogs, Reddit threads, GitHub repos, raw text — anything with words in it.
export async function extractFromUrl(url) {
  const u = new URL(url);

  if (/(^|\.)reddit\.com$/.test(u.hostname)) {
    const jsonUrl = `https://www.reddit.com${u.pathname.replace(/\/$/, '')}.json?limit=100`;
    const data = JSON.parse(await fetchText(jsonUrl, 'application/json'));
    const post = data?.[0]?.data?.children?.[0]?.data;
    const comments = [];
    const walk = (children = []) => {
      for (const c of children) {
        if (c.kind !== 't1') continue;
        if (c.data.score > 2 && c.data.body) comments.push(`${c.data.author} (${c.data.score}): ${c.data.body}`);
        if (c.data.replies?.data?.children) walk(c.data.replies.data.children);
      }
    };
    walk(data?.[1]?.data?.children);
    return {
      title: post?.title || 'Reddit thread',
      author: post ? `u/${post.author} in r/${post.subreddit}` : '',
      text: [post?.title, post?.selftext, ...comments].filter(Boolean).join('\n\n'),
      type: 'reddit',
    };
  }

  if (u.hostname === 'github.com') {
    const [owner, repo] = u.pathname.split('/').filter(Boolean);
    if (owner && repo) {
      for (const branch of ['HEAD', 'main', 'master']) {
        try {
          const text = await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`, 'text/plain');
          return { title: `${owner}/${repo}`, author: owner, text, type: 'github' };
        } catch {
          /* try next branch */
        }
      }
    }
  }

  const raw = await fetchText(url);
  const looksHtml = /<html|<body|<p[\s>]/i.test(raw);
  const title = raw.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const author = raw.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)/i)?.[1];
  const article = raw.match(/<article[\s\S]*?<\/article>/i)?.[0];
  return {
    title: title || u.hostname + u.pathname,
    author: author || u.hostname,
    text: looksHtml ? stripHtml(article || raw) : raw,
    type: 'article',
  };
}

// ---------- Project Gutenberg (70,000+ free public-domain books) ----------

const GUTENBERG = 'https://www.gutenberg.org';

// Hand-checked IDs of classics of wisdom literature.
export const CLASSICS = [
  [2680, 'Meditations', 'Marcus Aurelius', 'Stoic'],
  [45109, 'The Enchiridion', 'Epictetus', 'Stoic'],
  [10661, 'Discourses (selection)', 'Epictetus', 'Stoic'],
  [56075, "Seneca's Morals of a Happy Life", 'Seneca', 'Stoic'],
  [216, 'Tao Te Ching', 'Laozi', 'Taoist'],
  [2017, 'Dhammapada', 'The Buddha (attrib.)', 'Buddhist'],
  [2388, 'Bhagavad Gita', 'trans. Edwin Arnold', 'Vedic'],
  [3330, 'The Analects', 'Confucius', 'Confucian'],
  [58585, 'The Prophet', 'Kahlil Gibran', 'Mystic'],
  [1656, 'Apology', 'Plato', 'Philosophy'],
  [1497, 'The Republic', 'Plato', 'Philosophy'],
  [1998, 'Thus Spake Zarathustra', 'Friedrich Nietzsche', 'Philosophy'],
  [2944, 'Essays — First Series', 'Ralph Waldo Emerson', 'Transcendental'],
  [205, 'Walden', 'Henry David Thoreau', 'Transcendental'],
  [4507, 'As a Man Thinketh', 'James Allen', 'Mindset'],
  [132, 'The Art of War', 'Sun Tzu', 'Strategy'],
].map(([id, title, author, tradition]) => ({ id, title, author, tradition, cover: gutenbergCover(id) }));

export function gutenbergCover(id) {
  return `${GUTENBERG}/cache/epub/${id}/pg${id}.cover.medium.jpg`;
}

export async function searchGutenberg(query) {
  const html = await fetchText(`${GUTENBERG}/ebooks/search/?query=${encodeURIComponent(query)}`);
  const out = [];
  for (const m of html.matchAll(/<li class="booklink">([\s\S]*?)<\/li>/g)) {
    const id = Number(m[1].match(/href="\/ebooks\/(\d+)"/)?.[1]);
    const title = m[1].match(/<span class="title">([^<]+)/)?.[1];
    const author = m[1].match(/<span class="subtitle">([^<]+)/)?.[1] || '';
    if (id && title) out.push({ id, title: decodeEntities(title), author: decodeEntities(author), cover: gutenbergCover(id) });
  }
  return out.slice(0, 24);
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

export async function importGutenberg(id, meta = {}) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid Gutenberg book id.');
  if (library.docs.some((d) => d.source === `gutenberg:${n}`)) throw new Error('That book is already in your library.');
  const raw = await fetchText(`${GUTENBERG}/cache/epub/${n}/pg${n}.txt`, 'text/plain');
  const title = meta.title || raw.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || `Gutenberg #${n}`;
  const author = meta.author || raw.match(/^Author:\s*(.+)$/m)?.[1]?.trim() || '';
  const start = raw.search(/\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG/i);
  const end = raw.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/i);
  let body = raw.slice(start >= 0 ? raw.indexOf('\n', start) : 0, end > 0 ? end : undefined);
  body = body.replace(/\r/g, '');
  return addDocument({ title, author, text: body, type: 'book', source: `gutenberg:${n}`, cover: gutenbergCover(n) });
}
