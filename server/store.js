// Persistence. Two backends behind one interface:
//  - local:    JSON files + vector blobs in ./data (laptop use)
//  - supabase: any Postgres via DATABASE_URL — made for Supabase, so the Oracle
//              runs in the cloud and your phone and laptop share one mind.
// Everything is held in memory while running; writes go through to the backend.
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';
export let mode = DB_URL ? 'supabase' : 'local';
/** Plain-English reason Supabase couldn't be used (shown in the app), or ''. */
export let storageError = '';

function explainDbError(err) {
  const m = String(err?.message || err);
  if (/\[YOUR-PASSWORD\]|\[|\]/.test(DB_URL)) return 'DATABASE_URL still contains [YOUR-PASSWORD] or brackets — replace it with your real Supabase database password (no brackets).';
  if (/db\.[a-z0-9]+\.supabase\.co/.test(DB_URL)) return 'DATABASE_URL is the "Direct connection" string. In Supabase click Connect and copy the "Session pooler" string instead.';
  if (/password authentication failed/i.test(m)) return 'Supabase rejected the password in DATABASE_URL. Reset it in Supabase → Project Settings → Database, then update DATABASE_URL.';
  if (/Invalid URL|invalid connection/i.test(m) || !/^postgres(ql)?:\/\//.test(DB_URL)) return 'DATABASE_URL is not a valid connection string — it should start with postgresql:// (Supabase → Connect → Session pooler).';
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return 'The database address in DATABASE_URL could not be found — copy the Session pooler string from Supabase again.';
  if (/timeout|timed out/i.test(m)) return 'Timed out reaching Supabase. Check the project is running (not paused) and you used the Session pooler string.';
  return `Could not connect to Supabase: ${m}`;
}

export const DEFAULT_PROFILE = {
  name: '',
  about: '',
  values: '',
  goals: '',
  struggles: '',
  // Learned by the Oracle over time from conversations.
  insights: [],
  traits: {},
  lastSummary: '',
  // The Oracle's own continuity: private notes, what it's wondering, how it will greet you.
  journal: [],
  nextThought: '',
  opening: '',
};

let pool;
const kv = new Map(); // profile, history
let library = { docs: [], chunks: [] };
const vectors = new Map(); // docId -> Float32Array
const pendingKv = new Map();
let flushTimer;

const SCHEMA = `
create table if not exists oracle_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists oracle_docs (
  id uuid primary key,
  meta jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists oracle_chunks (
  doc_id uuid not null references oracle_docs(id) on delete cascade,
  i int not null,
  text text not null,
  primary key (doc_id, i)
);
create table if not exists oracle_vectors (
  doc_id uuid primary key references oracle_docs(id) on delete cascade,
  data bytea not null
);
-- Lock the tables away from Supabase's public API: only this server (via the
-- database connection) can read them. No policies = no anon/auth access.
alter table oracle_kv enable row level security;
alter table oracle_docs enable row level security;
alter table oracle_chunks enable row level security;
alter table oracle_vectors enable row level security;
`;

export async function init() {
  if (mode === 'local') {
    fs.mkdirSync(path.join(DATA_DIR, 'vectors'), { recursive: true });
    for (const name of ['profile', 'history']) {
      try { kv.set(name, JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), 'utf8'))); } catch { /* fresh */ }
    }
    try { library = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'library.json'), 'utf8')); } catch { /* fresh */ }
    for (const d of library.docs) {
      const file = path.join(DATA_DIR, 'vectors', `${d.id}.f32`);
      if (fs.existsSync(file)) vectors.set(d.id, toF32(fs.readFileSync(file)));
    }
    console.log(`  ▸ storage: local files in ${DATA_DIR}`);
    return;
  }

  try {
    await initDatabase();
  } catch (err) {
    // Never crash on a bad database setting: run on temporary local storage and say why.
    storageError = explainDbError(err);
    console.error(`  ! Supabase unavailable — using temporary local storage.\n    ${storageError}`);
    await pool?.end().catch(() => {});
    pool = null;
    mode = 'local';
    return init();
  }
}

