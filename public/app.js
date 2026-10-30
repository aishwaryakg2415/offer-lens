import { analyze, bandOf, regParts, CATS, ADVICE, FREE_MAIL, SHORTENERS } from "/engine.js";
import { SAMPLES } from "/samples.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sev = w => w >= .35 ? 3 : w >= .18 ? 2 : 1;
const SEV = {3: ["Severe", "b-crit"], 2: ["Serious", "b-high"], 1: ["Minor", "b-caution"]};
const fields = ["text", "company", "contact", "link"];

let health = {ai: false};
let full = null;          // last /api/assess response, valid while the input is unchanged
let fullFor = "";         // serialized input that `full` belongs to

const readInput = () => Object.fromEntries(fields.map(k => [k, k === "text" ? $(k).value : $(k).value.trim()]));
const keyOf = input => JSON.stringify(input);

// ---------- Rendering ----------
function render(){
  const input = readInput();
  const server = full && fullFor === keyOf(input) ? full : null;
  const a = server ? server.rules : analyze(input);
  const shown = server ? server.score : a.score;
  const b = bandOf(shown);

  $("mode").textContent = server ? `Full check #${server.id}` : "Instant check";
  $("marker").style.left = shown + "%";
  $("scoreTxt").textContent = shown;
  $("band").className = "badge b-" + b.k; $("band").textContent = b.name;
  $("headline").textContent = input.text.trim() ? b.head : "Paste a message to begin the assessment.";
  $("scoreline").textContent = (server?.ai ? `Rules ${a.score} × 0.55 + Claude ${server.ai.risk_score} × 0.45  ·  ` : "") +
    `${a.findings.length} findings · base ${a.raw}` + (a.mit ? ` · −${a.mit}% process credit` : "") + (a.critical ? " · floor 50 applied" : "");

  // findings
  const qs = list => list.length ? `<div class="ev-quotes">${list.map(q => `<span class="quote">${esc(q)}</span>`).join("")}</div>` : `<span class="hint">—</span>`;
  const src = f => f.source === "public" ? " (public record)" : f.source === "community" ? " (community)" : "";
  const ev = a.findings.map(f => { const [n, c] = SEV[sev(f.w)];
    return `<div class="ev-row"><div><span class="badge ${c}">${n}</span></div><div><div class="ev-title">${esc(f.label)}</div><div class="ev-why">${esc(CATS[f.cat])}${src(f)}. ${esc(f.why)}</div></div>${qs(f.quotes)}<div class="ev-w">+${f.w.toFixed(2)}</div></div>`; });
  const tr = a.trust.map(t => `<div class="ev-row"><div><span class="badge b-low">Positive</span></div><div><div class="ev-title">${esc(t.label)}</div><div class="ev-why">${esc(t.why)}</div></div>${qs(t.quotes)}<div class="ev-w">−${Math.round(t.m * 100)}%</div></div>`);
  const head = `<div class="ev-row head"><div>Severity</div><div>Finding</div><div>Matched text</div><div style="text-align:right">Weight</div></div>`;
  $("evidence").innerHTML = (ev.length || tr.length) ? head + ev.concat(tr).join("") : `<div class="ev-empty">No risk indicators found.</div>`;

  // categories
  const order = Object.keys(CATS).sort((x, y) => a.cats[y] - a.cats[x]);
  $("cats").innerHTML = order.map(k => {
    const v = Math.round(a.cats[k] * 100), c = v >= 35 ? "var(--crit)" : v >= 18 ? "var(--high)" : "var(--caution)";
    return `<div class="cat ${v ? "" : "off"}"><span>${CATS[k]}</span><div class="track"><div class="fill" style="width:${v}%;background:${c}"></div></div><span class="num">${v || "–"}</span></div>`;
  }).join("");

  // annotated text
  const marks = [];
  for (const f of a.findings) for (const r of f.ranges) marks.push({s: r[0], e: r[1], v: sev(f.w), t: f.label});
  marks.sort((x, y) => x.s - y.s || y.v - x.v);
  let html = "", pos = 0;
  for (const m of marks){
    if (m.s < pos) continue;
    html += esc(input.text.slice(pos, m.s)) + `<mark class="s${m.v}" title="${esc(m.t)}">${esc(input.text.slice(m.s, m.e))}</mark>`;
    pos = m.e;
  }
  html += esc(input.text.slice(pos));
  $("marked").innerHTML = html || `<span class="hint">Your text appears here with the risky phrases marked.</span>`;

  // actions
  const cats = [...new Set(a.findings.map(f => f.cat))].sort((x, y) => a.cats[y] - a.cats[x]);
  const steps = cats.map(c => ADVICE[c]);
  steps.push("Look for this exact role on the company's official careers page. If it isn't listed there, treat the offer as unverified.");
  if (shown >= 50) steps.push("Don't click links in the message. If you've already shared documents or paid, report it (India: 1930 / cybercrime.gov.in) and tell your bank.");
  $("steps").innerHTML = steps.map(s => `<li>${esc(s)}</li>`).join("");

  // verification links
  const q = encodeURIComponent, co = input.company;
  const domains = [...new Set([...a.hosts, ...a.emails.map(e => e.split("@")[1]).filter(h => !FREE_MAIL.has(h))])].filter(h => !SHORTENERS.has(h)).slice(0, 3);
  const links = [];
  if (co){
    links.push([`Search “${co}” scam reports`, `https://www.google.com/search?q=${q(`"${co}" job scam OR fraud OR fake`)}`]);
    links.push([`${co} official careers page`, `https://www.google.com/search?q=${q(`${co} official careers site`)}`]);
    links.push([`${co} on LinkedIn`, `https://www.linkedin.com/search/results/companies/?keywords=${q(co)}`]);
    links.push([`Company registry search`, `https://opencorporates.com/companies?q=${q(co)}`]);
  }
  for (const d of domains){
    links.push([`WHOIS: ${regParts(d).reg}`, `https://who.is/whois/${q(regParts(d).reg)}`]);
    links.push([`ScamAdviser: ${regParts(d).reg}`, `https://www.scamadviser.com/check-website/${q(regParts(d).reg)}`]);
  }
  for (const e of a.emails.slice(0, 1)) links.push([`Search ${e}`, `https://www.google.com/search?q=${q(`"${e}"`)}`]);
  $("links").innerHTML = links.map(([t, h]) => `<a href="${esc(h)}" target="_blank" rel="noopener">${esc(t)}</a>`).join("") || `<span class="hint">Add the company name, email or link to get lookup links.</span>`;

  renderServerParts(server);
}

