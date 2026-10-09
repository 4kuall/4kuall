# ◉ Oracle of the Third Eye

A private wisdom companion that speaks to you in the combined voice of the authors you feed it. You upload your books, blogs, Reddit threads and notes. It listens to you by voice and answers in a warm, human cadence, grounded in your library. It learns your personality as you talk, and it appears as a living 3D being with a third eye that breathes, blinks, follows your cursor, thinks and speaks.

```
 you ──voice/text──▶  ┌────────────── server (Node) ──────────────┐
                      │  Library ─ BM25 retrieval over your books   │
                      │  Soul    ─ profile + learned insights       │──▶ Claude (mind)
                      │  Memory  ─ conversation history             │──▶ ElevenLabs (voice)
                      └─────────────────────────────────────────────┘
 3D Oracle (Three.js) ◀── streamed words · mood · inner reflections · audio amplitude
```

## What it does

- **Speaks from your library.** Each message pulls the most relevant passages from everything you've uploaded, and the Oracle answers from those first, naming the work it draws on. The books it used show up as chips under the answer.
- **Doesn't invent quotes.** It may only put text in quotation marks when that text appears word for word in your library. Everything else it labels as paraphrase or "in the spirit of".
- **Feels present, not robotic.** Short, spoken-style replies with no bullet points. It asks questions back and starts every answer with a *mood* (serene, compassionate, fierce, awed…), which changes the being's colours and the ElevenLabs voice settings.
- **Shows its thinking.** While it reasons, short summaries of its thoughts drift above the orb, the sacred rings speed up, and the third eye narrows.
- **Knows you.** You fill in a *Soul* profile, and after every exchange it quietly adds insights and personality traits. You can view them and delete any of them in the Soul panel.
- **Talks out loud.** Speak through the mic button (browser speech recognition). The Oracle answers sentence by sentence through ElevenLabs, or through the browser's built-in voice if ElevenLabs isn't set up. Hands-free mode makes it start listening again after it finishes speaking.
- **Six lenses:** Oracle, Stoic, Mystic, Strategist, Healer, Trickster.
- **One-tap rituals:** *Third-eye vision* (what it sees in your life), *Today's teaching*, *Help me decide*.

## Feeding the library

| Source | How |
| --- | --- |
| Books | Drop **PDF, EPUB, TXT, MD, HTML** files into the Library panel (up to 80 MB each, 50 at a time) |
| Blogs / articles | Paste the URL. It extracts the `<article>` text |
| GitHub | Paste a repo URL. It reads the README |
| Reddit | Paste a thread URL. It reads the post and the upvoted comments through Reddit's public JSON. **Reddit often blocks unauthenticated requests (it returned 403 in testing).** If that happens, paste the text instead |
| Anything else | Use *Paste a passage or note* |

Everything is stored locally in `./data/` (library, profile, history). Nothing leaves your machine except the passages and messages sent to Claude, and the sentences sent to ElevenLabs.

## Run it

Requires Node 20+.

```bash
cp .env.example .env      # add ANTHROPIC_API_KEY (and optionally ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID)
npm install
npm start                 # → http://localhost:3333
```

Open it in Chrome or Edge for voice input. Safari also works. Firefox has no speech recognition, so you type instead.

### Configuration

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Required. The Oracle's mind |
| `ORACLE_MODEL` | Defaults to `claude-opus-5-5` |
| `ORACLE_EFFORT` | `low` / `medium` (default) / `high`. Higher is slower and deeper |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Optional realistic voice. Pick or design a deep, warm voice in ElevenLabs. Settings also lists your voices |
| `ACCESS_TOKEN` | Set this before hosting publicly. Enter the same value in ⚙ Settings |

## Honest limits

- It is an AI. The prompt makes it sound like a wise elder, but it is told never to deny being an AI when someone sincerely asks.
- Its wisdom is only as good as what you feed it, plus Claude's general knowledge. Treat it as a mirror and a counsellor, not an authority. For medical, legal or financial decisions it will point you to a qualified person. If you mention self-harm, it drops the mystique and points you to real help (in the US, call or text 988).
- Retrieval is keyword-based (BM25). It's fast and has no extra dependencies, but it can miss passages that mean the same thing in different words. Semantic search with embeddings would fix that and is the natural next upgrade.
- Only upload books you own, and keep the server private. It's built as a personal library, not a public one.

## Ideas for going further

- A photoreal talking face (a streaming avatar service, or a Ready Player Me / VRM head with lip-sync driven by the same audio analyser)
- Embedding-based semantic search, and a citation view that jumps to the exact page
- A daily morning teaching pushed to your phone
- Journaling mode, where the Oracle reflects your recurring patterns back to you once a week