async function initDatabase() {
  const { default: pg } = await import('pg');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL);
  pool = new pg.Pool({
    connectionString: DB_URL,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 4,
    connectionTimeoutMillis: 15000,
  });
  pool.on('error', (err) => console.error('[store] database connection error:', err.message));
  await pool.query(SCHEMA);
  for (const row of (await pool.query('select key, value from oracle_kv')).rows) kv.set(row.key, row.value);
  const docs = (await pool.query('select meta from oracle_docs order by created_at')).rows.map((r) => r.meta);
  const chunks = (await pool.query('select doc_id, i, text from oracle_chunks order by doc_id, i')).rows;
  const order = new Map(docs.map((d, n) => [d.id, n]));
  chunks.sort((a, b) => order.get(a.doc_id) - order.get(b.doc_id) || a.i - b.i);
  library = { docs, chunks: chunks.map((c) => ({ docId: c.doc_id, i: c.i, text: c.text })) };
  for (const row of (await pool.query('select doc_id, data from oracle_vectors')).rows) vectors.set(row.doc_id, toF32(row.data));
  console.log(`  ▸ storage: Supabase/Postgres — ${docs.length} works, ${chunks.length} passages, ${vectors.size} vector sets`);
}

function toF32(buf) {
  // Copy so the Float32Array is 4-byte aligned regardless of the source buffer.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

// ---------- key/value (profile, history) ----------

export function load(name, fallback) {
  return kv.has(name) ? structuredClone(kv.get(name)) : structuredClone(fallback);
}

export function save(name, value) {
  kv.set(name, value);
  if (mode === 'local') {
    const file = path.join(DATA_DIR, `${name}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
    fs.renameSync(`${file}.tmp`, file);
    return;
  }
  pendingKv.set(name, value);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushKv, 300);
}

async function flushKv() {
  const entries = [...pendingKv.entries()];
  pendingKv.clear();
  for (const [key, value] of entries) {
    try {
      await pool.query(
        'insert into oracle_kv (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()',
        [key, JSON.stringify(value)],
      );
    } catch (err) {
      console.error(`[store] saving ${key} failed:`, err.message);
    }
  }
}

// ---------- library ----------

/** The live library object. library.js mutates it, then calls putDoc/deleteDoc. */
export function loadLibrary() {
  return library;
}

function writeLocalLibrary() {
  const file = path.join(DATA_DIR, 'library.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(library));
  fs.renameSync(`${file}.tmp`, file);
}

export async function putDoc(doc, chunks) {
  if (mode === 'local') return writeLocalLibrary();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('insert into oracle_docs (id, meta) values ($1, $2) on conflict (id) do update set meta = excluded.meta', [doc.id, JSON.stringify(doc)]);
    for (let n = 0; n < chunks.length; n += 500) {
      const batch = chunks.slice(n, n + 500);
      await client.query(
        'insert into oracle_chunks (doc_id, i, text) select $1, * from unnest($2::int[], $3::text[]) on conflict do nothing',
        [doc.id, batch.map((c) => c.i), batch.map((c) => c.text)],
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Update a work's metadata (e.g. its study notes) without touching its passages. */
export async function updateDoc(doc) {
  if (mode === 'local') return writeLocalLibrary();
  await pool.query('update oracle_docs set meta = $2 where id = $1', [doc.id, JSON.stringify(doc)]);
}

export async function deleteDoc(id) {
  vectors.delete(id);
  if (mode === 'local') {
    writeLocalLibrary();
    fs.rmSync(path.join(DATA_DIR, 'vectors', `${id}.f32`), { force: true });
    return;
  }
  await pool.query('delete from oracle_docs where id = $1', [id]); // cascades to chunks & vectors
}

// ---------- semantic vectors ----------

export function loadVectors() {
  return vectors;
}

export async function putVectors(docId, f32) {
  vectors.set(docId, f32);
  const buf = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
  if (mode === 'local') return fs.writeFileSync(path.join(DATA_DIR, 'vectors', `${docId}.f32`), buf);
  await pool.query('insert into oracle_vectors (doc_id, data) values ($1, $2) on conflict (doc_id) do update set data = excluded.data', [docId, buf]);
}
