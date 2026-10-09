// The Library: ingests books, blogs, Reddit threads and GitHub READMEs,
// splits them into passages, and retrieves the most relevant ones with BM25.
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { load, save } from './store.js';

const CHUNK_WORDS = 220;
const CHUNK_OVERLAP = 40;

const STOPWORDS = new Set(
  `a an and are as at be but by for from has have he her his i if in into is it its
  me my of on or our she so that the their them then there these they this to was we
  were what when where which who will with you your not no do does did can could would
  should about than too very just also been being am all any some more most such only`.split(/\s+/),
);

let library = load('library', { docs: [], chunks: [] });
let index = buildIndex(library.chunks);

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

export function search(query, k = 8) {
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
  scored.sort((a, b2) => b2.score - a.score);

  // Keep variety: at most 3 passages from any single work.
  const perDoc = new Map();
  const out = [];
  for (const { i, score } of scored) {
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

export function listDocs() {
  return library.docs;
}

export function stats() {
  return { works: library.docs.length, passages: library.chunks.length };
}

export function addDocument({ title, author = '', source = '', type = 'text', text }) {
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
    words: clean.split(/\s+/).length,
    passages: pieces.length,
    addedAt: new Date().toISOString(),
  };
  library.docs.push(doc);
  pieces.forEach((p, i) => library.chunks.push({ docId: id, i, text: p }));
  save('library', library);
  index = buildIndex(library.chunks);
  return doc;
}

export function removeDocument(id) {
  library.docs = library.docs.filter((d) => d.id !== id);
  library.chunks = library.chunks.filter((c) => c.docId !== id);
  save('library', library);
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
