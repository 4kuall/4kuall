// The Oracle's hands: tasks, scheduled automations (reminders, quotes from your library,
// AI-written follow-ups, task digests) and delivery to your WhatsApp.
//
// Delivery: Twilio WhatsApp (two-way: you can also text the Oracle) when TWILIO_* are set,
// otherwise CallMeBot (free, personal, send-only) when CALLMEBOT_APIKEY is set; every
// message is also kept in the in-app inbox, so nothing is lost if neither is configured.
import crypto from 'node:crypto';
import { load, save } from './store.js';

let tasks = load('tasks', []);
let automations = load('automations', []);
let inbox = load('inbox', []);
let prefs = { tz: 'UTC', ...load('prefs', {}) };
const persist = () => { save('tasks', tasks); save('automations', automations); save('inbox', inbox); };

// Filled in by index.js: write a message with Claude, and pick a verified quote from the library.
let hooks = { generate: async (instruction) => instruction, quote: async () => null };
export function init(h) { hooks = { ...hooks, ...h }; }

const id = () => crypto.randomBytes(3).toString('hex');
const nowISO = () => new Date().toISOString();

export const getPrefs = () => prefs;
export function setPrefs(patch) {
  if (!patch.tz || !isValidTz(patch.tz) || patch.tz === prefs.tz) return prefs;
  prefs.tz = patch.tz;
  save('prefs', prefs);
  // Schedules are in local time: recompute them for the new timezone.
  for (const a of automations) if (a.active) a.nextRun = nextRun(a.schedule, new Date())?.toISOString() || null;
  persist();
  return prefs;
}
function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// ───────── Time, in the user's timezone ─────────
function zoned(date, tz = prefs.tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute, dow };
}
/** A wall-clock time in the user's timezone → the real instant. */
function fromLocal(y, m, d, h, mi, tz = prefs.tz) {
  const target = Date.UTC(y, m - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zoned(new Date(guess), tz);
    guess += target - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  }
  return new Date(guess);
}
export function nowText() {
  const d = new Date();
  const text = new Intl.DateTimeFormat('en-GB', { timeZone: prefs.tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  return `${text} (${prefs.tz})`;
}
function parseLocal(s) {
  // "2026-10-15T09:00" (their local time) or anything with an explicit offset / Z.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(String(s || '').trim());
  if (m) return fromLocal(+m[1], +m[2], +m[3], +(m[4] ?? 9), +(m[5] ?? 0));
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}
const fmt = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: prefs.tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—');

/**
 * Schedules:
 *   { at: "2026-10-15T09:00" }                        once, local time
 *   { every: "day", times: ["08:00"] }                 daily
 *   { every: "weekdays", times: ["07:30"] }            Mon–Fri
 *   { every: "week", days: [1,4], times: ["19:00"] }   chosen weekdays (0 = Sunday)
 *   { every: "hours", interval: 3, from: "09:00", to: "21:00" }
 */
export function nextRun(s, after) {
  if (!s) return null;
  if (s.at) {
    const t = parseLocal(s.at);
    return t && t > after ? t : null;
  }
  const times = (s.times?.length ? s.times : ['09:00']).map((t) => t.split(':').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const today = zoned(after);
  for (let k = 0; k < 9; k++) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + k));
    const y = base.getUTCFullYear(); const m = base.getUTCMonth() + 1; const d = base.getUTCDate(); const dow = base.getUTCDay();
    if (s.every === 'weekdays' && (dow === 0 || dow === 6)) continue;
    if (s.every === 'week' && !(s.days || []).includes(dow)) continue;
    if (s.every === 'hours') {
      const [fh, fm] = (s.from || '08:00').split(':').map(Number);
      const [th, tm] = (s.to || '22:00').split(':').map(Number);
      const step = Math.max(1, Number(s.interval) || 3) * 60;
      for (let min = fh * 60 + fm; min <= th * 60 + tm; min += step) {
        const t = fromLocal(y, m, d, Math.floor(min / 60), min % 60);
        if (t > after) return t;
      }
      continue;
    }
    for (const [h, mi] of times) {
      const t = fromLocal(y, m, d, h, mi);
      if (t > after) return t;
    }
  }
  return null;
}
function describe(s) {
  if (s.at) return `once, ${fmt(parseLocal(s.at)?.toISOString())}`;
  const at = (s.times || ['09:00']).join(', ');
  if (s.every === 'day') return `every day at ${at}`;
  if (s.every === 'weekdays') return `weekdays at ${at}`;
  if (s.every === 'week') return `${(s.days || []).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')} at ${at}`;
  if (s.every === 'hours') return `every ${s.interval || 3}h, ${s.from || '08:00'}–${s.to || '22:00'}`;
  return 'custom';
}

