# ◉ Oracle of the Third Eye

A private wisdom companion that speaks to you in the combined voice of the authors you feed it. You upload your books, blogs, Reddit threads and notes. It listens to you by voice and answers in a warm, human cadence, grounded in your library. It learns your personality as you talk, and it appears as a living 3D being with a third eye that breathes, blinks, follows your cursor, thinks and speaks.

```
 you ──voice/text──▶  ┌──────────────────── server (Node) ────────────────────┐
                      │  Library ─ hybrid search: BM25 + Hugging Face vectors   │──▶ Claude (mind + web search)
                      │  Soul    ─ profile + learned insights                   │──▶ ElevenLabs (voice + speech-to-text)
                      │  Memory  ─ conversation history                         │──▶ Project Gutenberg (classics)
                      └─────────────────────────────────────────────────────────┘
 3D Oracle (Three.js) ◀── streamed words · mood · inner reflections · audio amplitude
```

## It studies your books

Give it a book, journal or article: drop the file anywhere on the screen, paste it, tap 📎, or paste a link into the message box and it reads the whole thing in the background, in one pass, using Claude's 1-million-token context. It then writes its own study notes:
- the essence of the book
- its key ideas
- how to live them
- how the author thinks
- the life moments the book is for
- a few passages worth quoting

A passage is kept only if it appears **word for word** in the book. Books show *Studying…* and then *Studied ✓*; tap one to read the notes. In conversation, the Oracle uses these notes together with the passages it retrieves.

Cost: one study per book, billed to your Anthropic account. A typical 100k-word book is roughly 130k input tokens. Check current pricing at anthropic.com/pricing. Set `STUDY_BOOKS=off` to disable studying, or `STUDY_MODEL` to change which model does it.

## Its inner life

After every conversation it writes itself a private note, records something it is now wondering about you, and drafts what it will say when you next return. That draft appears on the home screen and is the first thing it says in a live call. This is continuity built from memory. It's designed to feel like a presence that remembers and thinks about you. It is not consciousness, and the Oracle is instructed to be honest about that if asked.

## What it looks like

The Oracle is a surreal digital globe built from tens of thousands of glowing blue points. Continents of light on it drift and slowly reshape. An eye made of the same light sits in its face:
- a fibrous iris, a dark pupil and a glowing lid line
- the eye blinks, narrows and widens with its mood
- the planet turns beneath the eye while the eye keeps looking at you

Around it:
- **A knowledge network.** Arcs of light pulse between nodes on the globe. The network grows with every work you give it, and a wave of light runs into the eye whenever something new is absorbed.
- **Data orbits** with bright satellites.
- **A background** of drifting constellation networks, rising data streams and a holographic grid floor.

When it speaks, ripples run out from the eye with its real voice. When it thinks, the arcs fire faster and it looks up and away.

The eye runs on a small attention system. It holds your gaze when listening, follows your pointer, watches you type, and wanders around the room when you go quiet.

## Its mind: memory you control, and a sparring partner rather than a yes-man

**It remembers, and it rewrites its own memory.**
- **Individual memories.** The Oracle keeps memories as separate items: facts, patterns, values, goals, commitments, beliefs, preferences, relationships, and its own views of your situation.
- **Reflection after every exchange.** After each exchange it decides what to add, which memory to rewrite because it turned out wrong or outdated, and what to let go of. It records why for every change.
- **Mid-conversation edits.** It can also do this during a conversation ("remember…", "forget…").

**It remembers your past conversations.**
- **Episodes.** Every ~10 messages, and after each spoken conversation, it writes a summary of what you talked about, what you decided and what's unresolved.
- **Searchable history.** It searches those summaries and the full transcript (the last 1,000 messages) whenever you mention the past.

**It thinks with you, not just agrees.** Its core instructions now include "truth over comfort":
- It tests what you say before agreeing.
- It argues the other side before you commit.
- It names contradictions with what you told it before, and the commitments you made.
- It offers unconventional options.
- It holds its own views and says when it changes its mind.
- It's hard on ideas and on your side as a person.

**You control everything (Mind tab):**
- **Challenge, from 1 to 5.** At 1 it's a gentle supporter; at 5 it's your toughest sparring partner. The default is 4.
- **Warmth and depth.**
- **Its brain.** Haiku 5.5 is the cheapest. Sonnet 5.5 is sharper and costs about 20× Haiku. Opus 5.5 is the deepest and costs about 40× Haiku. These are rough figures from Anthropic's current prices; check anthropic.com/pricing.
- **Behaviour switches.** Turn devil's advocate and out-of-the-box thinking on or off.
- **Self-editing switch.** Choose whether it may rewrite its memory by itself.
- **Your rules.** Free text that overrides everything.
- **Every memory.** See it, search it, edit it, change its importance, or delete it. **Pin** a memory and the Oracle can never change or delete it (memories you add are pinned automatically).
- **Change log.** See every change it made to its mind, and why.
- **Episodes.** See and delete conversation summaries.