function renderServerParts(server){
  // public signals
  const rows = server?.public?.domains || [], reports = server?.public?.reports || [];
  $("publicBlock").hidden = !server;
  if (server){
    const age = r => r.status === "ok" && r.ageDays != null ? `${r.createdAt.slice(0, 10)} (${r.ageDays < 365 ? `${r.ageDays} days` : `${Math.floor(r.ageDays / 365)} years`})` : r.status === "unregistered" ? "Not registered" : "Unavailable";
    const mx = m => !m ? "—" : m.status !== "ok" ? "Unavailable" : m.hasMx ? "Yes" : "None";
    const domainRows = rows.map(d => `<tr><td class="mono">${esc(d.domain)}</td><td>${esc(age(d.rdap))}</td><td>${esc(d.rdap.registrar || "—")}</td><td>${mx(d.mx)}</td></tr>`).join("");
    const reportRows = reports.map(r => `<tr><td class="mono">${esc(r.value)}</td><td colspan="3">Reported as a scam ${r.count} time${r.count === 1 ? "" : "s"} by Offer Lens users</td></tr>`).join("");
    $("signals").innerHTML = (domainRows || reportRows)
      ? `<table><tr><th>Domain / contact</th><th>Registered</th><th>Registrar</th><th>Mail servers</th></tr>${domainRows}${reportRows}</table>`
      : `<div class="ev-empty">No company domains to look up. Free email providers and link shorteners are skipped. No community reports match this message.</div>`;
  }

  // Claude review
  const ai = server?.ai, out = $("aiOut");
  out.hidden = !(ai || server?.aiError);
  if (ai){
    const li = arr => (arr || []).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join("");
    out.innerHTML = `<h2>Claude review</h2>
      <div class="row"><span class="badge b-${bandOf(ai.risk_score).k}">Claude ${ai.risk_score} / 100</span><strong style="font-size:14px">${esc(ai.verdict || "")}</strong></div>
      <p style="font-size:14px">${esc(ai.summary || "")}</p>
      ${ai.red_flags?.length ? `<div><h3>Observations</h3><ul>${ai.red_flags.map(f => `<li><strong>${esc(f.signal)}.</strong>${f.quote ? ` <span class="quote">${esc(f.quote)}</span>` : ""} ${esc(f.why)}</li>`).join("")}</ul></div>` : ""}
      ${ai.reassuring_signals?.length ? `<div><h3>Mitigating factors</h3><ul>${li(ai.reassuring_signals)}</ul></div>` : ""}
      ${ai.questions_for_recruiter?.length ? `<div><h3>Questions to ask the recruiter</h3><ul>${li(ai.questions_for_recruiter)}</ul></div>` : ""}`;
  } else if (server?.aiError){
    out.innerHTML = `<h2>Claude review</h2><p class="toast">Not included: ${esc(server.aiError.message)}</p>`;
  }

  $("reportBlock").hidden = !(server && server.score >= 50 && server.reportable?.length);
}

