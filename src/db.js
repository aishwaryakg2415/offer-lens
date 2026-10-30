// SQLite storage (Node's built-in node:sqlite). Assessments keep only a hash of
// the message, never the text itself. Reports keep the identifiers people flag
// (email, domain, phone) so later checks can warn about repeat offenders.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(file = process.env.DB_PATH || "data/offer-lens.db"){
  if (file !== ":memory:") mkdirSync(dirname(file), {recursive: true});
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      text_hash TEXT NOT NULL,
      score INTEGER NOT NULL,
      rules_score INTEGER NOT NULL,
      ai_score INTEGER,
      band TEXT NOT NULL,
      categories TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      kind TEXT NOT NULL CHECK (kind IN ('email','domain','phone')),
      value TEXT NOT NULL,
      reporter TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reports_value ON reports(kind, value);
    CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports(kind, value, reporter);
  `);

  const insAssessment = db.prepare(`INSERT INTO assessments (text_hash, score, rules_score, ai_score, band, categories) VALUES (?, ?, ?, ?, ?, ?)`);
  const insReport = db.prepare(`INSERT OR IGNORE INTO reports (kind, value, reporter) VALUES (?, ?, ?)`);
  const countReports = db.prepare(`SELECT COUNT(*) AS n FROM reports WHERE kind = ? AND value = ?`);

  return {
    raw: db,
    hash: s => createHash("sha256").update(s).digest("hex"),

    saveAssessment({text, score, rulesScore, aiScore, band, categories}){
      const r = insAssessment.run(this.hash(text), score, rulesScore, aiScore ?? null, band, JSON.stringify(categories));
      return Number(r.lastInsertRowid);
    },

    // reporter is a salted hash of the client IP, so one person counts once per identifier.
    addReports(items, reporter){
      let added = 0;
      for (const {kind, value} of items) added += Number(insReport.run(kind, value, reporter).changes);
      return added;
    },

    lookupReports(items){
      return items.map(({kind, value}) => ({kind, value, count: Number(countReports.get(kind, value).n)})).filter(r => r.count > 0);
    },

    stats(){
      const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM assessments`).get().n);
      const byBand = Object.fromEntries(db.prepare(`SELECT band, COUNT(*) AS n FROM assessments GROUP BY band`).all().map(r => [r.band, Number(r.n)]));
      const topReported = db.prepare(`SELECT kind, value, COUNT(*) AS reports FROM reports WHERE kind = 'domain' GROUP BY kind, value ORDER BY reports DESC LIMIT 10`).all()
        .map(r => ({...r, reports: Number(r.reports)}));
      const reports = Number(db.prepare(`SELECT COUNT(*) AS n FROM reports`).get().n);
      return {assessments: total, byBand, reports, topReportedDomains: topReported};
    },

    close: () => db.close(),
  };
}
