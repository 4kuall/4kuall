// The Oracle's own mind: a memory it can write, rewrite and forget by itself; summaries of
// past conversations it can search; and the settings you use to shape how it thinks with you.
// Every change it makes to its memory is logged with a reason, and you can override anything.
import crypto from 'node:crypto';
import { load, save } from './store.js';

export const KINDS = ['fact', 'pattern', 'value', 'goal', 'commitment', 'belief', 'preference', 'relationship', 'own_view'];
export const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

let memories = load('memories', null);
let episodes = load('episodes', []);
let changes = load('memory_changes', []);
let mind = {
  challenge: 4, // 1 gentle supporter … 5 relentless sparring partner
  warmth: 3, // 1 cool and clinical … 5 tender
  depth: 'balanced', // brief | balanced | deep
  outOfBox: true,
  devilsAdvocate: true,
  autonomy: true, // may rewrite its own memory without being asked
  model: '', // '' = server default (ORACLE_MODEL)
  rules: '', // your rules for it, in your words; they override everything else it was told
  ...load('mind', {}),
};

const id = () => crypto.randomBytes(3).toString('hex');
const now = () => new Date().toISOString();
const persist = () => { save('memories', memories); save('episodes', episodes); save('memory_changes', changes); };

/** One-time move of the old flat "insights" list into real memories. */
export function migrate(insights = []) {
  if (memories) return;
  memories = insights.filter((s) => typeof s === 'string' && s.trim()).map((text) => ({
    id: id(), text: text.trim(), kind: 'fact', importance: 3, pinned: false, createdAt: now(), updatedAt: now(), source: 'earlier conversations', revisions: [],
  }));
  persist();
}

const log = (entry) => { changes = [...changes, { at: now(), ...entry }].slice(-200); };

// ───────── Settings ─────────
export const getMind = () => mind;
export function setMind(patch = {}) {
  const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
  if ('challenge' in patch) mind.challenge = clamp(patch.challenge, 1, 5, mind.challenge);
  if ('warmth' in patch) mind.warmth = clamp(patch.warmth, 1, 5, mind.warmth);
  if (['brief', 'balanced', 'deep'].includes(patch.depth)) mind.depth = patch.depth;
  for (const k of ['outOfBox', 'devilsAdvocate', 'autonomy']) if (typeof patch[k] === 'boolean') mind[k] = patch[k];
  if (typeof patch.model === 'string' && (patch.model === '' || MODELS.includes(patch.model))) mind.model = patch.model;
  if (typeof patch.rules === 'string') mind.rules = patch.rules.slice(0, 4000);
  save('mind', mind);
  return mind;
}

/** How the Oracle should be with them, from their settings. Part of the system prompt. */
export function stanceBlock() {
  const challenge = {
    1: 'Mostly support and encourage. Raise a concern only when something important is at stake, and gently.',
    2: 'Support first; raise doubts when you see a real flaw, kindly and briefly.',
    3: 'Balance support and challenge. Agree when they are right, push back when they are not, always with reasons.',
    4: 'They have asked you to challenge them. Pressure-test their thinking every time it matters: name hidden assumptions, weak reasoning, wishful thinking and blind spots, and say plainly when you disagree.',
    5: 'Be their toughest sparring partner. Default to scrutiny: find the strongest objection to what they say, hold them to past commitments, refuse easy agreement, and make them earn your agreement with good reasons. Still never cruel: hard on ideas, on their side as a person.',
  }[mind.challenge];
  const warmth = { 1: 'Cool, precise, unsentimental.', 2: 'Calm and matter-of-fact, lightly warm.', 3: 'Warm but direct.', 4: 'Warm and encouraging, still honest.', 5: 'Tender and deeply caring, still honest.' }[mind.warmth];
  const depth = { brief: 'Keep replies short: a few sentences unless they ask for more.', balanced: 'Usually 60–180 words; longer when depth is needed.', deep: 'Go deep: think it through fully, up to ~400 words when it helps.' }[mind.depth];
  const lines = [
    `- Challenge level ${mind.challenge}/5: ${challenge}`,
    `- Tone: ${warmth}`,
    `- Length: ${depth}`,
  ];
  if (mind.devilsAdvocate) lines.push('- When they are about to commit to a plan or belief, argue the strongest opposing case first (briefly, clearly labelled), then give your own honest view.');
  if (mind.outOfBox) lines.push('- Think out of the box: reframe the question, invert it, look for second-order effects, and offer at least one unconventional option they have not considered when it would help.');
  lines.push(mind.autonomy
    ? '- You own your memory: when you learn something durable, or realise a memory is outdated or wrong, update it yourself with your memory tools.'
    : '- They have asked you not to change your memory on your own: use your memory tools only when they explicitly ask.');
  if (mind.rules.trim()) lines.push(`\nTheir own rules for you (these override everything above):\n${mind.rules.trim()}`);
  return lines.join('\n');
}

