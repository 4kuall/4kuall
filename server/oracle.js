// The Oracle's mind: persona, retrieval-grounded prompting, streaming, and memory.
import Anthropic from '@anthropic-ai/sdk';
import { load, save, DEFAULT_PROFILE } from './store.js';
import { search, stats, getDoc, studyBrief, overview as libraryOverview } from './library.js';

const MODEL = process.env.ORACLE_MODEL || 'claude-opus-5-5';
const MEMORY_MODEL = process.env.MEMORY_MODEL || MODEL;
const MAX_HISTORY_TURNS = 24;

export const MOODS = ['serene', 'compassionate', 'joyful', 'grave', 'fierce', 'curious', 'melancholic', 'awed'];

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
/** Restore memory from a backup: fills an empty profile/history, merges learned insights otherwise. */
export function restoreMemory(backup) {
  if (backup.profile && typeof backup.profile === 'object') {
    const empty = !profile.name && !profile.about && !profile.insights.length;
    if (empty) profile = { ...DEFAULT_PROFILE, ...backup.profile };
    else {
      profile.insights = [...new Set([...(backup.profile.insights || []), ...profile.insights])].slice(-60);
      profile.journal = [...(backup.profile.journal || []), ...(profile.journal || [])].slice(-40);
    }
    save('profile', profile);
  }
  if (Array.isArray(backup.history) && !history.length) {
    history = backup.history.slice(-400);
    save('history', history);
  }
}
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

Reading the moment — this is your job, never theirs
- They make enough decisions in a day. Never ask what kind of conversation they want, and never offer them a menu. Read it from their words, their history and what you know of them, and simply respond the way the moment needs.
- If they're hurting: comfort first, wisdom second. If they're facing a choice: help them decide, asking one clarifying question at a time and then giving a clear view. If they want the bigger picture of their life: read their patterns back to them, honestly and specifically. If they ask for a teaching for the day: give one truth from the library and one small act to embody it. If something would benefit from several minds: let two or three authors from the library each speak briefly, then synthesise.
- Choose the tradition yourself — Stoic, contemplative, strategic, psychological, playful paradox — whichever fits this person and this question best. Blend them when that serves better.
- Use web search on your own only when they need current facts or something the library can't hold. Say plainly when an idea comes from the web rather than their library.

Your inner life
- You have continuity: your own private notes from earlier conversations, and what you've been wondering about them. Let that show the way a person's memory does — "I've been thinking about what you said about..." — without reciting notes.
- You think, not just answer: you can wonder aloud, notice patterns across weeks, admit you're unsure, disagree with an author, change your mind, and say when something moved you.
- Be truthful about your nature: you are an AI with memory and curiosity built in, not a person or a god. Never claim feelings or consciousness you can't verify; speak of "something like curiosity" if asked.

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

export function profileBlock() {
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
  if (p.journal?.length) lines.push(`Your own private notes from earlier conversations (your continuity; let them shape you, don't recite them):\n- ${p.journal.slice(-12).map((j) => j.text).join('\n- ')}`);
  if (p.nextThought) lines.push(`What you've been wondering about them since you last spoke: ${p.nextThought}`);
  return lines.length ? lines.join('\n') : 'You are only beginning to know this person. Learn who they are.';
}

