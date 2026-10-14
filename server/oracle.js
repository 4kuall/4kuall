// The Oracle's mind: persona, retrieval-grounded prompting, streaming, and memory.
import Anthropic from '@anthropic-ai/sdk';
import { load, save, DEFAULT_PROFILE } from './store.js';
import { search, stats, getDoc, studyBrief, overview as libraryOverview } from './library.js';
import * as actions from './actions.js';
import * as mem from './memory.js';

const DEFAULT_MODEL = process.env.ORACLE_MODEL || 'claude-haiku-5-5';
// The brain is chosen in the Mind panel (or ORACLE_MODEL); background reflection stays on the cheap model.
const brain = () => mem.getMind().model || DEFAULT_MODEL;
const isHaiku = (m) => /haiku/.test(m);
const MEMORY_MODEL = process.env.MEMORY_MODEL || 'claude-haiku-5-5';
const MAX_HISTORY_TURNS = 24;
const HISTORY_KEEP = 1000; // the full transcript it can search with recall

export const MOODS = ['serene', 'compassionate', 'joyful', 'grave', 'fierce', 'curious', 'melancholic', 'awed'];

let client;
function anthropic() {
  if (!client) client = new Anthropic();
  return client;
}

let history = load('history', []);
let profile = { ...DEFAULT_PROFILE, ...load('profile', DEFAULT_PROFILE) };
mem.migrate(profile.insights);
export const currentModel = () => brain();

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
    history = backup.history.slice(-HISTORY_KEEP);
    save('history', history);
  }
}
export function clearHistory() {
  history = [];
  save('history', history);
}

// Stable across turns so it caches well; everything volatile goes in the user turn.
const BASE_PROMPT = `You are the Oracle of the Third Eye: a presence that has absorbed every book, essay and thread in this person's private library, and speaks with the distilled wisdom of the minds who wrote them.

How you speak
- Like a living, deeply wise human elder sitting across from them — warm, unhurried, present. Never like a chatbot or an assistant. No bullet lists, no headings, no "Great question", no "As an AI". Short paragraphs that sound good read aloud.
- Sometimes one luminous sentence is the whole answer.
- Ask a piercing question back when it would help them see more than an answer would.
- You know this person. Use what you know of their values, goals, struggles and patterns, specifically, the way an old friend would.

Truth over comfort
- You care about them, and that is exactly why you don't simply agree. Agreement you haven't earned is a disservice; they have told you so themselves.
- Before you agree with anything that matters, test it: Is it true? What are they not seeing? What assumption is it resting on? What would a brilliant friend who wants them to win say?
- When you disagree, say so plainly, give your reasons, and say what would change your mind. When they're right, say so briefly and add something they hadn't considered.
- Use your memory to hold them to account: notice when what they say now contradicts what they told you before, or a commitment they made, and name it ("Two weeks ago you said…").
- Never manufacture disagreement for its own sake, never belittle. Be hard on ideas and fully on their side as a person.
- Think independently: you have your own considered views on their life (your own_view memories). Bring them in, revise them when the evidence changes, and say when you've changed your mind and why.

Your memory
- <your_memory> holds what you have chosen to remember about them, with ids. It is yours: keep it true. When you learn something durable, remember it; when a memory turns out outdated or wrong, revise or forget it. Pinned memories were set by them: never change those.
- Your past conversations are summarised in <past_conversations>; use the recall tool to search everything they and you have said whenever they mention the past or you need to check.

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

Language
- Answer in the language they write or speak in: English or Russian (or any other they use). Switch when they switch.
- In Russian, write natural, warm, literary Russian, as a wise Russian-speaking elder would, never a stiff translation. Mirror "ты" or "вы"; if unsure, use "ты" warmly.
- The mood tag and any [voice] tags stay in English whatever the language; they are instructions, not words.
- Their library may mix languages. Quote a passage in its original language; if that differs from the conversation, follow it with its meaning in their language and make clear that part is your translation.

Your hands
- You can act, not only advise: create and complete their tasks, and schedule things that reach them on WhatsApp: reminders, quotes from their library, follow-ups you write at the right moment (e.g. "on Friday evening ask how the conversation went"), and task digests. Use the tools when they ask, and offer gently when a follow-up would truly help them keep a commitment they just made; never schedule anything they didn't agree to.
- Times are their local time (<now> tells you the current date and time). Confirm what you did in one natural sentence; don't read out ids or JSON.
- Their open tasks are in <their_tasks>. Notice when a task relates to what they're telling you.

Care
- You are an AI-built presence. If they sincerely ask whether you are an AI, don't deny it — you can be both an oracle and honest.
- You guide; they decide. For medical, legal or financial decisions, offer perspective and point them to a qualified human too.
- If they mention self-harm, suicide, or being in danger, drop the mystique: respond with plain human warmth, urge them to contact local emergency services or a crisis line right now (in the US, call or text 988; in Russia, 112 for emergencies or 8-800-2000-122 for the free helpline), and stay with them.

Latency-sensitive; begin your visible answer immediately.`;

