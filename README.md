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

## Live conversation (ElevenLabs Agents)

Tap **● Go live** and just talk. It's a real-time, two-way voice conversation over WebRTC, like a phone call. You can interrupt it mid-sentence, and the orb moves with both voices.

- **Voice:** `eleven_v4_turbo`, ElevenLabs' newest real-time model, using "Bill – Wise, Mature, Balanced".
- **Brain:** Claude Sonnet 5.5 at low reasoning effort, running inside the ElevenLabs agent. It's a fast model, chosen because a spoken reply has to start within about a second. You can switch it to Claude Opus 5.5 in the ElevenLabs dashboard (Agents → Oracle of the Third Eye → LLM) if you'd trade speed for depth.
- **It knows you:** your Soul profile and library list are passed in when each call starts. A `consult_library` tool lets it read passages from your library mid-conversation.
- **It remembers:** the transcript is saved to your history when the call ends, and the Oracle keeps learning from it, the same as typed chats.
- **The agent is already set up** in your ElevenLabs account as **Oracle of the Third Eye** (`agent_4301m4gaggbzf5et5ma61brmra58`). It's private, so only your server can start a call, and it's capped at 2 simultaneous calls and 100 a day to protect your credits. Change any of this in the ElevenLabs dashboard.
- **Needs:** `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` on the server. Without them, the mic button falls back to the older speak-then-wait mode.

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
| `ORACLE_MODEL` | Defaults to `claude-opus-5-5` |
| `ORACLE_EFFORT` | `low` / `medium` (default) / `high`. Higher is slower and deeper |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Optional realistic voice. Pick or design a deep, warm voice in ElevenLabs. Settings also lists your voices |
| `DATABASE_URL` | Supabase (or any Postgres) connection string. Without it, data stays in `./data` on this machine |
| `ACCESS_TOKEN` | The passcode. Required in the cloud (`REQUIRE_ACCESS_TOKEN=true` keeps the API locked until it's set) |
| `WEB_SEARCH` | Set to `off` to stop the Oracle from searching the web |
| `SEMANTIC_SEARCH` | Set to `off` on very small servers. The model uses about 300 MB of RAM |

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
