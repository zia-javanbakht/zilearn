# ziLearn

A study suite for university students and academics. Each course collects all of its material in one place, ziLearn maps it into a brainmap, you mark what you already know, and it builds a **progressive study plan** that takes every topic deeper on each pass until you reach the level the exam needs.

## Features

- **Courses** with an exam date, a required level and daily study hours.
- **Drag-and-drop ingestion**: PDF (scanned PDFs are transcribed by the AI), PowerPoint (slides and speaker notes), Word, Markdown/text, images of handwritten notes, audio memos, lecture videos (transcribed on your device, see below), YouTube links, web links, and pasted notes. Each item is tagged as lecture notes, slides, video, sample exam, workshop, tutorial, reading, etc.
- **Whole folders and .zip archives**: drop or choose a folder and ziLearn goes through every subfolder. Folder names like "Tutorials" or "Past exams" set the item type, system clutter (.DS_Store, .git, __MACOSX) is left out, and files already in the course are skipped, so importing the same folder again only adds what is new. A report lists anything skipped and why.
- **Transcripts for videos**: a .srt or .vtt captions file next to a video becomes its transcript; otherwise the recording is transcribed in the browser. YouTube links (pasted, dragged, or saved as .url/.webloc shortcuts in a folder) import the video's captions; when a video has none and Gemini is the provider, Gemini watches it and writes the transcript. "Try again" re-fetches later. A "Clean up" button (or a transcription setting) removes the [mm:ss] timestamps.
- **Summaries of each item**: every material gets a summary, key terms and its topics with where each starts in the recording; click a timestamp to play from there, or view the topics as a mindmap. Recordings and YouTube videos are summarised by the AI when a key is set (other items on request); offline, topics come from headings or, for transcripts, from the phrases that set each stretch apart. "Add to brainmap" adds an item's topics as a new branch without rebuilding, and rebuilds use the summaries too.
- **Formulas** render with KaTeX everywhere text is shown: lessons, notes, exams, flashcards, summaries, topics, and a Preview of any material's text.
- **Brainmap** rendered with Mermaid: a colour-coded map you can click, a mindmap overview, and an outline. The AI organises the material by concept across all sources; offline, topics come from headings. You can fix the map: delete a wrongly detected branch (or just one level), add topics and subtopics, rename or move them. Rebuilding keeps your changes.
- **Structured lessons** for every topic at each of the four levels, built from the brainmap and your own materials: learning objectives, where the topic fits (a map of its parent, what it builds on, what comes next, its subtopics and related topics in other courses), a warm-up, then sections of categorised blocks (definitions, key points, intuitions, examples with worked solutions, formulas, procedures, pitfalls, comparisons), a glossary, common mistakes, connections, check-yourself questions with hints and answers, takeaways, and what to go back to. Each block cites the material it came from, with timestamps for recordings.
- **Plots and diagrams in lessons**: function plots (drawn from safe expressions such as `exp(-0.1*x)*cos(x)`) and flow diagrams, shown in the app and drawn with pgfplots and TikZ in the Z export.
- **Checked maths**: every formula is rendered with KaTeX before a lesson is saved; anything that fails goes back to the AI once to fix, and what still fails is shown as code, so lessons never break in the app or in XeLaTeX.
- **Lessons without an AI key** teach from your materials: definitions, formulas with their lead-in, comparison tables, analogies, your lecturer's warnings (with timestamps) and your tutorial questions.
- **Lesson reader**: full-height view with a contents list, reading progress, keys 1 to 4 to switch level, an Export menu (PDF, LaTeX, Markdown), and "finished, next level" at the end.
- **Printable lessons, notes and summaries with the Z LaTeX class**: every Export menu offers "LaTeX (.tex)", a Z document (Z's definition, key point, intuition and example environments and its coloured boxes, plus a TikZ concept map for lessons), and "PDF (LaTeX)", which compiles it on your computer with XeLaTeX (or LuaLaTeX, Tectonic or pdfLaTeX, whichever is installed). ziLearn finds Z in your TeX tree, in the folder set under Settings > PDF export, in `Z_TEX_DIR`, or in a `z/tex/latex` folder in your home folder or next to the app. Without Z it compiles with a built-in stand-in that has the same boxes, and if the Z build fails it falls back to the stand-in, so there is a PDF whenever TeX is installed. Without TeX, "Print from browser" prints what you see (Save as PDF). Settings > PDF export shows what was found and makes a test PDF. Lessons made before structured lessons print as they are; press Regenerate to get the structured version.
- **Know / Familiar / Don't know** marks on any branch or topic. Marking a branch applies to everything under it; children can be overridden.
- **Progressive study plan**: the course is covered in passes (Survey → Understand → Apply → Master). Unknown topics start at pass 1, familiar ones at pass 2, and "known" topics get a quick check first. Later passes interleave branches; each branch opens with an overview and closes with a synthesis; every pass ends with a checkpoint quiz; short recall warm-ups bring back topics from 1, 3 and 7 days earlier; and the last day before the exam is a mock exam plus weak-topic review. Ticking sessions off records the depth reached, so rebuilding from today never repeats finished work, and topics you later mark "Don't know" are repeated at the right depth.
- **Calendar export**: download the plan as an `.ics` file or subscribe to it (one event per session or per day, your chosen start time and reminder, plus the exam day).
- **Flashcards** with spaced repetition (Again / Hard / Good / Easy, SM-2 style). Cards are generated for any scope, written by you, or made from the questions you got wrong in a mock exam. Intervals are squeezed so every card comes back before the exam.
- **Knowledge base** across all courses: full-text search over topics and every material (SQLite FTS5), and cross-course links between similar topics (TF-IDF similarity, verified and explained by Claude when available). Related topics also show next to each topic in the brainmap.
- **Mock exams** weighted towards weak topics and styled on your sample exams; multiple choice is auto-marked, written answers are marked by Claude (or self-marked offline). Results can update your brainmap marks.
- **Review notes** (concise, detailed or cheat sheet) for the whole course, one branch, or only weak topics, with LaTeX maths and Mermaid diagrams. Export as PDF (compiled with the Z class), LaTeX or Markdown; cheat sheets are set in two columns. Material summaries export the same way.
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

Without an API key everything still works with built-in heuristics (heading-based brainmaps, template lessons, summary-based exams, notes and podcasts); the header shows "Offline mode". With a key, the AI does the structuring, lessons, exams, marking, notes, flashcards and podcast scripts.

Pick the AI on the **Settings** page (link in the header, or click the provider badge). Keys, models and the choice are saved in the database and apply at once:

- **Built-in**: offline, free and private. AI is off even if keys are set.
- **Automatic** (the default): keys from the environment decide, as below. Keys saved in Settings count too.
- **Anthropic Claude**: uses `claude-opus-5-5` unless you name another model.
- **Google Gemini**: uses `gemini-flash-latest` unless you name another model. Also transcribes YouTube videos that have no captions.
- **OpenAI-compatible**: OpenAI, OpenRouter, Ollama, LM Studio or any server with the OpenAI chat completions API. Set the base URL (for example `http://localhost:11434/v1` for Ollama); local servers need no key.

"Test connection" makes one tiny call with what is in the form, before you save. A key saved in Settings is used instead of the environment's key for that provider; keys are never sent back to the browser in full.

The environment still works when nothing is saved:

- **Claude**: set `ANTHROPIC_API_KEY`. Uses `claude-opus-5-5` by default; override with `ZILEARN_MODEL`.
- **Gemini**: set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Uses `gemini-flash-latest` by default; override with `GEMINI_MODEL` (for example a Pro model).
- **OpenAI-compatible**: set `OPENAI_API_KEY` (and optionally `OPENAI_BASE_URL`, `OPENAI_MODEL`) together with `ZILEARN_PROVIDER=openai`.

If several keys are set, Automatic uses Claude unless `ZILEARN_PROVIDER` is `gemini` or `openai`. The header shows which provider is connected.

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
- `src/lib/lesson.ts` structured lessons; `src/lib/lessonCheck.ts` maths and figure checks; `src/lib/lessonOffline.ts` lessons without AI; `src/lib/figure.ts` and `src/lib/expr.ts` plots and diagrams; `src/lib/latex.ts` LaTeX export with the Z class
- `src/lib/generate.ts` mock exams and grading, review notes, podcasts, flashcards
- `src/lib/srs.ts` spaced-repetition scheduling; `src/lib/ics.ts` calendar export; `src/lib/transcript.ts` transcript formatting
- `src/lib/ai.ts` Claude calls (streaming, prompt caching of course sources, cancellation)
- `src/lib/extract.ts`, `src/lib/youtube.ts` ingestion
- `src/lib/store.ts`, `src/lib/db.ts` SQLite storage
- `src/app/api/**` route handlers, `src/components/**` UI

## Known limits

- YouTube transcripts depend on the video having captions (or on Gemini being the provider). Videos over 1 GB and other files over 150 MB are skipped.
- On-device transcription of long lectures is slow without a GPU; the "tiny" model is the fastest. MP3 voices are English only.
- Subscribing to the calendar feed from Google Calendar needs ziLearn to be reachable from the internet; on your own computer, download the `.ics` instead.
