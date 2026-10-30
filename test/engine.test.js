import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, bandOf, blend, regParts } from "../src/engine.js";
import { SAMPLES } from "../public/samples.js";
import { enrich } from "../src/enrich.js";

const labels = a => a.findings.map(f => f.label);

test("example messages land in the expected bands", () => {
  assert.equal(bandOf(analyze(SAMPLES["Task scam"]).score).k, "crit");
  assert.equal(bandOf(analyze(SAMPLES["Fake cheque"]).score).k, "crit");
  assert.equal(bandOf(analyze(SAMPLES["Unclear recruiter DM"]).score).k, "caution");
  assert.equal(bandOf(analyze(SAMPLES["Real-looking listing"]).score).k, "low");
});

test("an OTP request alone sets the 50-point floor", () => {
  const a = analyze({text: "Please share the OTP you receive to complete your background verification."});
  assert.ok(a.critical);
  assert.ok(a.score >= 50, `score ${a.score}`);
});

test("a free email claiming a company is flagged", () => {
  const a = analyze({text: "We would like to interview you.", company: "Wipro", contact: "wipro.hr.desk@gmail.com"});
  assert.ok(labels(a).includes("Recruiter uses a free personal email"));
});

test("lookalike brand domains are flagged, real ones are not", () => {
  assert.ok(labels(analyze({text: "Apply at https://infosys-careers-portal.top/apply"})).includes("Website imitates a known brand"));
  assert.ok(!labels(analyze({text: "Apply at https://www.infosys.com/careers"})).includes("Website imitates a known brand"));
  assert.ok(labels(analyze({text: "Reply to hr@amaz0n.com"})).includes("Email domain imitates a known brand"));
});

test("signs of a real hiring process reduce the score", () => {
  const text = "Junior analyst role. Pay a training fee to join.";
  const plain = analyze({text}).raw;
  const withProcess = analyze({text: text + " Hiring process: online assessment, technical interview and HR round. Requirements: bachelor's degree."});
  assert.ok(withProcess.mit > 0);
  assert.equal(withProcess.raw, plain);
});

test("evidence ranges point at the matched words", () => {
  const input = {text: "Earn money fast. A registration fee of Rs 500 is required."};
  const f = analyze(input).findings.find(f => f.label === "Names a fee you must pay");
  const [s, e] = f.ranges[0];
  assert.equal(input.text.slice(s, e).toLowerCase(), "registration fee");
});

test("extra findings from lookups feed the score", () => {
  const base = analyze({text: "Hello, we have a job for you."});
  const boosted = analyze({text: "Hello, we have a job for you."}, {extraFindings: [{cat: "reported", w: .4, label: "x", why: "", ranges: [], quotes: []}]});
  assert.ok(boosted.score > base.score);
});

test("blend weights rules 55% and Claude 45%", () => {
  assert.equal(blend(100, 0), 55);
  assert.equal(blend(40, null), 40);
});

test("registrable domain handles two-part suffixes", () => {
  assert.equal(regParts("careers.example.co.in").reg, "example.co.in");
  assert.equal(regParts("jobs.example.com").sld, "example");
});

test("enrichment turns a brand-new domain into a finding", async () => {
  const lookups = {
    rdapLookup: async () => ({status: "ok", createdAt: new Date().toISOString(), ageDays: 3, registrar: "Test"}),
    mxLookup: async () => ({status: "ok", hasMx: false}),
  };
  const out = await enrich({emails: ["hr@newjobs-hiring.com"], hosts: []}, {lookups});
  const ls = out.findings.map(f => f.label);
  assert.ok(ls.includes("Domain registered in the last month"));
  assert.ok(ls.includes("Email domain can't receive mail"));
});

test("enrichment never invents findings when lookups fail", async () => {
  const lookups = {rdapLookup: async () => ({status: "unknown"}), mxLookup: async () => ({status: "unknown"})};
  const out = await enrich({emails: ["hr@company.com"], hosts: ["https://company.com"]}, {lookups});
  assert.equal(out.findings.length, 0);
});