// ───────── WhatsApp delivery ─────────
const twilio = () => {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_WHATSAPP_FROM: from, WHATSAPP_TO: to } = process.env;
  return sid && token && from && to ? { sid, token, from, to } : null;
};
const callmebot = () => {
  const { CALLMEBOT_APIKEY: key, WHATSAPP_TO: to } = process.env;
  return key && to ? { key, to } : null;
};
export function channel() {
  if (twilio() && callmebot()) return { name: 'WhatsApp (CallMeBot + Twilio)', twoWay: true, connected: true };
  if (twilio()) return { name: 'Twilio WhatsApp', twoWay: true, connected: true };
  if (callmebot()) return { name: 'CallMeBot WhatsApp', twoWay: false, connected: true };
  return { name: 'In-app inbox only', twoWay: false, connected: false };
}
const waNumber = (n) => `whatsapp:${String(n).replace(/^whatsapp:/, '').replace(/[^\d+]/g, '')}`;

export async function send(text, { title = '', source = 'oracle' } = {}) {
  const body = String(text).slice(0, 1500);
  const entry = { id: id(), at: nowISO(), title, text: body, source, delivered: false, via: channel().name, error: '' };
  try {
    // Replies to your WhatsApp messages go back through Twilio. Everything the Oracle sends on its
    // own prefers CallMeBot when it's set up: WhatsApp only lets businesses (Twilio) message you
    // freely within 24 hours of your last message.
    const cb = callmebot();
    const tw = twilio() && (source === 'reply' || !cb) ? twilio() : null;
    if (tw) {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tw.sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${tw.sid}:${tw.token}`).toString('base64')}` },
        body: new URLSearchParams({ From: waNumber(tw.from), To: waNumber(tw.to), Body: body }),
      });
      if (!r.ok) throw new Error(`Twilio ${r.status}: ${(await r.text()).slice(0, 200)}`);
      entry.delivered = true;
    } else if (cb) {
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(cb.to.replace(/[^\d+]/g, ''))}&text=${encodeURIComponent(body)}&apikey=${encodeURIComponent(cb.key)}`;
      const r = await fetch(url);
      const out = await r.text();
      if (!r.ok || (!/queued|sent|success/i.test(out) && /error|invalid|apikey|blocked/i.test(out))) throw new Error(`CallMeBot: ${out.replace(/<[^>]+>/g, ' ').trim().slice(0, 200)}`);
      entry.delivered = true;
    }
  } catch (err) {
    entry.error = err.message;
    console.warn('[whatsapp]', err.message);
  }
  inbox = [...inbox, entry].slice(-100);
  save('inbox', inbox);
  return entry;
}

/** Twilio signs every webhook; accept only genuine ones. */
export function verifyTwilio(signature, url, params) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
export const isOwner = (from) => {
  const to = process.env.WHATSAPP_TO;
  return Boolean(to) && waNumber(from) === waNumber(to);
};

// ───────── Tasks ─────────
export const listTasks = () => tasks;
function findTask(ref) {
  const r = String(ref || '').toLowerCase().trim();
  return tasks.find((t) => t.id === r) || tasks.find((t) => t.status !== 'deleted' && t.title.toLowerCase().includes(r));
}
export function openTasksBrief(limit = 12) {
  const open = tasks.filter((t) => t.status === 'open');
  if (!open.length) return 'No open tasks.';
  return open.slice(0, limit).map((t) => `- [${t.id}] ${t.title}${t.due ? ` (due ${fmt(t.due)})` : ''}`).join('\n') + (open.length > limit ? `\n…and ${open.length - limit} more` : '');
}

// ───────── Automations ─────────
export const listAutomations = () => automations.map((a) => ({ ...a, when: describe(a.schedule), nextRunText: fmt(a.nextRun) }));
export const getInbox = () => inbox.slice().reverse();

function addAutomation({ kind, title, text, schedule }) {
  const next = nextRun(schedule, new Date());
  if (!next) throw new Error('That time is in the past or the schedule never fires. Give a future time.');
  const fallback = { digest: 'Task digest', quote: text ? `Quote · ${text}` : 'Quote from your library', message: text.slice(0, 60), followup: `Follow-up: ${text.slice(0, 50)}` }[kind];
  const a = { id: id(), kind, title: title || fallback, text, schedule, active: true, createdAt: nowISO(), nextRun: next.toISOString(), lastRun: null, runs: 0 };
  automations.push(a);
  persist();
  return a;
}

async function compose(a) {
  if (a.kind === 'message') return a.text;
  if (a.kind === 'digest') {
    const open = tasks.filter((t) => t.status === 'open');
    if (!open.length) return null; // nothing to nag about
    return `Your open tasks:\n${open.slice(0, 15).map((t) => `• ${t.title}${t.due ? ` — ${fmt(t.due)}` : ''}`).join('\n')}`;
  }
  if (a.kind === 'quote') {
    const q = await hooks.quote(a.text, a.sent || []);
    if (!q) return null;
    a.sent = [...(a.sent || []), q.key].slice(-60);
    return `“${q.text}”\n— ${q.source}`;
  }
  return hooks.generate(a.text, a); // 'followup': Claude writes it, with their profile, tasks and library
}

export async function runAutomation(a) {
  const text = await compose(a);
  a.lastRun = nowISO();
  a.runs += 1;
  if (text) await send(text, { title: a.title, source: a.kind });
  const next = a.schedule.at ? null : nextRun(a.schedule, new Date(Date.now() + 1000));
  a.nextRun = next?.toISOString() || null;
  if (!next) a.active = false;
  persist();
  return text;
}

// The heartbeat: every minute, run whatever is due. Catches up (once) after the server slept.
let ticking = false;
export function startScheduler() {
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      for (const a of automations) {
        if (!a.active || !a.nextRun || Date.parse(a.nextRun) > now) continue;
        // Missed by more than 6 hours (the server was asleep): skip to the next slot rather than spam.
        if (now - Date.parse(a.nextRun) > 6 * 3600000 && !a.schedule.at) {
          a.nextRun = nextRun(a.schedule, new Date())?.toISOString() || null;
          persist();
          continue;
        }
        await runAutomation(a).catch((err) => console.warn('[automation]', a.id, err.message));
      }
    } finally {
      ticking = false;
    }
  }, 60000);
}

// ───────── Tools Claude can use ─────────
const SCHEDULE = {
  type: 'object',
  description: 'When to run. Either {"at":"YYYY-MM-DDTHH:MM"} once (their local time), or recurring: {"every":"day"|"weekdays","times":["HH:MM"]}, {"every":"week","days":[0-6, 0=Sunday],"times":["HH:MM"]}, or {"every":"hours","interval":3,"from":"09:00","to":"21:00"}.',
  properties: {
    at: { type: 'string' },
    every: { type: 'string', enum: ['day', 'weekdays', 'week', 'hours'] },
    days: { type: 'array', items: { type: 'integer' } },
    times: { type: 'array', items: { type: 'string' } },
    interval: { type: 'integer' },
    from: { type: 'string' },
    to: { type: 'string' },
  },
};
export const TOOLS = [
  {
    name: 'create_task',
    description: 'Add a task or to-do for them. Set due (their local time) when they mention a deadline; set remind=true to also message them on WhatsApp at that time.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        due: { type: 'string', description: 'YYYY-MM-DD or YYYY-MM-DDTHH:MM, their local time' },
        remind: { type: 'boolean' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Mark a task done, reopen it, delete it, or change its title/due date. Refer to it by id or by part of its title.',
    input_schema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        status: { type: 'string', enum: ['done', 'open', 'deleted'] },
        title: { type: 'string' },
        due: { type: 'string' },
      },
      required: ['task'],
    },
  },
  { name: 'list_tasks', description: 'See their tasks (open by default).', input_schema: { type: 'object', properties: { include_done: { type: 'boolean' } } } },
  {
    name: 'schedule',
    description: 'Set up something that happens automatically on their WhatsApp. kind: "message" sends text as-is (a reminder); "quote" sends a verified passage from their library (text = topic or author, may be empty); "followup" has you write a fresh, personal message at that time from an instruction (text = what to ask or say, e.g. "ask how the talk with her boss went"); "digest" sends their open tasks.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['message', 'quote', 'followup', 'digest'] },
        title: { type: 'string', description: 'short label they will see in their list' },
        text: { type: 'string' },
        when: SCHEDULE,
      },
      required: ['kind', 'when'],
    },
  },
  { name: 'list_automations', description: 'See what is scheduled.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'cancel_automation',
    description: 'Stop a scheduled automation, by id or part of its title.',
    input_schema: { type: 'object', properties: { automation: { type: 'string' } }, required: ['automation'] },
  },
  {
    name: 'send_whatsapp',
    description: 'Send them a WhatsApp message right now (e.g. a passage they asked you to send them, or a summary to keep).',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
];

const str = (v, n = 500) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Runs one tool call; returns { result (text for Claude), summary (short line for the person) }. */
export async function runTool(name, input = {}) {
  try {
    switch (name) {
      case 'create_task': {
        const title = str(input.title, 200);
        if (!title) throw new Error('A task needs a title.');
        const due = input.due ? parseLocal(input.due) : null;
        const t = { id: id(), title, notes: str(input.notes, 1000), due: due?.toISOString() || null, status: 'open', createdAt: nowISO() };
        tasks.push(t);
        persist();
        let extra = '';
        if (input.remind && due && due > new Date()) {
          addAutomation({ kind: 'message', title: `Reminder: ${title}`, text: `⏰ Reminder: ${title}${t.notes ? `\n${t.notes}` : ''}`, schedule: { at: due.toISOString() } });
          extra = ` I'll remind them on WhatsApp ${fmt(t.due)}.`;
        }
        return { result: `Task created [${t.id}]: ${title}${t.due ? `, due ${fmt(t.due)}` : ''}.${extra}`, summary: `✓ Task: ${title}` };
      }
      case 'update_task': {
        const t = findTask(input.task);
        if (!t) throw new Error(`No task matching "${input.task}".`);
        if (input.status) t.status = input.status;
        if (input.title) t.title = str(input.title, 200);
        if (input.due) t.due = parseLocal(input.due)?.toISOString() || t.due;
        if (t.status === 'deleted') tasks = tasks.filter((x) => x !== t);
        if (t.status === 'done') t.doneAt = nowISO();
        persist();
        return { result: `Task "${t.title}" is now ${t.status}.`, summary: `✓ ${t.title}: ${t.status}` };
      }
      case 'list_tasks': {
        const list = tasks.filter((t) => input.include_done || t.status === 'open');
        return { result: list.length ? list.map((t) => `[${t.id}] ${t.title} — ${t.status}${t.due ? `, due ${fmt(t.due)}` : ''}`).join('\n') : 'No tasks.', summary: '' };
      }
      case 'schedule': {
        const kind = ['message', 'quote', 'followup', 'digest'].includes(input.kind) ? input.kind : 'message';
        const text = str(input.text, 1000);
        if ((kind === 'message' || kind === 'followup') && !text) throw new Error('This kind needs text.');
        const a = addAutomation({ kind, title: str(input.title, 80), text, schedule: input.when || {} });
        const ch = channel();
        const where = ch.connected ? 'on their WhatsApp' : 'in the app inbox (WhatsApp is not connected yet; tell them to connect it under Tasks)';
        return { result: `Scheduled [${a.id}] ${a.title}: ${describe(a.schedule)}; first ${fmt(a.nextRun)}, delivered ${where}.`, summary: `⏱ ${a.title} — ${describe(a.schedule)}` };
      }
      case 'list_automations': {
        const list = automations.filter((a) => a.active);
        return { result: list.length ? list.map((a) => `[${a.id}] ${a.title} (${a.kind}) — ${describe(a.schedule)}, next ${fmt(a.nextRun)}`).join('\n') : 'Nothing scheduled.', summary: '' };
      }
      case 'cancel_automation': {
        const r = String(input.automation || '').toLowerCase();
        const a = automations.find((x) => x.id === r) || automations.find((x) => x.active && x.title.toLowerCase().includes(r));
        if (!a) throw new Error(`Nothing scheduled matching "${input.automation}".`);
        automations = automations.filter((x) => x !== a);
        persist();
        return { result: `Cancelled "${a.title}".`, summary: `✕ Cancelled: ${a.title}` };
      }
      case 'send_whatsapp': {
        const e = await send(str(input.text, 1500), { source: 'sent' });
        return {
          result: e.delivered ? 'Sent to their WhatsApp.' : `Not delivered${e.error ? ` (${e.error})` : ' (WhatsApp is not connected)'}; it is in the app inbox.`,
          summary: e.delivered ? '✓ Sent to WhatsApp' : '⚠ Saved to inbox (WhatsApp not connected)',
        };
      }
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  } catch (err) {
    return { result: `Error: ${err.message}`, summary: '', error: true };
  }
}

// App endpoints use these directly.
export function setTaskStatus(taskId, status) { return runTool('update_task', { task: taskId, status }); }
export function cancel(automationId) { return runTool('cancel_automation', { automation: automationId }); }
export async function runNow(automationId) {
  const a = automations.find((x) => x.id === automationId);
  if (!a) throw new Error('Not found.');
  const text = await compose(a);
  if (text) await send(text, { title: a.title, source: a.kind });
  return text;
}
export function exportAll() { return { tasks, automations, prefs }; }
export function restore(data) {
  if (Array.isArray(data.tasks)) for (const t of data.tasks) if (t?.id && !tasks.some((x) => x.id === t.id)) tasks.push(t);
  if (Array.isArray(data.automations)) for (const a of data.automations) if (a?.id && !automations.some((x) => x.id === a.id)) automations.push(a);
  persist();
}
