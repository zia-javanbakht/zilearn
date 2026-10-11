# ziLearn

A study suite for university students and academics. Each course collects all of its material in one place, ziLearn maps it into a brainmap, you mark what you already know, and it builds a **progressive study plan** that takes every topic deeper on each pass until you reach the level the exam needs.

## Features

- **Courses** with an exam date, a required level and daily study hours.
- **Drag-and-drop ingestion**: PDF (scanned PDFs are transcribed by Claude), PowerPoint (slides and speaker notes), Word, Markdown/text, images of handwritten notes, audio memos (playable; add a transcript), YouTube links (title and captions when available), web links, and pasted notes. Each item is tagged as lecture notes, slides, sample exam, workshop, tutorial, reading, etc.
- **Brainmap** rendered with Mermaid: a colour-coded map you can click, a mindmap overview, and an outline. Claude organises the material by concept across all sources; offline, topics come from headings.
- **Know / Familiar / Don't know** marks on any branch or topic. Marking a branch applies to everything under it; children can be overridden.
- **Progressive study plan**: the course is covered in passes (Survey → Understand → Apply → Master). Unknown topics start at pass 1, familiar ones at pass 2, known ones get one check at the target level. Sessions are scheduled day by day before the exam, each with concrete activities, a lesson for that depth, and a checkpoint at the end of every pass. Ticking sessions off records the depth reached, so rebuilding never repeats finished work.
- **Knowledge base** across all courses: full-text search over topics and every material (SQLite FTS5), and cross-course links between similar topics (TF-IDF similarity, verified and explained by Claude when available). Related topics also show next to each topic in the brainmap.
- **Mock exams** weighted towards weak topics and styled on your sample exams; multiple choice is auto-marked, written answers are marked by Claude (or self-marked offline). Results can update your brainmap marks.
- **Review notes** (concise, detailed or cheat sheet) for the whole course, one branch, or only weak topics, with LaTeX maths and Mermaid diagrams. Download as Markdown or print to PDF.
- **Podcasts**: a two-host conversational episode about any scope, played with your device's voices, with a downloadable script.

## Running it

Requires Node.js 20+.

```bash
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY to enable Claude
npm run dev                  # http://localhost:3000
```

Data (SQLite database and uploaded files) lives in `./data` unless `ZILEARN_DATA_DIR` is set.

Without an API key everything still works with built-in heuristics (heading-based brainmaps, template lessons, summary-based exams, notes and podcasts); the header shows "Offline mode". With a key, Claude (`claude-opus-5-5` by default, override with `ZILEARN_MODEL`) does the structuring, lessons, exams, marking, notes and podcast scripts.

## Development

```bash
npm test          # vitest: planner, brainmap, search, links, offline generators
npm run typecheck
npm run build
```

Layout:

- `src/lib/plan.ts` progressive planning algorithm
- `src/lib/brainmap.ts` structuring and Mermaid output
- `src/lib/kb.ts` search and cross-course links
- `src/lib/generate.ts` lessons, mock exams and grading, review notes, podcasts
- `src/lib/extract.ts`, `src/lib/youtube.ts` ingestion
- `src/lib/store.ts`, `src/lib/db.ts` SQLite storage
- `src/app/api/**` route handlers, `src/components/**` UI

## Known limits

- Audio memos aren't transcribed automatically yet (Claude doesn't take audio input); paste a transcript under the item.
- YouTube transcripts depend on the video having captions.
- Podcasts use the browser's speech synthesis, so there's no MP3 export yet.
