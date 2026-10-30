import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as ai from "../src/ai.js";

// Groq calls go through fetch, so the suite replaces fetch with canned replies.
const realFetch = globalThis.fetch;
const KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE", "GROQ_API_KEY", "AI_PROVIDER", "AI_ENABLED"];
let saved;
beforeEach(() => { saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]])); for (const k of KEYS) delete process.env[k]; });
afterEach(() => { globalThis.fetch = realFetch; for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : process.env[k] = saved[k]; });

const reply = (status, body) => async () => new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});
const rules = {score: 80, findings: [{label: "Names a fee you must pay"}], trust: []};

test("provider prefers Claude, falls back to Groq, and can be disabled", () => {
  assert.equal(ai.provider(), null);
  process.env.GROQ_API_KEY = "gsk_test";
  assert.equal(ai.provider(), "groq");
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  assert.equal(ai.provider(), "claude");
  process.env.AI_PROVIDER = "groq";
  assert.equal(ai.provider(), "groq");
  process.env.AI_ENABLED = "false";
  assert.equal(ai.provider(), null);
});

test("Groq review parses JSON, strips think blocks and clamps the score", async () => {
  process.env.GROQ_API_KEY = "gsk_test";
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = JSON.parse(init.body);
    return reply(200, {choices: [{message: {content: `<think>hmm</think>{"risk_score": 140, "verdict": "Likely a fee scam", "summary": "s", "red_flags": [{"signal": "Fee", "quote": "fee", "why": "w"}], "reassuring_signals": [], "questions_for_recruiter": ["q1"]}`}}]})();
  };
  const r = await ai.review({text: "Pay a fee"}, rules);
  assert.equal(r.risk_score, 100);
  assert.equal(r.provider, "groq");
  assert.equal(r.red_flags[0].signal, "Fee");
  assert.equal(sent.response_format.type, "json_object");
  assert.match(sent.messages[1].content, /<job_message>/);
});

test("Groq errors map to clear messages", async () => {
  process.env.GROQ_API_KEY = "gsk_test";
  globalThis.fetch = reply(429, {error: {message: "rate limit"}});
  await assert.rejects(ai.review({text: "x"}, rules), {code: "rate_limited"});
  globalThis.fetch = reply(401, {error: {message: "bad key"}});
  await assert.rejects(ai.review({text: "x"}, rules), {code: "ai_not_configured"});
  globalThis.fetch = reply(200, {choices: [{message: {content: "not json at all"}}]});
  await assert.rejects(ai.review({text: "x"}, rules), {code: "invalid_output"});
});

test("Groq screenshot reading sends the image as a data URL", async () => {
  process.env.GROQ_API_KEY = "gsk_test";
  let sent;
  globalThis.fetch = async (url, init) => { sent = JSON.parse(init.body); return reply(200, {choices: [{message: {content: "Hello candidate"}}]})(); };
  assert.equal(await ai.extractTextFromImage("AAAA", "image/png"), "Hello candidate");
  assert.equal(sent.messages[0].content[1].image_url.url, "data:image/png;base64,AAAA");
  await assert.rejects(ai.extractTextFromImage("AAAA", "image/bmp"), {code: "bad_image"});
});