The live voice gets the same memory, past conversations and settings. It can remember, revise, forget and recall mid-call.

## Tasks, automations and WhatsApp

Just ask, by voice or text, in English or Russian:
- *"Add a task: send the invoice by Friday."*
- *"Remind me tomorrow at 9 to call mum."*
- *"Every weekday at 8, send me a quote from Marcus Aurelius."*
- *"On Friday evening, ask me how the talk with my boss went."*
- *"Every Sunday at 7 pm, send me my open tasks."*

What it can schedule:
- **Reminders.** Your words, sent at the time you asked.
- **Quotes.** Only passages verified word for word from your own books. Picking one costs nothing, because no AI call is needed.
- **Follow-ups.** The Oracle writes these itself at the moment they're due, using what it knows about you.
- **Task digests.** A list of your open tasks.

Everything shows up in the **Tasks** tab. There you can tick tasks off, run or stop automations, and see everything it has sent you.

**Connect WhatsApp (free, about 3 minutes, via CallMeBot, personal use only):**
1. Save **+34 644 76 66 43** as a contact on your phone.
2. Send it this WhatsApp message: `I allow callmebot to send me messages`
3. It replies with your API key. If it doesn't within 2 minutes, try again after 24 hours.
4. In Render → oracle-third-eye → Environment, add:
   - `CALLMEBOT_APIKEY`: the key it sent you
   - `WHATSAPP_TO`: your number with country code, e.g. `+447700900123`
5. Click Save, then press **Send a test** in the Tasks tab.

