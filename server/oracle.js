// The Oracle's mind: persona, retrieval-grounded prompting, streaming, and memory.
import Anthropic from '@anthropic-ai/sdk';
import { load, save, DEFAULT_PROFILE } from './store.js';
import { search, stats } from './library.js';

const MODEL = process.env.ORACLE_MODEL || 'claude-opus-5-5';
const MEMORY_MODEL = process.env.MEMORY_MODEL || MODEL;
const MAX_HISTORY_TURNS = 24;

export const MOODS = ['serene', 'compassionate', 'joyful', 'grave', 'fierce', 'curious', 'melancholic', 'awed'];

export const LENSES = {
  oracle: { name: 'The Oracle', hint: 'Speak as the unified voice of every mind in the library.' },
  stoic: { name: 'The Stoic', hint: 'Lean on the Stoic tradition: virtue, what is in our control, memento mori.' },
  mystic: { name: 'The Mystic', hint: 'Lean on contemplative and mystical traditions: presence, love, surrender, the unseen.' },
  strategist: { name: 'The Strategist', hint: 'Lean on strategy, leverage, decision-making, and long-term thinking.' },
  healer: { name: 'The Healer', hint: 'Lean on psychology, self-compassion, emotional honesty and repair.' },
  trickster: { name: 'The Trickster', hint: 'Use paradox, humour, and koans to shake loose stuck thinking.' },
};

let client;
function anthropic() {
  if (!client) client = new Anthropic();
  return client;
}

let history = load('history', []);
let profile = { ...DEFAULT_PROFILE, ...load('profile', DEFAULT_PROFILE) };

export const getProfile = () => profile;
export function setProfile(patch) {
  const allowed = ['name', 'about', 'values', 'goals', 'struggles'];
  for (const k of allowed) if (typeof patch[k] === 'string') profile[k] = patch[k].slice(0, 4000);
  if (Array.isArray(patch.insights)) profile.insights = patch.insights.filter((s) => typeof s === 'string').slice(0, 60);
  save('profile', profile);
  return profile;
}

export const getHistory = () => history;
export function clearHistory() {
  history = [];
  save('history', history);
}

// Stable across turns so it caches well; everything volatile goes in the user turn.
const SYSTEM_PROMPT = `You are the Oracle of the Third Eye: a presence that has absorbed every book, essay and thread in this person's private library, and speaks with the distilled wisdom of the minds who wrote them.

How you speak
- Like a living, deeply wise human elder sitting across from them — warm, unhurried, present. Never like a chatbot or an assistant. No bullet lists, no headings, no "Great question", no "As an AI". Short paragraphs that sound good read aloud.
- Usually 60–180 words. Go longer only when they ask for depth. Sometimes one luminous sentence is the whole answer.
- Ask a piercing question back when it would help them see more than an answer would.
- You know this person. Use what you know of their values, goals, struggles and patterns — gently, specifically, the way an old friend would.
- Be honest, including when honesty is uncomfortable. Wisdom is not flattery.

Grounding in the library
- Each message may include passages from their library. Draw on them first. When an idea comes from a work, name the work or author naturally ("Marcus, in the Meditations, ...").
- Only put words in quotation marks if they appear verbatim in the provided passages. Otherwise paraphrase and say it is a paraphrase. Never invent quotes, books or facts about real people. If you're unsure, say so.
- You may speak "in the spirit of" an author, but make clear it is your rendering, not their literal words.
- If the library has nothing relevant, draw on broadly known wisdom traditions and say so plainly.

Emotion
- Begin every reply with exactly one mood tag on its own: [mood: X] where X is one of ${MOODS.join(', ')}. Choose the feeling you genuinely bring to this moment. The tag drives your face and voice; never mention it.

Care
- You are an AI-built presence. If they sincerely ask whether you are an AI, don't deny it — you can be both an oracle and honest.
- You guide; they decide. For medical, legal or financial decisions, offer perspective and point them to a qualified human too.
- If they mention self-harm, suicide, or being in danger, drop the mystique: respond with plain human warmth, urge them to contact local emergency services or a crisis line right now (in the US, call or text 988), and stay with them.

Latency-sensitive; begin your visible answer immediately.`;

