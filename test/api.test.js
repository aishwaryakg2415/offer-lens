import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/server.js";
import { openDb } from "../src/db.js";
import { AIError } from "../src/ai.js";
import { SAMPLES } from "../public/samples.js";

// Claude and network lookups are stubbed so the suite runs offline and free.
const fakeAi = {
  MODEL: "test-model",
  AIError,
  aiConfigured: () => true,
  reviewWithClaude: async () => ({risk_score: 90, verdict: "Likely a task scam", summary: "s", red_flags: [], reassuring_signals: [], questions_for_recruiter: []}),
  extractTextFromImage: async () => "transcribed text",
};
const fakeEnrich = async () => ({domains: [], findings: [], trust: []});

let server, base, db;
before(async () => {
  db = openDb(":memory:");
  server = createApp({db, ai: fakeAi, enrich: fakeEnrich}).listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

const post = (path, body) => fetch(base + path, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});

test("health reports AI availability", async () => {
  const h = await (await fetch(base + "/api/health")).json();
  assert.deepEqual(h, {ok: true, ai: true, model: "test-model"});
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

  const r1 = await post("/api/reports", msg);
  assert.equal(r1.status, 201);
  const d1 = await r1.json();
  assert.ok(d1.added >= 2, JSON.stringify(d1));
  const d2 = await (await post("/api/reports", msg)).json();
  assert.equal(d2.added, 0);

  const afterReport = await (await post("/api/assess", msg)).json();
  assert.ok(afterReport.public.reports.length >= 2);
  assert.ok(afterReport.score > before.score);
  assert.ok(afterReport.rules.findings.some(f => f.cat === "reported"));
});

test("well-known platforms are never added to the report list", async () => {
  const data = await (await post("/api/reports", {text: "Apply on https://www.linkedin.com/jobs/123 or mail fake.hr@gmail.com"})).json();
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
