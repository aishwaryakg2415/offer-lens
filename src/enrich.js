// Public signals about the domains in a message: registration age (RDAP) and
// whether an email domain can receive mail (DNS MX). Every lookup is
// best-effort: a timeout or network error yields "unknown", never a finding.
import { promises as dns } from "node:dns";
import { regParts, FREE_MAIL, SHORTENERS } from "./engine.js";

const TIMEOUT_MS = Number(process.env.LOOKUP_TIMEOUT_MS || 4000);
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

async function cached(key, fn){
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await fn();
  cache.set(key, {at: Date.now(), value});
  return value;
}

const withTimeout = (p, ms = TIMEOUT_MS) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export async function rdapLookup(domain){
  return cached(`rdap:${domain}`, async () => {
    try{
      const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        headers: {accept: "application/rdap+json"}, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 404) return {status: "unregistered"};
      if (!res.ok) return {status: "unknown", error: `RDAP ${res.status}`};
      const data = await res.json();
      const reg = (data.events || []).find(e => e.eventAction === "registration");
      const registrar = (data.entities || []).find(e => (e.roles || []).includes("registrar"));
      const registrarName = registrar?.vcardArray?.[1]?.find(v => v[0] === "fn")?.[3] || null;
      const createdAt = reg?.eventDate || null;
      const ageDays = createdAt ? Math.floor((Date.now() - Date.parse(createdAt)) / 86400000) : null;
      return {status: "ok", createdAt, ageDays, registrar: registrarName};
    }catch(err){
      return {status: "unknown", error: err.name === "TimeoutError" ? "timeout" : err.message};
    }
  });
}

export async function mxLookup(domain){
  return cached(`mx:${domain}`, async () => {
    try{
      const mx = await withTimeout(dns.resolveMx(domain));
      return {status: "ok", hasMx: mx.length > 0};
    }catch(err){
      if (err.code === "ENODATA" || err.code === "ENOTFOUND") return {status: "ok", hasMx: false};
      return {status: "unknown", error: err.code || err.message};
    }
  });
}

// Returns the raw lookups (for display) plus findings and trust signals the
// engine folds into the score.
export async function enrich({emails = [], hosts = []}, {lookups = {rdapLookup, mxLookup}} = {}){
  const emailDomains = [...new Set(emails.map(e => e.split("@")[1]).filter(d => d && !FREE_MAIL.has(d)))];
  const domains = [...new Set([...hosts.filter(h => !SHORTENERS.has(h)), ...emailDomains].map(h => regParts(h).reg))].slice(0, 5);

  const results = await Promise.all(domains.map(async domain => ({
    domain,
    rdap: await lookups.rdapLookup(domain),
    mx: emailDomains.some(d => regParts(d).reg === domain) ? await lookups.mxLookup(domain) : null,
  })));

  const findings = [], trust = [];
  const f = (w, label, why, quote) => findings.push({cat: "identity", w, label, why, ranges: [], quotes: [quote], source: "public"});
  for (const {domain, rdap, mx} of results){
    if (rdap.status === "unregistered")
      f(.35, "Domain isn't registered", `${domain} doesn't exist in the domain registry, so any email or link on it is fake.`, domain);
    else if (rdap.ageDays != null){
      if (rdap.ageDays < 30) f(.4, "Domain registered in the last month", `${domain} was registered ${rdap.ageDays} days ago. Scam sites are usually brand new.`, domain);
      else if (rdap.ageDays < 180) f(.25, "Domain registered recently", `${domain} is only ${Math.round(rdap.ageDays / 30)} months old.`, domain);
      else if (rdap.ageDays < 365) f(.1, "Domain under a year old", `${domain} was registered ${Math.round(rdap.ageDays / 30)} months ago.`, domain);
      else if (rdap.ageDays > 5 * 365) trust.push({m: .05, label: "Long-established domain", why: `${domain} has been registered for ${Math.floor(rdap.ageDays / 365)} years.`, quotes: [domain]});
    }
    if (mx && mx.status === "ok" && !mx.hasMx)
      f(.2, "Email domain can't receive mail", `${domain} has no mail servers, so replies to this address go nowhere.`, domain);
  }
  return {domains: results, findings, trust};
}
