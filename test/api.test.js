import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { openDb } from "../src/db.js";
import { AIError } from "../src/ai.js";
import { SAMPLES } from "../public/samples.js";

// Claude and network lookups are stubbed so the suite runs offline and free.
const fakeAi = {
  AIError,
  aiConfigured: () => true,
  provider: () => "groq",
  modelName: () => "test-model",
  review: async () => ({risk_score: 90, verdict: "Likely a task scam", summary: "s", red_flags: [], reassuring_signals: [], questions_for_recruiter: []}),
  extractTextFromImage: async () => "transcribed text",
};
const fakeEnrich = async () => ({domains: [], findings: [], trust: []});

let server, base, db;
before(async () => {
  // The suite signs up and logs in many times from one IP.
  process.env.SIGNUP_RATE_LIMIT = "1000";
  process.env.LOGIN_RATE_LIMIT = "1000";
  db = openDb(":memory:");
  server = createApp({db, ai: fakeAi, enrich: fakeEnrich}).listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

const post = (path, body) => fetch(base + path, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});

// A signed-in client: keeps the session cookie and sends the CSRF token.
async function signUp(email, password = "correct horse battery"){
  const res = await post("/api/auth/signup", {name: "Test User", email, password});
  assert.equal(res.status, 201, await res.clone().text());
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const {csrfToken} = await res.json();
  const as = (path, body, {csrf = csrfToken} = {}) => fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {cookie, ...(body === undefined ? {} : {"content-type": "application/json", ...(csrf ? {"x-csrf-token": csrf} : {})})},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {as, cookie, csrfToken};
}

test("health reports AI availability", async () => {
  const h = await (await fetch(base + "/api/health")).json();
  assert.deepEqual(h, {ok: true, ai: true, provider: "groq", model: "test-model"});
});

test("assess without AI returns the rule score", async () => {
  const res = await post("/api/assess", SAMPLES["Real-looking listing"]);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.score, 0);
  assert.equal(data.ai, null);
  assert.equal(data.band.key, "low");
});

test("assess with AI blends both scores", async () => {
  const data = await (await post("/api/assess", {...SAMPLES["Unclear recruiter DM"], useAI: true})).json();
  assert.equal(data.ai.risk_score, 90);
  assert.equal(data.score, Math.round(.55 * data.rules.score + .45 * 90));
});

test("empty text is rejected", async () => {
  const res = await post("/api/assess", {text: "  "});
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "missing_text");
});

test("reports are stored once per person and raise later scores", async () => {
  const msg = {text: "Join now, contact hr@quickhire-jobs.com or +91 98765 43210 on WhatsApp.", company: "QuickHire"};
  const before = await (await post("/api/assess", msg)).json();

  assert.equal((await post("/api/reports", msg)).status, 401);
  const {as} = await signUp("reporter@example.com");
  const r1 = await as("/api/reports", msg);
  assert.equal(r1.status, 201);
  const d1 = await r1.json();
  assert.ok(d1.added >= 2, JSON.stringify(d1));
  const d2 = await (await as("/api/reports", msg)).json();
  assert.equal(d2.added, 0);

  const afterReport = await (await post("/api/assess", msg)).json();
  assert.ok(afterReport.public.reports.length >= 2);
  assert.ok(afterReport.score > before.score);
  assert.ok(afterReport.rules.findings.some(f => f.cat === "reported"));
});

test("well-known platforms are never added to the report list", async () => {
  const {as} = await signUp("reporter2@example.com");
  const data = await (await as("/api/reports", {text: "Apply on https://www.linkedin.com/jobs/123 or mail fake.hr@gmail.com"})).json();
  assert.ok(!data.reported.some(r => r.value === "linkedin.com"));
});

test("ocr validates the image and returns text", async () => {
  assert.equal((await post("/api/ocr", {image: "not-an-image"})).status, 400);
  const png = "data:image/png;base64,iVBORw0KGgo=";
  assert.deepEqual(await (await post("/api/ocr", {image: png})).json(), {text: "transcribed text"});
});

test("stats count assessments without storing text", async () => {
  const s = await (await fetch(base + "/api/stats")).json();
  assert.ok(s.assessments >= 3);
  const cols = db.raw.prepare("PRAGMA table_info(assessments)").all().map(c => c.name);
  assert.ok(!cols.includes("text"));
});

test("the page and shared engine are served", async () => {
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  const eng = await fetch(base + "/engine.js");
  assert.match(eng.headers.get("content-type"), /javascript/);
});

// ---------- Accounts and security ----------
test("signup stores a hashed password and starts a session", async () => {
  const {as, cookie} = await signUp("new.user@example.com");
  assert.match(cookie, /^ol_session=[A-Za-z0-9_-]{43}$/);
  const me = await (await as("/api/auth/me")).json();
  assert.equal(me.user.email, "new.user@example.com");
  const row = db.userByEmail("new.user@example.com");
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes("correct horse"));
  const token = cookie.split("=")[1];
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?").get(token).n, 0);
});