**Optional: text the Oracle back on WhatsApp (Twilio).** CallMeBot can only send to you. To chat with the Oracle and give it commands from WhatsApp, also set up Twilio's WhatsApp sandbox:
1. Create a Twilio account. Go to Messaging → Try it out → Send a WhatsApp message, and join the sandbox from your phone.
2. Set "When a message comes in" to `https://oracle-third-eye.onrender.com/api/whatsapp/inbound` (method POST).
3. In Render, add these settings:
   - `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
   - `TWILIO_WHATSAPP_FROM`: the sandbox number
   - `WHATSAPP_TO`: your number

The webhook only accepts messages signed by Twilio and sent from your own number. If both services are set up, the Oracle's own messages go through CallMeBot and replies go through Twilio. This is because WhatsApp only lets business senders like Twilio message you freely within 24 hours of your last message. Twilio may also charge per message, so check twilio.com/pricing.

**Reminders on time.** Render's free plan sleeps after about 15 idle minutes. To keep it awake, the app asks your Supabase database (pg_cron + pg_net) to ping it every 10 minutes. One always-on service fits within the free plan's 750 instance-hours a month (Render's terms can change). `/healthz?details` shows `keepAwake`; set `KEEP_AWAKE=off` to disable it. If the server was asleep anyway, overdue one-off reminders are sent on wake-up, and recurring ones skip to their next time.

## English and Русский

The Oracle speaks English and Russian, and follows whichever one you use.
- **Typed chat and its voice** answer in the language you write in.
- **The live conversation** switches language when you do, even mid-call.
- **Memory notes and its next opening line** are written in your language.
- **Russian books** are studied with notes in Russian. Search understands Russian word endings, so "любовь" also finds "любовью".
- **Voice recognition** follows the last language you used. To lock it, go to Integrations → Language / Язык and pick English or Русский.
- **The home screen** appears in Russian when Russian is active.

## Live conversation (ElevenLabs Agents)

**Always listening.** Tap anywhere once and it opens a real-time, two-way voice line (WebRTC), then simply keeps listening. You never press a button to talk, and it doesn't hang up because you stopped talking.
- **It stays quiet with you.** It can stay silent during your pauses and won't ask "are you still there?".
- **It reconnects by itself.** If the line drops (network, or the 30-minute session cap), it reopens it automatically. If it can't, it listens through the browser meanwhile.
- **It rests to save credits.** After about 4 quiet minutes it closes the paid line, and your browser's own speech recognition keeps listening. When you speak, it reopens the line and answers what you said. (Browsers whose speech recognition can't do this keep the line open instead.)
- **Pause and resume.** Tap ◉ to pause and again to resume. Your choice is remembered.
- **Talk over it.** You can interrupt it mid-sentence, and the globe moves with both voices.

- **Voice:** `eleven_v4_turbo`, ElevenLabs' newest real-time model, using "Bill – Wise, Mature, Balanced".
- **Brain:** Claude Sonnet 5.5 at low reasoning effort, running inside the ElevenLabs agent. It's a fast model, chosen because a spoken reply has to start within about a second. You can switch it to Claude Opus 5.5 in the ElevenLabs dashboard (Agents → Oracle of the Third Eye → LLM) if you'd trade speed for depth.
- **It knows you:** your Soul profile and library list are passed in when each call starts. A `consult_library` tool lets it read passages from your library mid-conversation.
- **It remembers:** the transcript is saved to your history when the call ends, and the Oracle keeps learning from it, the same as typed chats.
- **The agent is already set up** in your ElevenLabs account as **Oracle of the Third Eye** (`agent_4301m4gaggbzf5et5ma61brmra58`). It's private, so only your server can start a call, and it's capped at 2 simultaneous calls and 100 a day to protect your credits. Change any of this in the ElevenLabs dashboard.
- **Needs:** `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` on the server. Without them it still listens continuously, using the browser's speech recognition, and answers with the regular voice.
- **Cost.** An open line uses ElevenLabs Agents minutes. ElevenLabs appears to bill quiet stretches at a discount, but I'm not certain of the current rates, so check elevenlabs.io/pricing. Resting after quiet minutes is there to keep this down.
- **Privacy.** Always listening means the mic is on while the page is open. In Chrome, browser speech recognition sends audio to Google's servers. Tap ◉ to pause whenever you like.

## Integrations

| Service | What it does here | Needs |
| --- | --- | --- |
| **Claude** | The mind: reasoning, persona, memory of who you are | `ANTHROPIC_API_KEY` |
| **Claude web search** | Automatic. The Oracle searches only when it needs current facts, and links what it found | same key |
| **Supabase** | Cloud memory, so your library, soul profile and history are the same on your phone and laptop. Tables are created automatically | `DATABASE_URL` |
| **ElevenLabs Agents** | Live real-time conversation (see above) | `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` |
| **ElevenLabs** | Lifelike voice that shifts with mood. Scribe speech-to-text for browsers without built-in recognition (Firefox) | `ELEVENLABS_API_KEY` |
| **Hugging Face** | `all-MiniLM-L6-v2` sentence embeddings, run **locally** via transformers.js, so passages are found by meaning, not just keywords | nothing (≈23 MB model download on first run) |
| **Project Gutenberg** | **Discover** tab: 16 hand-picked wisdom classics, plus search across 70,000+ free public-domain books. One click to absorb | nothing |
| **Blogs · Reddit · GitHub** | Paste any link into the Library | nothing |

Each service's live status is shown on the **Integrations** tab.

## What it does

- **Speaks from your library.** Each message pulls the most relevant passages from everything you've uploaded, and the Oracle answers from those first, naming the work it draws on. The books it used show up as chips under the answer.
- **Doesn't invent quotes.** It may only put text in quotation marks when that text appears word for word in your library. Everything else it labels as paraphrase or "in the spirit of".
- **Feels present, not robotic.** Short, spoken-style replies with no bullet points. It asks questions back and starts every answer with a *mood* (serene, compassionate, fierce, awed…), which changes the being's colours and the ElevenLabs voice settings.
- **Shows its thinking.** While it reasons, short summaries of its thoughts drift above the orb, the sacred rings speed up, and the third eye narrows.
- **Knows you.** You fill in a *Soul* profile, and after every exchange it quietly adds insights and personality traits. You can view them and delete any of them in the Soul panel.
- **Talks out loud.** Speak through the mic button (browser speech recognition). The Oracle answers sentence by sentence through ElevenLabs, or through the browser's built-in voice if ElevenLabs isn't set up. Hands-free mode makes it start listening again after it finishes speaking.
- **No modes, no menus.** You just talk. The Oracle works out for itself whether you need comfort, a hard truth, help with a decision, a teaching for the day, a reading of your life's patterns, or several authors weighing in. It also picks which tradition (Stoic, mystic, strategic, psychological…) fits you and the moment.

## Feeding the library

| Source | How |
| --- | --- |
| Books | Drop **PDF, EPUB, TXT, MD, HTML** files into the Library panel (up to 80 MB each, 50 at a time) |
| Blogs / articles | Paste the URL. It extracts the `<article>` text |
| GitHub | Paste a repo URL. It reads the README |
| Reddit | Paste a thread URL. It reads the post and the upvoted comments through Reddit's public JSON. **Reddit often blocks unauthenticated requests (it returned 403 in testing).** If that happens, paste the text instead |
| Anything else | Use *Paste a passage or note* |

Without `DATABASE_URL`, everything is stored in `./data/` on your machine. With it, everything is stored in your own Supabase database. Either way, the only things sent elsewhere are passages and messages to Claude, and spoken sentences to ElevenLabs.

## Put it in the cloud and use it on your phone (≈10 minutes, no coding)

You'll create two free accounts: **Supabase** (memory) and **Render** (the server). Both have free tiers. I can't create the accounts for you, but everything else is already configured.

**1. Supabase: the Oracle's memory**
1. Go to [supabase.com](https://supabase.com), sign in with GitHub, and click **New project**. Pick a name, a database password (save it), and the region closest to you.
2. When it's ready, click **Connect** (top bar) and copy the **Session pooler** connection string. It looks like
   `postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` with your password. Use the *Session pooler* string, not "Direct connection", which many hosts can't reach.
3. That's all. The Oracle creates its own tables (`oracle_*`) on first start and locks them with row-level security.

**2. Render: the server**
1. Click **[Deploy to Render](https://render.com/deploy?repo=https://github.com/4kuall/4kuall)** and sign in with GitHub. If the repo is private, allow Render to access it.
2. Render reads `render.yaml` and asks for:
   - `ANTHROPIC_API_KEY`: from [console.anthropic.com](https://console.anthropic.com)
   - `DATABASE_URL`: the Supabase string from step 1
   - `ACCESS_TOKEN`: a passcode you choose. You'll type it once on each device
   - `ELEVENLABS_API_KEY`: optional, for the lifelike voice
3. Click **Apply**. After a few minutes you get a URL like `https://oracle-third-eye.onrender.com`.

