import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { analyze, blend, bandOf, regParts, FREE_MAIL, SHORTENERS } from "./engine.js";
import { enrich as defaultEnrich } from "./enrich.js";
import { openDb } from "./db.js";
import * as defaultAi from "./ai.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LIMITS = {text: 20000, field: 300, imageBytes: 8 * 1024 * 1024};
// Big, well-known platforms whose domains appear in real and fake messages alike.
const NEVER_REPORT = new Set(["google", "linkedin", "naukri", "indeed", "glassdoor", "microsoft", "amazon", "whatsapp", "telegram", "lever", "greenhouse", "myworkdayjobs", "workday", "forms", "youtube"]);

function rateLimiter({windowMs, max}){
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now(), key = req.ip;
    const h = hits.get(key);
    if (!h || now - h.start > windowMs) hits.set(key, {start: now, n: 1});
    else if (++h.n > max) return res.status(429).json({error: "rate_limited", message: "Too many requests. Try again in a few minutes."});
    if (hits.size > 10000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    next();
  };
}

function readInput(body){
  const str = (v, max) => typeof v === "string" ? v.slice(0, max) : "";
  const input = {text: str(body?.text, LIMITS.text), company: str(body?.company, LIMITS.field).trim(), contact: str(body?.contact, LIMITS.field).trim(), link: str(body?.link, LIMITS.field).trim()};
  if (!input.text.trim()) { const e = new Error("Paste the job message to check."); e.status = 400; e.code = "missing_text"; throw e; }
  return input;
}

// The identifiers in a message that can be reported and looked up later.
function identifiersOf(analysis){
  const out = [];
  for (const e of analysis.emails) out.push({kind: "email", value: e.toLowerCase()});
  const domains = new Set([
    ...analysis.hosts.filter(h => !SHORTENERS.has(h)),
    ...analysis.emails.map(e => e.split("@")[1]).filter(d => !FREE_MAIL.has(d)),
  ].map(h => regParts(h)).filter(p => !NEVER_REPORT.has(p.sld)).map(p => p.reg));
  for (const d of domains) out.push({kind: "domain", value: d});
  for (const p of analysis.phones) out.push({kind: "phone", value: p});
  return out;
}

export function createApp({db = openDb(), ai = defaultAi, enrich = defaultEnrich, salt = process.env.REPORT_SALT || "offer-lens"} = {}){
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);
  app.use(express.json({limit: "12mb"}));
  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });

  app.get("/engine.js", (req, res) => res.type("text/javascript").sendFile(path.join(here, "engine.js")));
  app.use(express.static(path.join(here, "..", "public")));

  const aiLimit = rateLimiter({windowMs: 10 * 60 * 1000, max: Number(process.env.AI_RATE_LIMIT || 20)});
  const reportLimit = rateLimiter({windowMs: 60 * 60 * 1000, max: 30});
  const reporterId = req => createHash("sha256").update(`${salt}:${req.ip}`).digest("hex").slice(0, 32);

  app.get("/api/health", (req, res) => res.json({ok: true, ai: ai.aiConfigured(), provider: ai.provider(), model: ai.modelName()}));

  app.post("/api/assess", (req, res, next) => (req.body?.useAI ? aiLimit(req, res, next) : next()), async (req, res, next) => {
    try{
      const input = readInput(req.body);
      const base = analyze(input);

      const ids = identifiersOf(base);
      const [publicSignals, reports] = await Promise.all([
        req.body.lookups === false ? {domains: [], findings: [], trust: []} : enrich(base),
        Promise.resolve(db.lookupReports(ids)),
      ]);
      const reportFindings = reports.map(r => ({
        cat: "reported", w: Math.min(.5, .25 + .05 * r.count), source: "community",
        label: `${r.kind === "email" ? "Email" : r.kind === "phone" ? "Phone number" : "Domain"} reported by other users`,
        why: `${r.value} has been reported as a scam ${r.count} time${r.count === 1 ? "" : "s"}.`,
        ranges: [], quotes: [r.value],
      }));
      const analysis = analyze(input, {extraFindings: [...publicSignals.findings, ...reportFindings], extraTrust: publicSignals.trust});

      let review = null, aiError = null;
      if (req.body.useAI){
        if (!ai.aiConfigured()) aiError = {code: "ai_not_configured", message: "No AI provider is configured on this server."};
        else try{ review = await ai.review(input, analysis); }
        catch(err){ if (!(err instanceof ai.AIError)) throw err; aiError = {code: err.code, message: err.message}; }
      }

      const score = blend(analysis.score, review?.risk_score);
      const band = bandOf(score);
      const id = db.saveAssessment({text: input.text, score, rulesScore: analysis.score, aiScore: review?.risk_score, band: band.k, categories: analysis.cats});

      res.json({
        id,
        score, band: {key: band.k, name: band.name, headline: band.head},
        rules: analysis,
        public: {domains: publicSignals.domains, reports},
        ai: review, aiError,
        reportable: ids,
      });
    }catch(err){ next(err); }
  });

  app.post("/api/ocr", aiLimit, async (req, res, next) => {
    try{
      const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.image || "");
      if (!m) return res.status(400).json({error: "bad_image", message: "Send the screenshot as a base64 data URL."});
      if (m[2].length * 0.75 > LIMITS.imageBytes) return res.status(413).json({error: "image_too_large", message: "Use an image under 8 MB."});
      if (!ai.aiConfigured()) return res.status(503).json({error: "ai_not_configured", message: "Screenshot reading needs an AI provider (Claude or Groq), and none is configured on this server."});
      res.json({text: await ai.extractTextFromImage(m[2], m[1])});
    }catch(err){
      if (err instanceof ai.AIError) return res.status(err.status).json({error: err.code, message: err.message});
      next(err);
    }
  });

  app.post("/api/reports", reportLimit, (req, res, next) => {
    try{
      const ids = identifiersOf(analyze(readInput(req.body)));
      if (!ids.length) return res.status(400).json({error: "nothing_to_report", message: "No email, website or phone number was found to report."});
      const added = db.addReports(ids, reporterId(req));
      res.status(201).json({reported: ids, added});
    }catch(err){ next(err); }
  });

  app.get("/api/stats", (req, res) => res.json(db.stats()));

  app.use("/api", (req, res) => res.status(404).json({error: "not_found"}));
  app.use((err, req, res, next) => {
    if (err.type === "entity.too.large") return res.status(413).json({error: "too_large", message: "Request is too large."});
    if (err.status && err.status < 500) return res.status(err.status).json({error: err.code || "bad_request", message: err.message});
    console.error(err);
    res.status(500).json({error: "server_error", message: "Something went wrong. Try again."});
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)){
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => console.log(`Offer Lens running on http://localhost:${port}`));
}
