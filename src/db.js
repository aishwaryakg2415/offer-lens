// SQLite storage (Node's built-in node:sqlite). Assessments keep only a hash of
// the message, never the text itself. Reports keep the identifiers people flag
// (email, domain, phone) so later checks can warn about repeat offenders.
// Users store an scrypt password hash; sessions store a SHA-256 of the token.
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
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      failed_logins INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports(kind, value, reporter);
  `);

  db.exec("PRAGMA foreign_keys = ON");
  const cols = db.prepare("PRAGMA table_info(assessments)").all().map(c => c.name);
  if (!cols.includes("user_id")) db.exec("ALTER TABLE assessments ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");

  const insAssessment = db.prepare(`INSERT INTO assessments (text_hash, score, rules_score, ai_score, band, categories, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insReport = db.prepare(`INSERT OR IGNORE INTO reports (kind, value, reporter) VALUES (?, ?, ?)`);
  const countReports = db.prepare(`SELECT COUNT(*) AS n FROM reports WHERE kind = ? AND value = ?`);

  return {
    raw: db,
    hash: s => createHash("sha256").update(s).digest("hex"),

    saveAssessment({text, score, rulesScore, aiScore, band, categories, userId = null}){
      const r = insAssessment.run(this.hash(text), score, rulesScore, aiScore ?? null, band, JSON.stringify(categories), userId);
      return Number(r.lastInsertRowid);
    },

    // reporter identifies the signed-in account, so one person counts once per identifier.
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

    // ---------- Accounts ----------
    createUser({email, name, passwordHash}){
      const r = db.prepare(`INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)`).run(email, name, passwordHash);
      return Number(r.lastInsertRowid);
    },
    userByEmail: email => db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) ?? null,
    userById: id => db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) ?? null,
    recordLoginFailure(id, {max = 5, lockMs = 15 * 60 * 1000} = {}){
      db.prepare(`UPDATE users SET
        locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END,
        failed_logins = CASE WHEN failed_logins + 1 >= ? THEN 0 ELSE failed_logins + 1 END WHERE id = ?`).run(max, Date.now() + lockMs, max, id);
    },
    clearLoginFailures: id => db.prepare(`UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?`).run(id),
    setPassword: (id, passwordHash) => db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, id),
    deleteUser(id){
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM assessments WHERE user_id = ?`).run(id);
      db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    },

    createSession({tokenHash, userId, csrf, ttlMs}){
      const now = Date.now();
      db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(now);
      db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`).run(tokenHash, userId, csrf, now, now + ttlMs);
    },
    sessionByHash: tokenHash => db.prepare(`SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?`).get(tokenHash, Date.now()) ?? null,
    deleteSession: tokenHash => db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash),
    deleteOtherSessions: (userId, keepHash) => db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`).run(userId, keepHash),

    assessmentsFor(userId, limit = 50){
      return db.prepare(`SELECT id, created_at, score, rules_score, ai_score, band, categories FROM assessments WHERE user_id = ? ORDER BY id DESC LIMIT ?`).all(userId, limit)
        .map(r => ({...r, id: Number(r.id), categories: JSON.parse(r.categories)}));
    },

    close: () => db.close(),
  };
}