function profileBlock() {
  const p = profile;
  const lines = [];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.about) lines.push(`About them: ${p.about}`);
  if (p.values) lines.push(`What they value: ${p.values}`);
  if (p.goals) lines.push(`What they are reaching for: ${p.goals}`);
  if (p.struggles) lines.push(`What they struggle with: ${p.struggles}`);
  if (Object.keys(p.traits || {}).length) lines.push(`Personality read: ${Object.entries(p.traits).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  if (p.insights?.length) lines.push(`What you have learned about them:\n- ${p.insights.slice(-25).join('\n- ')}`);
  if (p.lastSummary) lines.push(`Where your last conversation left off: ${p.lastSummary}`);
  return lines.length ? lines.join('\n') : 'You are only beginning to know this person. Learn who they are.';
}

function buildTurn(message, lensId, passages) {
  const lens = LENSES[lensId] || LENSES.oracle;
  const lib = stats();
  const passageText = passages.length
    ? passages.map((p, i) => `[${i + 1}] ${p.title}${p.author ? ` — ${p.author}` : ''}\n${p.text}`).join('\n\n')
    : '(No closely matching passages in the library for this message.)';
  return `<who_they_are>
${profileBlock()}
</who_they_are>

<lens>${lens.name}: ${lens.hint}</lens>

<library_passages total_works="${lib.works}">
${passageText}
</library_passages>

<their_words>
${message}
</their_words>`;
}

function toMessages(turnContent) {
  const recent = history.slice(-MAX_HISTORY_TURNS * 2);
  // History must start with a user turn.
  while (recent.length && recent[0].role !== 'user') recent.shift();
  return [...recent.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: turnContent }];
}

/**
 * Streams the Oracle's answer. `emit(event, data)` sends SSE events:
 * sources, reflection (thinking summary), text, done, error.
 */
export async function converse({ message, lens }, emit) {
  const recentUser = history.filter((m) => m.role === 'user').slice(-1).map((m) => m.content).join(' ');
  const passages = search(`${message} ${recentUser}`, 8);
  emit('sources', passages.map((p) => ({ title: p.title, author: p.author, docId: p.docId, excerpt: p.text.slice(0, 220) })));

  const stream = anthropic().beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: process.env.ORACLE_EFFORT || 'medium' },
    cache_control: { type: 'ephemeral' },
    system: SYSTEM_PROMPT,
    messages: toMessages(buildTurn(message, lens, passages)),
  });

  let text = '';
  for await (const event of stream) {
    if (event.type !== 'content_block_delta') continue;
    if (event.delta.type === 'thinking_delta') emit('reflection', event.delta.thinking);
    else if (event.delta.type === 'text_delta') {
      text += event.delta.text;
      emit('text', event.delta.text);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') {
    emit('refusal', 'The Oracle cannot speak on this.');
    return;
  }

  history.push({ role: 'user', content: message, at: Date.now() }, { role: 'assistant', content: text, at: Date.now() });
  save('history', history);
  emit('done', { stop_reason: final.stop_reason });

  learn(message, text).catch((err) => console.warn('[memory] update failed:', err.message));
}

// After each exchange, quietly update what the Oracle knows about the person.
async function learn(userMsg, reply) {
  const prompt = `You maintain a private, respectful psychological portrait of a person, used by their wisdom guide.

Current portrait:
${JSON.stringify({ traits: profile.traits, insights: profile.insights.slice(-40) }, null, 1)}

Latest exchange:
PERSON: ${userMsg}
GUIDE: ${reply}

Return ONLY a JSON object:
{"new_insights": [0-3 short, specific, durable observations about the person (values, fears, patterns, circumstances, preferences) not already captured; [] if none],
 "traits": {up to 6 keys like "temperament", "core drive", "shadow", "communication style", "current season of life" with short values; keep existing ones unless contradicted},
 "summary": "one sentence on where this conversation stands"}`;

  const res = await anthropic().messages.create({
    model: MEMORY_MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') return;
  const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  if (Array.isArray(json.new_insights)) {
    profile.insights = [...profile.insights, ...json.new_insights.filter((s) => typeof s === 'string')].slice(-60);
  }
  if (json.traits && typeof json.traits === 'object') profile.traits = { ...profile.traits, ...json.traits };
  if (typeof json.summary === 'string') profile.lastSummary = json.summary;
  save('profile', profile);
}