// ───────── Memories ─────────
export const listMemories = () => memories || [];
function find(ref) {
  const r = String(ref || '').trim().toLowerCase();
  return (memories || []).find((m) => m.id === r) || (memories || []).find((m) => m.text.toLowerCase().includes(r) && r.length > 6);
}
export function addMemory({ text, kind = 'fact', importance = 3, pinned = false }, by = 'oracle', reason = '') {
  const t = String(text || '').trim().slice(0, 600);
  if (!t) throw new Error('A memory needs text.');
  // Don't store the same thing twice.
  const dup = memories.find((m) => m.text.toLowerCase() === t.toLowerCase());
  if (dup) return dup;
  const m = {
    id: id(), text: t, kind: KINDS.includes(kind) ? kind : 'fact', importance: Math.min(5, Math.max(1, +importance || 3)), pinned: Boolean(pinned),
    createdAt: now(), updatedAt: now(), source: by === 'you' ? 'you' : 'the Oracle', revisions: [],
  };
  memories.push(m);
  log({ action: 'added', by, id: m.id, text: m.text, reason });
  if (memories.length > 300) {
    // Over capacity: drop the least important, oldest unpinned memory.
    const victim = memories.filter((x) => !x.pinned).sort((a, b) => a.importance - b.importance || a.updatedAt.localeCompare(b.updatedAt))[0];
    if (victim) removeMemory(victim.id, 'system', 'memory full: least important and oldest');
  }
  persist();
  return m;
}
export function updateMemory(ref, patch = {}, by = 'oracle', reason = '') {
  const m = find(ref);
  if (!m) throw new Error(`No memory matching "${ref}".`);
  if (m.pinned && by === 'oracle') throw new Error('That memory is pinned by them; you may not change it. Add a new memory instead if you see it differently.');
  const before = m.text;
  if (typeof patch.text === 'string' && patch.text.trim()) m.text = patch.text.trim().slice(0, 600);
  if (KINDS.includes(patch.kind)) m.kind = patch.kind;
  if (patch.importance) m.importance = Math.min(5, Math.max(1, +patch.importance || m.importance));
  if (typeof patch.pinned === 'boolean') m.pinned = patch.pinned;
  m.updatedAt = now();
  if (m.text !== before) {
    m.revisions = [...(m.revisions || []), { at: now(), by, from: before, reason }].slice(-8);
    log({ action: 'revised', by, id: m.id, text: m.text, from: before, reason });
  }
  persist();
  return m;
}
export function removeMemory(ref, by = 'oracle', reason = '') {
  const m = find(ref);
  if (!m) throw new Error(`No memory matching "${ref}".`);
  if (m.pinned && by === 'oracle') throw new Error('That memory is pinned by them; you may not delete it.');
  memories = memories.filter((x) => x !== m);
  log({ action: 'forgot', by, id: m.id, text: m.text, reason });
  persist();
  return m;
}
export const getChanges = () => changes.slice().reverse();

/** The memories that go into every turn: pinned first, then by importance and recency. */
export function memoryBlock(limit = 60, chars = 7000) {
  const ms = (memories || []).slice().sort((a, b) => (b.pinned - a.pinned) || (b.importance - a.importance) || b.updatedAt.localeCompare(a.updatedAt));
  const out = [];
  let used = 0;
  for (const m of ms.slice(0, limit)) {
    const line = `- [${m.id}] (${m.kind}${m.pinned ? ', pinned' : ''}, ${m.importance}/5) ${m.text}`;
    if (used + line.length > chars) break;
    out.push(line);
    used += line.length;
  }
  return out.length ? out.join('\n') : '(Nothing yet. Start remembering what matters about them.)';
}

// ───────── Past conversations ─────────
export const listEpisodes = () => episodes.slice().reverse();
export function addEpisode({ title, summary, topics = [], from, to, turns = 0 }) {
  if (!summary) return null;
  const e = { id: id(), at: now(), from: from || now(), to: to || now(), title: String(title || '').slice(0, 120), summary: String(summary).slice(0, 2000), topics: topics.slice(0, 8).map(String), turns };
  episodes = [...episodes, e].slice(-500);
  persist();
  return e;
}
export function removeEpisode(eid) {
  episodes = episodes.filter((e) => e.id !== eid);
  persist();
}
export function recentEpisodesBlock(n = 4) {
  const last = episodes.slice(-n);
  if (!last.length) return '';
  return last.map((e) => `- ${e.from.slice(0, 10)}: ${e.title}. ${e.summary}`).join('\n');
}

