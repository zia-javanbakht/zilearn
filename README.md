# ziLearn

A study suite for university students and academics. Each course collects all of its material in one place, ziLearn maps it into a brainmap, you mark what you already know, and it builds a **progressive study plan** that takes every topic deeper on each pass until you reach the level the exam needs.

## Features

- **Courses** with an exam date, a required level and daily study hours.
- **Drag-and-drop ingestion**: PDF (scanned PDFs are transcribed by Claude), PowerPoint (slides and speaker notes), Word, Markdown/text, images of handwritten notes, audio memos and lecture recordings (transcribed on your device, see below), YouTube links (title and captions when available), web links, and pasted notes. Each item is tagged as lecture notes, slides, sample exam, workshop, tutorial, reading, etc.
- **Brainmap** rendered with Mermaid: a colour-coded map you can click, a mindmap overview, and an outline. Claude organises the material by concept across all sources; offline, topics come from headings.
- **Know / Familiar / Don't know** marks on any branch or topic. Marking a branch applies to everything under it; children can be overridden.
- **Progressive study plan**: the course is covered in passes (Survey → Understand → Apply → Master). Unknown topics start at pass 1, familiar ones at pass 2, and "known" topics get a quick check first. Later passes interleave branches; each branch opens with an overview and closes with a synthesis; every pass ends with a checkpoint quiz; short recall warm-ups bring back topics from 1, 3 and 7 days earlier; and the last day before the exam is a mock exam plus weak-topic review. Ticking sessions off records the depth reached, so rebuilding from today never repeats finished work, and topics you later mark "Don't know" are repeated at the right depth.
- **Calendar export**: download the plan as an `.ics` file or subscribe to it (one event per session or per day, your chosen start time and reminder, plus the exam day).
- **Flashcards** with spaced repetition (Again / Hard / Good / Easy, SM-2 style). Cards are generated for any scope, written by you, or made from the questions you got wrong in a mock exam. Intervals are squeezed so every card comes back before the exam.
- **Knowledge base** across all courses: full-text search over topics and every material (SQLite FTS5), and cross-course links between similar topics (TF-IDF similarity, verified and explained by Claude when available). Related topics also show next to each topic in the brainmap.
- **Mock exams** weighted towards weak topics and styled on your sample exams; multiple choice is auto-marked, written answers are marked by Claude (or self-marked offline). Results can update your brainmap marks.
- **Review notes** (concise, detailed or cheat sheet) for the whole course, one branch, or only weak topics, with LaTeX maths and Mermaid diagrams. Download as Markdown or print to PDF.
- **Podcasts**: a two-host conversational episode about any scope. Listen straight away with your device's voices, or record an **MP3** with natural neural voices (one per host) to download; the transcript follows along as it plays.

### On-device speech

Transcription and MP3 recording run in your browser, so recordings and scripts never leave your computer and no extra API key is needed:

- **Transcription** uses OpenAI's open Whisper model through [transformers.js](https://github.com/huggingface/transformers.js) (tiny, base or small; WebGPU when available, otherwise WebAssembly). New recordings, including ones made with "Record a voice memo", are transcribed automatically with `[mm:ss]` markers; with an API key, Claude then organises the transcript into notes.
- **Podcast audio** uses [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) through kokoro-js, encoded to MP3 with lamejs.

The models (about 40-250 MB for Whisper, 90 MB for Kokoro) download from Hugging Face the first time and are cached by the browser. The runtimes load from the jsDelivr CDN inside web workers (`public/whisper-worker.js`, `public/tts-worker.js`).

## Running it

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY (Claude) or GEMINI_API_KEY (Gemini)
npm run dev                  # http://localhost:3000
```

Data (SQLite database and uploaded files) lives in `./data` unless `ZILEARN_DATA_DIR` is set.

Without an API key everything still works with built-in heuristics (heading-based brainmaps, template lessons, summary-based exams, notes and podcasts); the header shows "Offline mode". With a key, the AI does the structuring, lessons, exams, marking, notes, flashcards and podcast scripts. Two providers are supported:

- **Claude**: set `ANTHROPIC_API_KEY`. Uses `claude-opus-5-5` by default; override with `ZILEARN_MODEL`.
- **Gemini**: set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Uses `gemini-flash-latest` by default; override with `GEMINI_MODEL` (for example a Pro model).

If both keys are set, Claude is used unless `ZILEARN_PROVIDER=gemini`. The header shows which provider is connected.

## Development

```bash
npm test          # vitest: planner, brainmap, search, links, flashcards, transcripts, calendar, offline generators
npm run typecheck
npm run build
```

Layout:

- `src/lib/plan.ts` progressive planning algorithm
- `src/lib/brainmap.ts` structuring and Mermaid output
- `src/lib/kb.ts` search and cross-course links
- `src/lib/generate.ts` lessons, mock exams and grading, review notes, podcasts, flashcards
- `src/lib/srs.ts` spaced-repetition scheduling; `src/lib/ics.ts` calendar export; `src/lib/transcript.ts` transcript formatting
- `src/lib/ai.ts` Claude calls (streaming, prompt caching of course sources, cancellation)
- `src/lib/extract.ts`, `src/lib/youtube.ts` ingestion
- `src/lib/store.ts`, `src/lib/db.ts` SQLite storage
- `src/app/api/**` route handlers, `src/components/**` UI

## Known limits

- YouTube transcripts depend on the video having captions.
- On-device transcription of long lectures is slow without a GPU; the "tiny" model is the fastest. MP3 voices are English only.
- Subscribing to the calendar feed from Google Calendar needs ziLearn to be reachable from the internet; on your own computer, download the `.ics` instead.