test("session cookie is HttpOnly and SameSite", async () => {
  const res = await post("/api/auth/signup", {name: "C", email: "cookie@example.com", password: "another good passphrase"});
  const c = res.headers.get("set-cookie");
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
});

test("weak passwords, bad emails and duplicate accounts are rejected", async () => {
  assert.equal((await (await post("/api/auth/signup", {name: "A", email: "a@example.com", password: "short"})).json()).error, "weak_password");
  assert.equal((await (await post("/api/auth/signup", {name: "A", email: "a@example.com", password: "password123"})).json()).error, "weak_password");
  assert.equal((await (await post("/api/auth/signup", {name: "A", email: "not-an-email", password: "a fine passphrase"})).json()).error, "invalid_email");
  await signUp("dupe@example.com");
  assert.equal((await post("/api/auth/signup", {name: "A", email: "DUPE@example.com", password: "a fine passphrase"})).status, 409);
});

test("login gives the same error for unknown email and wrong password", async () => {
  await signUp("login@example.com");
  const a = await (await post("/api/auth/login", {email: "login@example.com", password: "wrong password here"})).json();
  const b = await (await post("/api/auth/login", {email: "nobody@example.com", password: "wrong password here"})).json();
  assert.deepEqual(a, b);
  assert.equal((await post("/api/auth/login", {email: "LOGIN@example.com", password: "correct horse battery"})).status, 200);
});

test("five wrong passwords lock the account", async () => {
  await signUp("lock@example.com");
  for (let i = 0; i < 5; i++) await post("/api/auth/login", {email: "lock@example.com", password: "nope nope nope"});
  const res = await post("/api/auth/login", {email: "lock@example.com", password: "correct horse battery"});
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, "locked");
});

test("signed-in writes need the CSRF token and same-origin requests", async () => {
  const {as} = await signUp("csrf@example.com");
  const msg = {text: "Mail hr@csrf-test-jobs.com"};
  assert.equal((await as("/api/reports", msg, {csrf: null})).status, 403);
  assert.equal((await as("/api/reports", msg, {csrf: "wrong"})).status, 403);
  const cross = await fetch(base + "/api/assess", {method: "POST", headers: {"content-type": "application/json", origin: "https://evil.example"}, body: JSON.stringify(msg)});
  assert.equal(cross.status, 403);
  const form = await fetch(base + "/api/assess", {method: "POST", headers: {"content-type": "application/x-www-form-urlencoded"}, body: "text=hi"});
  assert.equal(form.status, 415);
});

test("checks are saved to the signed-in user's history", async () => {
  const {as} = await signUp("history@example.com");
  await as("/api/assess", SAMPLES["Task scam"]);
  await as("/api/assess", SAMPLES["Real-looking listing"]);
  const {assessments} = await (await as("/api/me/assessments")).json();
  assert.equal(assessments.length, 2);
  assert.equal(assessments[0].band, "low");
  assert.equal((await fetch(base + "/api/me/assessments")).status, 401);
});

test("logout ends the session", async () => {
  const {as} = await signUp("logout@example.com");
  assert.equal((await as("/api/auth/logout", {})).status, 200);
  assert.equal((await (await as("/api/auth/me")).json()).user, null);
});

test("changing the password signs out other sessions", async () => {
  const first = await signUp("pw@example.com");
  const login = await post("/api/auth/login", {email: "pw@example.com", password: "correct horse battery"});
  const otherCookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await first.as("/api/auth/password", {current: "correct horse battery", next: "a brand new passphrase"})).status, 200);
  const other = await (await fetch(base + "/api/auth/me", {headers: {cookie: otherCookie}})).json();
  assert.equal(other.user, null);
  assert.equal((await post("/api/auth/login", {email: "pw@example.com", password: "a brand new passphrase"})).status, 200);
});

test("deleting the account needs the password and removes the user", async () => {
  const {as} = await signUp("bye@example.com");
  assert.equal((await as("/api/auth/delete", {password: "wrong one here"})).status, 401);
  assert.equal((await as("/api/auth/delete", {password: "correct horse battery"})).status, 200);
  assert.equal(db.userByEmail("bye@example.com"), null);
});

test("security headers are set", async () => {
  const res = await fetch(base + "/");
  for (const h of ["x-frame-options", "permissions-policy", "cross-origin-opener-policy", "referrer-policy", "x-content-type-options"]) assert.ok(res.headers.get(h), h);
  assert.equal((await fetch(base + "/api/health")).headers.get("cache-control"), "no-store");
});