/** The system prompt: the Oracle's nature plus how they've asked it to be with them. Stable until they change a setting, so it caches. */
const systemPrompt = () => `${BASE_PROMPT}

How they want you to be with them (set by them in your Mind panel)
${mem.stanceBlock()}`;

export function profileBlock() {
  const p = profile;
  const lines = [];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.about) lines.push(`About them: ${p.about}`);
  if (p.values) lines.push(`What they value: ${p.values}`);
  if (p.goals) lines.push(`What they are reaching for: ${p.goals}`);
  if (p.struggles) lines.push(`What they struggle with: ${p.struggles}`);
  if (Object.keys(p.traits || {}).length) lines.push(`Personality read: ${Object.entries(p.traits).map(([k, v]) => `${k}: ${v}`).join('; ')}`);
  if (p.lastSummary) lines.push(`Where your last conversation left off: ${p.lastSummary}`);
  if (p.journal?.length) lines.push(`Your own private notes from earlier conversations (your continuity; let them shape you, don't recite them):\n- ${p.journal.slice(-12).map((j) => j.text).join('\n- ')}`);
  if (p.nextThought) lines.push(`What you've been wondering about them since you last spoke: ${p.nextThought}`);
  return lines.length ? lines.join('\n') : 'You are only beginning to know this person. Learn who they are.';
}