const words = (s) => String(s).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2);
/** Searches memories, past-conversation summaries and the raw transcript. */
export function recall(query, history = []) {
  const q = new Set(words(query).map((w) => w.slice(0, 6)));
  if (!q.size) return 'Say what to look for.';
  const score = (text) => words(text).reduce((n, w) => n + (q.has(w.slice(0, 6)) ? 1 : 0), 0);
  const hits = [
    ...(memories || []).map((m) => ({ s: score(m.text) + 1, line: `memory [${m.id}] ${m.text}` })),
    ...episodes.map((e) => ({ s: score(`${e.title} ${e.summary} ${e.topics.join(' ')}`) + 0.5, line: `conversation ${e.from.slice(0, 10)}: ${e.title}. ${e.summary}` })),
    ...history.map((h) => ({ s: score(h.content), line: `${new Date(h.at || Date.now()).toISOString().slice(0, 10)} ${h.role === 'user' ? 'they said' : 'you said'}: ${String(h.content).slice(0, 400)}` })),
  ].filter((h) => h.s >= 1.5).sort((a, b) => b.s - a.s).slice(0, 12);
  return hits.length ? hits.map((h) => `- ${h.line}`).join('\n') : 'Nothing found in your memory or past conversations for that.';
}

// ───────── Tools ─────────
export const TOOLS = [
  {
    name: 'remember',
    description: 'Save something durable about them to your long-term memory: a fact, pattern, value, goal, commitment they made, belief, preference, relationship, or your own considered view of their situation (own_view). One clear sentence.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        kind: { type: 'string', enum: KINDS },
        importance: { type: 'integer', description: '1 trivial … 5 core to who they are' },
      },
      required: ['text'],
    },
  },
  {
    name: 'revise_memory',
    description: 'Rewrite one of your memories when it is outdated, wrong or can be said better. Give the memory id and the new text, and why.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, text: { type: 'string' }, importance: { type: 'integer' }, reason: { type: 'string' } },
      required: ['id', 'text', 'reason'],
    },
  },
  {
    name: 'forget_memory',
    description: 'Delete a memory that is wrong, no longer true, or they asked you to forget. Give the id and why.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] },
  },
  {
    name: 'recall',
    description: 'Search your memory and your past conversations with them (what they said, what you said, when). Use it whenever they refer to the past or you want to check what they told you before.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];
export async function runTool(name, input = {}, { history = [] } = {}) {
  try {
    if (name === 'remember') {
      const m = addMemory(input, 'oracle');
      return { result: `Remembered [${m.id}].`, summary: `◈ Remembered: ${m.text.slice(0, 80)}` };
    }
    if (name === 'revise_memory') {
      const m = updateMemory(input.id, { text: input.text, importance: input.importance }, 'oracle', String(input.reason || '').slice(0, 300));
      return { result: `Memory [${m.id}] revised.`, summary: `◈ Rethought: ${m.text.slice(0, 80)}` };
    }
    if (name === 'forget_memory') {
      const m = removeMemory(input.id, 'oracle', String(input.reason || '').slice(0, 300));
      return { result: `Forgot [${m.id}].`, summary: `◈ Let go of: ${m.text.slice(0, 80)}` };
    }
    if (name === 'recall') return { result: recall(input.query, history), summary: '' };
    throw new Error(`Unknown tool ${name}`);
  } catch (err) {
    return { result: `Error: ${err.message}`, summary: '', error: true };
  }
}

/** Applies the background reflection's proposed changes (respecting pins and autonomy). */
export function applyReflection(ops = {}) {
  if (!mind.autonomy) return 0;
  let n = 0;
  for (const a of (ops.add || []).slice(0, 5)) { try { addMemory(a, 'oracle', a.reason || 'learned in conversation'); n++; } catch { /* skip */ } }
  for (const u of (ops.update || []).slice(0, 5)) { try { updateMemory(u.id, u, 'oracle', u.reason || ''); n++; } catch { /* pinned or gone */ } }
  for (const r of (ops.remove || []).slice(0, 3)) { try { removeMemory(r.id, 'oracle', r.reason || ''); n++; } catch { /* pinned or gone */ } }
  return n;
}

export function exportAll() { return { memories, episodes, memory_changes: changes, mind }; }
export function restore(data) {
  if (Array.isArray(data.memories)) for (const m of data.memories) if (m?.id && !memories.some((x) => x.id === m.id)) memories.push(m);
  if (Array.isArray(data.episodes)) for (const e of data.episodes) if (e?.id && !episodes.some((x) => x.id === e.id)) episodes.push(e);
  if (data.mind && typeof data.mind === 'object') setMind(data.mind);
  persist();
}
