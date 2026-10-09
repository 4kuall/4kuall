// Semantic memory: Hugging Face sentence embeddings (all-MiniLM-L6-v2) run locally
// through transformers.js. The model (~23 MB) downloads from the Hugging Face Hub
// once, then everything stays on this machine. Vectors are stored per work
// (locally or in Supabase) so retrieval can find passages by meaning, not just words.
import * as store from './store.js';

const DIM = 384;
const MODEL = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
const vectors = store.loadVectors(); // docId -> Float32Array (passages × DIM)
const queue = [];
let extractor;
let loading;
let working = false;
export const state = { enabled: process.env.SEMANTIC_SEARCH !== 'off', ready: false, pending: 0, error: '' };

async function model() {
  if (extractor) return extractor;
  loading ??= import('@huggingface/transformers')
    .then(({ pipeline }) => pipeline('feature-extraction', MODEL, { dtype: 'q8' }))
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
  return out.data; // Float32Array, texts.length × DIM
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
      for (let i = 0; i < passages.length; i += 16) {
        const batch = passages.slice(i, i + 16);
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
