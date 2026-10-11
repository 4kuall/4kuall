// Semantic memory: Hugging Face sentence embeddings (all-MiniLM-L6-v2) run locally
// through transformers.js. The model (~23 MB) downloads from the Hugging Face Hub
// once, then everything stays on this machine. Vectors are stored per work
// (locally or in Supabase) so retrieval can find passages by meaning, not just words.
import fs from 'node:fs';
import os from 'node:os';
import * as store from './store.js';

const DIM = 384;
const BATCH = 4; // passages embedded at once; small batches keep memory flat
const MODEL = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
const vectors = store.loadVectors(); // docId -> Float32Array (passages × DIM)
const queue = [];
let extractor;
let loading;
let working = false;
// The embedding runtime needs ~300-450 MB while it works. On small servers (Render's free plan
// has 512 MB) that crashes the whole app, so it stays off there unless SEMANTIC_SEARCH=on;
// keyword search plus each book's study notes still find the right passages.
function memoryLimitMB() {
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const v = Number(fs.readFileSync(f, 'utf8').trim());
      if (v > 0 && v < 2 ** 50) return Math.round(v / 1048576);
    } catch { /* not a container, or cgroup v1/v2 mismatch */ }
  }
  // No container limit visible. On Render that would mean the host's memory, not ours: assume small.
  return process.env.RENDER ? 512 : Math.round(os.totalmem() / 1048576);
}
const MIN_MB = 900;
const setting = process.env.SEMANTIC_SEARCH;
export const state = {
  enabled: setting === 'on' || (setting !== 'off' && memoryLimitMB() >= MIN_MB),
  ready: false,
  pending: 0,
  error: '',
};
if (!state.enabled && setting !== 'off') {
  state.error = `Off on this server (${memoryLimitMB()} MB memory; needs ~${MIN_MB} MB). Keyword search and study notes are used instead.`;
  console.log(`[semantic] ${state.error}`);
}

async function model() {
  if (extractor) return extractor;
  loading ??= import('@huggingface/transformers')
    .then(({ pipeline }) => pipeline('feature-extraction', MODEL, {
      dtype: 'q8',
      // Small cloud servers have ~512 MB: one thread and no pre-allocated memory pool
      // keep the model's footprint low (it's a little slower, and it runs in the background).
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false },
    }))
    .then((p) => {
      extractor = p;
      state.ready = true;
      return p;
    })
    .catch((err) => {
      state.enabled = false;
      state.error = err.message;
      console.warn('[semantic] disabled:', err.message);
      throw err;
    });
  return loading;
}

async function embed(texts) {
  const ex = await model();
  const out = await ex(texts, { pooling: 'mean', normalize: true });
  // Copy the vectors out, then free the tensor's native memory (otherwise it leaks per batch).
  const data = Float32Array.from(out.data); // texts.length × DIM
  out.dispose?.();
  return data;
}

export function has(docId) {
  return vectors.has(docId);
}

/** Queue a work for embedding in the background. */
export function enqueue(docId, passages) {
  if (!state.enabled || vectors.has(docId)) return;
  queue.push({ docId, passages });
  state.pending += passages.length;
  if (!working) drain();
}

async function drain() {
  working = true;
  while (queue.length && state.enabled) {
    const { docId, passages } = queue.shift();
    try {
      const all = new Float32Array(passages.length * DIM);
      for (let i = 0; i < passages.length; i += BATCH) {
        const batch = passages.slice(i, i + BATCH);
        all.set(await embed(batch), i * DIM);
        state.pending -= batch.length;
      }
      if (!removed.has(docId)) await store.putVectors(docId, all);
    } catch (err) {
      console.warn('[semantic] embedding failed:', err.message);
      state.pending = 0;
    }
  }
  working = false;
}

const removed = new Set();
export function remove(docId) {
  removed.add(docId);
  vectors.delete(docId);
}

/** Returns [{docId, i, score}] ranked by cosine similarity. */
export async function search(query, k = 30) {
  if (!state.enabled || !vectors.size) return [];
  let q;
  try {
    q = await embed([query]);
  } catch {
    return [];
  }
  const hits = [];
  for (const [docId, mat] of vectors) {
    const n = mat.length / DIM;
    for (let i = 0; i < n; i++) {
      let s = 0;
      const o = i * DIM;
      for (let d = 0; d < DIM; d++) s += mat[o + d] * q[d];
      hits.push({ docId, i, score: s });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}