function setStatus(msg, isErr = false){
  $("status").hidden = !msg;
  $("statusTxt").textContent = msg || "";
  $("statusTxt").className = "toast" + (isErr ? " err" : "");
}

// ---------- API ----------
async function api(path, body){
  const res = await fetch(path, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Request failed (${res.status})`), {code: data.error});
  return data;
}

async function runFull(e){
  e?.preventDefault();
  const input = readInput();
  if (!input.text.trim()){ setStatus("Paste a message first.", true); return; }
  const useAI = health.ai && $("useAI").checked;
  $("runBtn").disabled = true;
  setStatus(useAI ? "Checking public records and asking Claude… this usually takes 10–30 seconds." : "Checking public records…");
  try{
    const data = await api("/api/assess", {...input, useAI});
    full = data; fullFor = keyOf(input);
    setStatus("");
    $("reportStatus").textContent = "";
    render();
  }catch(err){
    setStatus(err.message, true);
  }finally{ $("runBtn").disabled = false; }
}

async function report(){
  $("reportBtn").disabled = true;
  try{
    const data = await api("/api/reports", readInput());
    $("reportStatus").textContent = data.added
      ? `Reported ${data.reported.map(r => r.value).join(", ")}. Thank you.`
      : "You've already reported these details.";
  }catch(err){ $("reportStatus").textContent = err.message; }
  finally{ $("reportBtn").disabled = false; }
}

async function readShot(file){
  if (!file || !health.ai) return;
  const st = $("shotStatus"); st.hidden = false; st.textContent = "Reading the screenshot…";
  $("shotBtn").disabled = true;
  try{
    const image = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); });
    const {text} = await api("/api/ocr", {image});
    $("text").value = text;
    st.textContent = "Text added from the screenshot. Check it, then add the company name if you know it.";
    render();
  }catch(err){ st.textContent = err.message; }
  finally{ $("shotBtn").disabled = false; }
}

// ---------- Copy report ----------
$("copyBtn").addEventListener("click", () => {
  const input = readInput(), server = full && fullFor === keyOf(input) ? full : null;
  const a = server ? server.rules : analyze(input), s = server ? server.score : a.score;
  const lines = [`Offer Lens report: ${s}/100 (${bandOf(s).name})`, input.company ? `Company claimed: ${input.company}` : "", "",
    "Warning signs:", ...a.findings.map(f => `- ${f.label}${f.quotes[0] && f.quotes[0] !== "(no company)" ? ` ("${f.quotes[0]}")` : ""}`),
    ...(a.trust.length ? ["", "Reassuring signs:", ...a.trust.map(t => `- ${t.label}`)] : []),
    ...(server?.ai ? ["", `Claude: ${server.ai.verdict}. ${server.ai.summary}`] : []),
    "", "This is a risk estimate, not a finding of fraud."].filter((l, i, arr) => !(l === "" && arr[i - 1] === ""));
  navigator.clipboard.writeText(lines.join("\n")).then(() => { $("copyStatus").textContent = "Copied."; }, () => { $("copyStatus").textContent = "Copy isn't available here."; });
});

// ---------- Wiring ----------
function loadSample(name){
  const s = SAMPLES[name];
  for (const k of fields) $(k).value = s[k];
  $("sampleSel").value = name;
  render();
}
$("sampleSel").innerHTML = `<option value="">Load example…</option>` + Object.keys(SAMPLES).map(n => `<option value="${esc(n)}">Example: ${esc(n)}</option>`).join("");
$("sampleSel").addEventListener("change", e => { if (e.target.value) loadSample(e.target.value); });

let t;
$("form").addEventListener("input", e => {
  if (e.target.id === "sampleSel" || e.target.id === "useAI") return;
  $("sampleSel").value = "";
  clearTimeout(t); t = setTimeout(render, 150);
});
$("form").addEventListener("submit", runFull);
$("reportBtn").addEventListener("click", report);
$("shotBtn").addEventListener("click", () => $("shot").click());
$("shot").addEventListener("change", e => { readShot(e.target.files[0]); e.target.value = ""; });
document.addEventListener("paste", e => {
  const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith("image/"));
  if (f && health.ai){ e.preventDefault(); readShot(f); }
});

fetch("/api/health").then(r => r.json()).then(h => {
  health = h;
  $("aiToggle").hidden = !h.ai;
  $("drop").hidden = !h.ai;
}).catch(() => {});

loadSample("Task scam");