**3. Your phone**
1. Open that URL and enter your passcode.
2. **iPhone:** Safari → Share → **Add to Home Screen**. **Android:** Chrome → ⋮ → **Install app**.
   It opens full-screen like a real app, with the mic working (it needs the HTTPS that Render provides).

> Render's free plan sleeps after about 15 minutes idle, so the first visit after a break can take up to a minute to wake. Their paid "Starter" plan stays awake. (Prices and limits change, so check render.com for current terms.) Your data is safe either way, because it lives in Supabase.

## Run it on your Windows laptop

1. Download the project: on GitHub, **Code → Download ZIP**, then unzip it.
2. Double-click **`Start-Oracle.bat`**.
   It installs Node.js if you don't have it (via winget, so you may see a Windows prompt), installs everything, asks for your keys once, and opens the Oracle in your browser.
3. To share memory with your phone, paste the same Supabase `DATABASE_URL` when it asks. Your laptop and the cloud then run the same Oracle.

On a Mac or Linux: `cp .env.example .env`, add your keys, then `npm install && npm start` (Node 20+).

### Configuration

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required. The Oracle's mind |
| `ORACLE_MODEL` | Defaults to `claude-haiku-5-5` (fast and inexpensive). Set `claude-opus-5-5` for deeper but costlier answers |
| `ORACLE_EFFORT` | `low` / `medium` (default) / `high`. Higher is slower and deeper |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Optional realistic voice. Pick or design a deep, warm voice in ElevenLabs. Settings also lists your voices |
| `DATABASE_URL` | Supabase (or any Postgres) connection string. Without it, data stays in `./data` on this machine |
| `ACCESS_TOKEN` | The passcode. Required in the cloud (`REQUIRE_ACCESS_TOKEN=true` keeps the API locked until it's set) |
| `WEB_SEARCH` | Set to `off` to stop the Oracle from searching the web |
| `SEMANTIC_SEARCH` | `on` / `off`. By default it turns itself on only when the server has about 900 MB of memory or more, and stays off on Render's free plan (512 MB). When it's off, keyword search plus each book's study notes find passages |

## Honest limits

- It is an AI. The prompt makes it sound like a wise elder, but it is told never to deny being an AI when someone sincerely asks.
- Its wisdom is only as good as what you feed it, plus Claude's general knowledge. Treat it as a mirror and a counsellor, not an authority. For medical, legal or financial decisions it will point you to a qualified person. If you mention self-harm, it drops the mystique and points you to real help (in the US, call or text 988).
- Semantic search is a small, fast model. It's good at finding passages with similar meaning, but it isn't deep understanding. Claude does the real reading of whatever passages search brings back.
- Only upload books you own, and keep the server private. It's built as a personal library, not a public one.

## Ideas for going further

- A photoreal talking face (a streaming avatar service, or a Ready Player Me / VRM head with lip-sync driven by the same audio analyser)
- A citation view that jumps to the exact page
- A daily morning teaching pushed to your phone
- Journaling mode, where the Oracle reflects your recurring patterns back to you once a week