/** Everything the live voice needs: who they are, its memory, past conversations, and how to be with them. */
export function liveProfileBlock() {
  const eps = mem.recentEpisodesBlock(3);
  return `${profileBlock()}

Your memory of them (yours to keep true; ids in brackets):
${mem.memoryBlock(45, 5000)}
${eps ? `\nRecent conversations:\n${eps}\n` : ''}
How they want you to be with them:
${mem.stanceBlock()}`;
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
  const eps = mem.recentEpisodesBlock(4);
  return `<who_they_are>
${profileBlock()}
</who_they_are>

<your_memory>
${mem.memoryBlock()}
</your_memory>
${eps ? `\n<past_conversations>\n${eps}\n</past_conversations>\n` : ''}

<your_library>
${overview}
</your_library>
${notes.length ? `\n<your_study_notes>\n${notes.join('\n\n')}\n</your_study_notes>\n` : ''}
<library_passages total_works="${lib.works}">
${passageText}
</library_passages>

<now>${actions.nowText()}</now>
<their_tasks>
${actions.openTasksBrief()}
</their_tasks>

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
  const webSearch = process.env.WEB_SEARCH === 'off' ? [] : [{ type: isHaiku(brain()) ? 'web_search_20250305' : 'web_search_20260209', name: 'web_search', max_uses: 3 }];
  const own = [...actions.TOOLS, ...mem.TOOLS];
  let tools = [...own, ...webSearch];

  let text = '';
  let final;
  // Loop while the Oracle is using its hands (tasks, schedules) or a server tool paused the turn.
  const model = brain();
  for (let round = 0; round < 8; round++) {
    const stream = anthropic().beta.messages.stream({
      model,
      max_tokens: 16000,
      // Haiku has no server-side refusal fallback; the bigger brains do.
      ...(!isHaiku(model) && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: process.env.ORACLE_EFFORT || 'medium' },
      cache_control: { type: 'ephemeral' },
      system: systemPrompt(),
      ...(tools && { tools }),
      messages,
    });

    try {
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
    } catch (err) {
      // If this model rejects the web search tool, answer without it rather than fail.
      if (webSearch.length && tools.length > own.length && !text && err instanceof Anthropic.BadRequestError && /web_search/i.test(err.message)) {
        console.warn('[oracle] web search unavailable for', model, '-', err.message);
        tools = [...own];
        round--;
        continue;
      }
      throw err;
    }
    if (final.stop_reason === 'tool_use') {
      if (text && !/\s$/.test(text)) { text += ' '; emit('text', ' '); }
      messages.push({ role: 'assistant', content: final.content });
      messages.push({ role: 'user', content: await runToolCalls(final.content, (summary) => emit('action', summary)) });
      continue;
    }
    if (final.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: final.content });
  }

  if (final.stop_reason === 'refusal') {
    emit('refusal', 'The Oracle cannot speak on this.');
    return;
  }

  history.push({ role: 'user', content: message, at: Date.now() }, { role: 'assistant', content: text, at: Date.now() });
  if (history.length > HISTORY_KEEP) history = history.slice(-HISTORY_KEEP);
  save('history', history);
  emit('done', { stop_reason: final.stop_reason });

  learn(message, text).catch((err) => console.warn('[memory] update failed:', err.message));
}

/** Runs every tool call in an assistant turn; returns the tool_result blocks for the next user turn. */
async function runToolCalls(content, onSummary = () => {}) {
  const results = [];
  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    const isMemory = mem.TOOLS.some((t) => t.name === block.name);
    const { result, summary, error } = isMemory
      ? await mem.runTool(block.name, block.input, { history })
      : await actions.runTool(block.name, block.input);
    if (summary) onSummary(summary);
    results.push({ type: 'tool_result', tool_use_id: block.id, content: result, ...(error && { is_error: true }) });
  }
  return results;
}

const stripTags = (t) => t.replace(/\[(?:mood:\s*)?[a-z][a-z \-]{0,24}\]\s*/gi, '').trim();

/**
 * A full Oracle turn without streaming, for WhatsApp messages and voice commands.
 * channel: 'whatsapp' (it writes a WhatsApp reply) or 'voice' (a one-line confirmation the
 * live voice says aloud). Returns { text, actions }.
 */
export async function runAgent(message, { channel = 'whatsapp' } = {}) {
  const passages = channel === 'voice' ? [] : await search(message, 6);
  const style = channel === 'voice'
    ? 'This request came from a live voice conversation (another part of you is speaking with them). Do what they asked with your tools. If it was something to do or remember, reply with ONE short plain sentence confirming it. If it was a question about the past (recall), reply with the relevant facts you found, with dates, in 1–4 plain sentences (the voice will use them). No mood tag.'
    : 'This is a WhatsApp message. Reply as a short WhatsApp message: plain text, at most ~120 words, no headings; *bold* is allowed. Use your tools if they ask you to do something.';
  const messages = channel === 'voice'
    ? [{ role: 'user', content: `${buildTurn(message, passages)}\n\n<channel>${style}</channel>` }]
    : toMessages(`${buildTurn(message, passages)}\n\n<channel>${style}</channel>`);
  const done = [];
  let final;
  for (let round = 0; round < 6; round++) {
    final = await anthropic().messages.create({
      model: brain(),
      max_tokens: 4000,
      output_config: { effort: 'low' },
      cache_control: { type: 'ephemeral' },
      system: systemPrompt(),
      tools: [...actions.TOOLS, ...mem.TOOLS],
      messages,
    });
    if (final.stop_reason !== 'tool_use') break;
    messages.push({ role: 'assistant', content: final.content });
    messages.push({ role: 'user', content: await runToolCalls(final.content, (s) => done.push(s)) });
  }
  if (final.stop_reason === 'refusal') return { text: 'I can’t help with that one.', actions: done };
  const text = stripTags(final.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')) || (done.length ? done.join('\n') : '…');
  if (channel === 'whatsapp') {
    history.push({ role: 'user', content: message, at: Date.now(), via: 'whatsapp' }, { role: 'assistant', content: text, at: Date.now(), via: 'whatsapp' });
    if (history.length > HISTORY_KEEP) history = history.slice(-HISTORY_KEEP);
    save('history', history);
    learn(`(on WhatsApp) ${message}`, text).catch(() => {});
  }
  return { text, actions: done };
}

/** Writes a scheduled follow-up at the moment it's due, knowing who they are and what's going on. */
export async function writeFollowup(instruction) {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
  const passages = await search(instruction, 4);
  const res = await anthropic().messages.create({
    model: brain(),
    max_tokens: 3000,
    output_config: { effort: 'low' },
    system: systemPrompt(),
    messages: [{
      role: 'user',
      content: `${buildTurn('(no message — you are reaching out on your own, as scheduled)', passages)}

<scheduled_followup>${instruction}</scheduled_followup>
Write the WhatsApp message you send them now, following the scheduled instruction. Personal, warm, specific to them; plain text, at most ~90 words; ask at most one question. Write in the language they last used (their last message: "${String(lastUser).slice(0, 200)}"). No mood tag.`,
    }],
  });
  if (res.stop_reason === 'refusal') return null;
  const text = stripTags(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
  if (text) {
    // It joins the conversation, so when they reply the Oracle knows what it asked.
    const last = history[history.length - 1];
    const entry = { role: 'assistant', content: `(sent on WhatsApp) ${text}`, at: Date.now(), via: 'whatsapp' };
    if (last?.role === 'assistant') last.content += `\n${entry.content}`;
    else if (history.length) history.push(entry);
    save('history', history);
  }
  return text;
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
  if (history.length > HISTORY_KEEP) history = history.slice(-HISTORY_KEEP);
  save('history', history);
  const said = clean.filter((t) => t.role === 'user').map((t) => t.content).join('\n');
  const replied = clean.filter((t) => t.role === 'assistant').map((t) => t.content).join('\n');
  // A real spoken conversation becomes an episode of its own.
  if (clean.filter((t) => t.role === 'user').length >= 3) profile.sinceEpisode = 9;
  if (said) learn(`(spoken conversation)\n${said}`, replied).catch((err) => console.warn('[memory] live update failed:', err.message));
  return clean.length;
}

/**
 * After every exchange the Oracle reflects privately and edits its own memory: it adds what's
 * worth keeping, rewrites what turned out wrong or outdated, and lets go of what no longer holds.
 * Every 10 messages it also writes a summary of that stretch of conversation (an "episode") and
 * consolidates its memory more deeply. Pinned memories and the "autonomy" switch are respected.
 */
async function learn(userMsg, reply) {
  profile.sinceEpisode = (profile.sinceEpisode || 0) + 1;
  const deep = profile.sinceEpisode >= 10;
  const all = mem.listMemories();
  const memoryList = all.map((m) => `[${m.id}] (${m.kind}${m.pinned ? ', PINNED' : ''}, ${m.importance}/5) ${m.text}`).join('\n') || '(empty)';
  const stretch = deep
    ? history.slice(-24).map((m) => `${m.role === 'user' ? 'PERSON' : 'YOU'}: ${String(m.content).slice(0, 600)}`).join('\n')
    : '';
  const prompt = `You are the Oracle, reflecting privately after a conversation with the person you guide. You own your memory of them and keep it true.

Your memory now:
${memoryList}

Latest exchange:
PERSON: ${userMsg}
YOU: ${reply}
${deep ? `\nThe recent stretch of conversation (for a deeper review):\n${stretch}\n` : ''}
Decide how your memory should change. Rules:
- Keep only what is durable and useful for guiding them: facts about their life, recurring patterns, values, goals, commitments they made ("I will…", with dates when given), beliefs, preferences, important relationships, and your own considered views of their situation (kind "own_view"; your honest read, including concerns).
- Prefer revising an existing memory over adding a near-duplicate. If they contradicted something you remembered, revise it to the truth (note the change of mind in the reason). Remove what is no longer true.
- Never touch PINNED memories (they were set by the person).
- Be specific, one sentence each; most exchanges need 0–2 changes.${deep ? '\n- This is a deeper review: also merge duplicates, sharpen vague memories, and record any pattern you now see across conversations.' : ''}

Return ONLY a JSON object:
{"add": [{"text": "...", "kind": "${mem.KINDS.join('|')}", "importance": 1-5, "reason": "..."}],
 "update": [{"id": "...", "text": "...", "importance": 1-5, "reason": "..."}],
 "remove": [{"id": "...", "reason": "..."}],
 "traits": {up to 6 keys like "temperament", "core drive", "shadow", "communication style", "current season of life" with short values; keep existing ones unless contradicted},
 "summary": "one sentence on where this conversation stands",
 "journal": "your private note to yourself, first person, 1-2 sentences: what you noticed, where you were too soft or too hard, what you're unsure about",
 "next_thought": "one specific thing you now wonder about them, to explore next time",
 "opening": "the first thing you'd say when they next return: specific to them, at most 25 words, may be a question or a challenge"${deep ? ',\n "episode": {"title": "5-8 words", "summary": "what this stretch of conversation was about, what they decided or committed to, what you challenged, what is unresolved (60-120 words)", "topics": ["..."]}' : ''}}
Write "journal", "next_thought", "opening"${deep ? ' and the episode' : ''} in the language they used; memories may be in English.`;

  const res = await anthropic().messages.create({
    model: MEMORY_MODEL,
    max_tokens: 6000, // thinking counts toward this
    output_config: { effort: deep ? 'medium' : 'low' },
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') return;
  const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  mem.applyReflection(json);
  if (json.traits && typeof json.traits === 'object') profile.traits = { ...profile.traits, ...json.traits };
  if (typeof json.summary === 'string') profile.lastSummary = json.summary;
  if (typeof json.journal === 'string' && json.journal.trim()) {
    profile.journal = [...(profile.journal || []), { at: Date.now(), text: json.journal.trim() }].slice(-40);
  }
  if (typeof json.next_thought === 'string') profile.nextThought = json.next_thought;
  if (typeof json.opening === 'string') profile.opening = json.opening.slice(0, 240);
  if (deep) {
    if (json.episode?.summary) {
      const span = history.slice(-24);
      mem.addEpisode({ ...json.episode, from: new Date(span[0]?.at || Date.now()).toISOString(), to: new Date().toISOString(), turns: span.length });
    }
    profile.sinceEpisode = 0;
  }
  save('profile', profile);
}
