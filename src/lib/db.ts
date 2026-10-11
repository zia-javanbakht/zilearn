import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function dataDir(): string {
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.ZILEARN_DATA_DIR || path.join(process.cwd(), "data"));
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  return dir;
}

export function newId(): string {
  return crypto.randomUUID();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  exam_date TEXT,
  target_level INTEGER NOT NULL DEFAULT 3,
  hours_per_day REAL NOT NULL DEFAULT 2,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  filename TEXT,
  mime TEXT,
  path TEXT,
  url TEXT,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '[]',
  material_ids TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL DEFAULT 2,
  position INTEGER NOT NULL DEFAULT 0,
  mastery TEXT,
  achieved_depth INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  target_level INTEGER NOT NULL,
  iterations INTEGER NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  date TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'study',
  topic_id TEXT,
  topic_title TEXT NOT NULL,
  depth INTEGER NOT NULL,
  minutes INTEGER NOT NULL,
  activities TEXT NOT NULL DEFAULT '[]',
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lessons (
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  depth INTEGER NOT NULL,
  content TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (topic_id, depth)
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  from_topic TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  to_topic TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  relation TEXT
);

CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  questions TEXT NOT NULL,
  answers TEXT,
  grades TEXT,
  generated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS podcasts (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  hosts TEXT NOT NULL,
  segments TEXT NOT NULL,
  audio TEXT,
  audio_marks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'generated',
  ease REAL NOT NULL DEFAULT 2.5,
  interval INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due TEXT,
  last_review TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content, material_id UNINDEXED, course_id UNINDEXED, chunk_index UNINDEXED,
  tokenize = 'porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS topics_fts USING fts5(
  title, summary, keywords, topic_id UNINDEXED, course_id UNINDEXED,
  tokenize = 'porter unicode61'
);

CREATE INDEX IF NOT EXISTS idx_materials_course ON materials(course_id);

CREATE INDEX IF NOT EXISTS idx_topics_course ON topics(course_id);
CREATE INDEX IF NOT EXISTS idx_plan_items_plan ON plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_topic);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_topic);
CREATE INDEX IF NOT EXISTS idx_cards_course_due ON cards(course_id, due);
`;

/** Columns added after the first release; CREATE TABLE IF NOT EXISTS doesn't add them to old databases. */
const COLUMNS: [table: string, column: string, type: string][] = [
  ["podcasts", "audio", "TEXT"], // path of the recorded MP3, relative to the data dir
  ["podcasts", "audio_marks", "TEXT"], // JSON: start time in seconds of each segment in the MP3
  ["materials", "sha256", "TEXT"], // content hash, so re-importing a folder skips files already added
  ["materials", "rel_path", "TEXT"], // where the file sat in an imported folder or zip
  ["topics", "manual", "INTEGER NOT NULL DEFAULT 0"], // added or edited by the student: kept when the brainmap is rebuilt
  ["courses", "removed_topics", "TEXT"],
  ["materials", "digest", "TEXT"], // JSON Digest: summary, key terms and topics of the material // JSON: normalised titles the student deleted, left out of rebuilds
];

function migrate(db: Database.Database) {
  for (const [table, column, type] of COLUMNS) {
    const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
    if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_materials_sha ON materials(course_id, sha256)");
}

let instance: Database.Database | null = null;

export function openDb(file?: string): Database.Database {
  const db = new Database(file ?? path.join(dataDir(), "zilearn.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function db(): Database.Database {
  // Reuse one connection across hot reloads in dev.
  const g = globalThis as unknown as { __zilearnDb?: Database.Database };
  if (!instance) instance = g.__zilearnDb ?? openDb();
  g.__zilearnDb = instance;
  return instance;
}

/** For tests: swap the shared connection (e.g. for an in-memory database). */
export function setDb(d: Database.Database) {
  instance = d;
  (globalThis as unknown as { __zilearnDb?: Database.Database }).__zilearnDb = d;
}