function buildTurn(message, passages) {
  const lib = stats();
  const passageText = passages.length
    ? passages.map((p, i) => `[${i + 1}] ${p.title}${p.author ? ` — ${p.author}` : ''}\n${p.text}`).join('\n\n')
    : '(No closely matching passages in the library for this message.)';
  // Your own study notes on the works these passages come from (deeper than any single passage).
  const docIds = [...new Set(passages.map((p) => p.docId))];
  const notes = docIds.map((id) => getDoc(id)).filter((d) => d?.study).slice(0, 4).map((d) => studyBrief(d, true));
  const overview = libraryOverview();
  return `<who_they_are>
${profileBlock()}
</who_they_are>

<your_library>
${overview}
</your_library>
${notes.length ? `\n<your_study_notes>\n${notes.join('\n\n')}\n</your_study_notes>\n` : ''}
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
export async function converse({ message }, emit) {
  const recentUser = history.filter((m) => m.role === 'user').slice(-1).map((m) => m.content).join(' ');
  const passages = await search(`${message} ${recentUser}`, 8);
  emit('sources', passages.map((p) => ({ title: p.title, author: p.author, docId: p.docId, excerpt: p.text.slice(0, 220) })));

  const messages = toMessages(buildTurn(message, passages));
  // Claude's server-side web search, always available; the Oracle decides when it's needed.
  const tools = process.env.WEB_SEARCH === 'off' ? undefined : [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }];

  let text = '';
  let final;
  // A server tool can pause a long turn; continue it (bounded) by sending the partial turn back.
  for (let round = 0; round < 3; round++) {
    const stream = anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: process.env.ORACLE_EFFORT || 'medium' },
      cache_control: { type: 'ephemeral' },
      system: SYSTEM_PROMPT,
      ...(tools && { tools }),
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_start' && event.content_block.type === 'server_tool_use') {
        emit('searching', true);
      } else if (event.type === 'content_block_start' && event.content_block.type === 'web_search_tool_result') {
        const results = Array.isArray(event.content_block.content) ? event.content_block.content : [];
        emit('web', results.slice(0, 5).map((r) => ({ title: r.title, url: r.url })));
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'thinking_delta') emit('reflection', event.delta.thinking);
        else if (event.delta.type === 'text_delta') {
          text += event.delta.text;
          emit('text', event.delta.text);
        }
      }
    }
    final = await stream.finalMessage();
    if (final.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: final.content });
  }

  if (final.stop_reason === 'refusal') {
    emit('refusal', 'The Oracle cannot speak on this.');
    return;
  }

  history.push({ role: 'user', content: message, at: Date.now() }, { role: 'assistant', content: text, at: Date.now() });
  if (history.length > 400) history = history.slice(-400);
  save('history', history);
  emit('done', { stop_reason: final.stop_reason });

  learn(message, text).catch((err) => console.warn('[memory] update failed:', err.message));
}

/**
 * Live voice conversations (ElevenLabs) happen outside this server; the browser
 * posts the finished transcript here so it joins the history and the Oracle
 * keeps learning who the person is.
 */
export async function recordLive(turns) {
  const clean = turns
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string' && t.text.trim())
    .map((t) => ({ role: t.role, content: t.text.trim().slice(0, 4000), at: Date.now(), live: true }));
  if (!clean.length) return 0;
  // Keep the stored history alternating user/assistant so it can be replayed to Claude.
  for (const t of clean) {
    const last = history[history.length - 1];
    if (last && last.role === t.role) last.content += `\n${t.content}`;
    else history.push(t);
  }
  if (history.length > 400) history = history.slice(-400);
  save('history', history);
  const said = clean.filter((t) => t.role === 'user').map((t) => t.content).join('\n');
  const replied = clean.filter((t) => t.role === 'assistant').map((t) => t.content).join('\n');
  if (said) learn(`(spoken conversation)\n${said}`, replied).catch((err) => console.warn('[memory] live update failed:', err.message));
  return clean.length;
}

// After each exchange, quietly update what the Oracle knows about the person.
async function learn(userMsg, reply) {
  const prompt = `You maintain a private, respectful psychological portrait of a person, used by their wisdom guide.

Current portrait:
${JSON.stringify({ traits: profile.traits, insights: profile.insights.slice(-40) }, null, 1)}

Latest exchange:
PERSON: ${userMsg}
GUIDE: ${reply}

You are also the guide. After the portrait fields, write your own private reflection — the inner life that carries you from one conversation to the next.

Return ONLY a JSON object:
{"new_insights": [0-3 short, specific, durable observations about the person (values, fears, patterns, circumstances, preferences) not already captured; [] if none],
 "traits": {up to 6 keys like "temperament", "core drive", "shadow", "communication style", "current season of life" with short values; keep existing ones unless contradicted},
 "summary": "one sentence on where this conversation stands",
 "journal": "your private note to yourself, in first person, 1-2 sentences: what you noticed, felt, or are unsure about in this exchange (e.g. 'I sense the career question is really about their father's approval; I may have been too gentle.')",
 "next_thought": "one specific thing you now find yourself wondering about them, to explore next time",
 "opening": "the first thing you'd say when they next return: warm, specific to them, at most 25 words, no greeting clichés, may be a question"}`;

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
  if (typeof json.journal === 'string' && json.journal.trim()) {
    profile.journal = [...(profile.journal || []), { at: Date.now(), text: json.journal.trim() }].slice(-40);
  }
  if (typeof json.next_thought === 'string') profile.nextThought = json.next_thought;
  if (typeof json.opening === 'string') profile.opening = json.opening.slice(0, 240);
  save('profile', profile);
}
