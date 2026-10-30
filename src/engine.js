// Offer Lens rule engine. Pure functions, no I/O: the server imports this module
// and the browser loads the same file from /engine.js, so both score identically.

// ---------- Risk taxonomy ----------
export const CATS = {
  reported:"Reported by other users",
  money:   "Asks you to pay",
  data:    "Wants sensitive data",
  mule:    "Moves money or goods",
  task:    "Task or commission scheme",
  process: "Skips real hiring steps",
  identity:"Contact & domain mismatch",
  channel: "Moves to private chat",
  pay:     "Unrealistic pay",
  pressure:"Pressure & secrecy",
  quality: "Vague or sloppy listing",
};
export const RULES = [
  // money
  {cat:"money", w:.45, label:"Names a fee you must pay", why:"Real employers pay you. A registration, training, kit or verification fee is the most common job-scam ask.",
    re:/\b(registration|processing|training|joining|onboarding|security|verification|application|documentation|document|kit|uniform|visa|activation)\s+(fees?|charges?|deposit|amount)\b/gi},
  {cat:"money", w:.4, label:"Mentions a 'refundable' deposit", why:"'Refundable' is used to make a payment feel safe. It is almost never refunded.",
    re:/\b(100%\s+)?refundable\b|\bsecurity\s+deposit\b/gi},
  {cat:"money", w:.4, label:"Asks you to pay or transfer money", why:"Any request to send money to get or keep a job is a strong warning sign.",
    re:/\bpay(ing)?\s+(a\s+|the\s+)?(small\s+|one[- ]time\s+|nominal\s+|minimal\s+)?(amount|fees?|charges?|rs\.?\s?\d|₹|inr|\$)|\b(send|transfer|deposit)\s+(the\s+)?(money|amount|payment)\b/gi},
  {cat:"money", w:.15, label:"Mentions a payment app", why:"Payment apps in a job offer usually mean money is expected to move, often from you.",
    re:/\b(upi|gpay|google pay|phonepe|paytm|venmo|cash ?app|zelle)\b/gi},
  // data
  {cat:"data", w:.5, label:"Asks for an OTP, PIN or verification code", why:"No employer ever needs your OTP or PIN. Sharing one can let someone take over your bank or accounts.",
    re:/\b(otp|one[- ]time password|verification code|upi pin|atm pin|pin number)\b/gi},
  {cat:"data", w:.3, label:"Asks for bank or card details", why:"Bank details belong in a signed offer's payroll form, not in an early chat.",
    re:/\b(bank (account|details|statement|login|credentials)|account number|ifsc|net ?banking|debit card|credit card|card number|cvv)\b/gi},
  {cat:"data", w:.25, label:"Asks for ID documents", why:"ID copies before an interview or written offer can be used for identity theft or to open accounts in your name.",
    re:/\b(aadhaa?r( card)?|pan card|pan number|ssn|social security( number)?|passport (copy|number|scan|details)|driver'?s licen[cs]e)\b/gi},
  {cat:"data", w:.08, label:"Asks for personal identifiers", why:"Date of birth and similar details are harmless alone but help complete an identity-theft profile.",
    re:/\b(date of birth|mother'?s maiden name)\b/gi},
  // mule
  {cat:"mule", w:.45, label:"Involves cashing or depositing a cheque", why:"The fake-cheque scam: you deposit their cheque, send part of the money on, and the cheque bounces days later.",
    re:/\b(cash|deposit)\s+(a\s+|the\s+)?(che(que|ck))\b|\bsend you a (che(que|ck))\b|\bche(que|ck) deposit\b/gi},
  {cat:"mule", w:.45, label:"Reshipping or package forwarding", why:"'Forward packages' jobs often use you to move goods bought with stolen cards.",
    re:/\b(re-?ship(ping)?|package (forwarding|inspector)|forward(ing)? (the )?(packages|parcels))\b/gi},
  {cat:"mule", w:.45, label:"Mentions gift cards", why:"Gift cards are a favourite payment method for scammers because they can't be traced or reversed.",
    re:/\b(gift ?cards?|itunes cards?|google play cards?|steam cards?)\b/gi},
  {cat:"mule", w:.45, label:"Uses your account to move money", why:"Receiving and passing on payments makes you a 'money mule', which can get your account frozen and expose you to criminal charges.",
    re:/\b(receive|process|transfer)\s+(payments|funds|money)\s+(for|on behalf of|through your)\b|\b(use|through)\s+your\s+(own\s+)?(bank\s+)?account\b/gi},
  {cat:"mule", w:.35, label:"Buy equipment now, get reimbursed later", why:"Usually paired with a fake cheque, or with an 'approved vendor' that the scammer controls.",
    re:/\b(purchase|buy)\b[^.\n]{0,50}\b(equipment|laptop|software|kit|supplies)\b[^.\n]{0,60}\b(reimburs\w*|refund\w*|approved vendor)/gi},
  // task
  {cat:"task", w:.4, label:"Pays for likes, ratings or reviews", why:"Paid 'like and rate' tasks are the opening of the task scam. Small early payouts lead to 'prepaid tasks' you must fund.",
    re:/\b(lik(e|ing)|subscrib(e|ing)|rat(e|ing)|review(ing)?|follow(ing)?)\s+(youtube|videos?|products?|hotels?|apps?|pages?|posts?|restaurants?)\b/gi},
  {cat:"task", w:.45, label:"Prepaid or recharge tasks", why:"You're asked to top up your own money to unlock bigger tasks. Withdrawals then get blocked.",
    re:/\b(prepaid|merchant|recharge|top[- ]?up|combo)\s+(tasks?|orders?)\b|\btask (commission|rewards?)\b|\bcommission per (task|order)\b/gi},
  {cat:"task", w:.3, label:"Crypto or trading platform", why:"Crypto deposits and 'trading' platforms are hard to trace and are common in fake-job payouts.",
    re:/\b(usdt|cryptocurrency|crypto|bitcoin|btc|binance|trading platform|forex)\b/gi},
  {cat:"task", w:.12, label:"Pitches 'simple tasks'", why:"Vague 'simple online tasks' with no real job title is a common hook.",
    re:/\b(simple|online|easy|home[- ]based|small)\s+tasks?\b/gi},
  // process
  {cat:"process", w:.3, label:"No interview or guaranteed selection", why:"Real employers need to assess you before they hire you. A guaranteed job usually means someone is selling you something.",
    re:/\b(no interview( needed| required)?|without (an )?interview|direct (joining|selection|hiring)|guaranteed (job|placement|selection|income)|100% (job|placement))\b/gi},
  {cat:"process", w:.35, label:"Interview over a chat app", why:"Text-only interviews on Telegram, Signal or WhatsApp let someone pose as a company without showing their face.",
    re:/\binterview\b[^.\n]{0,40}\b(on|via|over|through)\s+(the\s+)?(telegram|whats ?app|signal|text|chat|hangouts|wire)\b/gi},
  {cat:"process", w:.12, label:"Says you're selected before any process", why:"Being 'selected' for a job you never applied or interviewed for is a classic opening line.",
    re:/\b(you (have been|are|were|'ve been) (selected|shortlisted|hired|chosen))\b|\bcongratulations\b/gi},
  // channel
  {cat:"channel", w:.2, label:"Moves the conversation to a private chat app", why:"Moving off email or the job platform removes moderation and makes the recruiter harder to trace.",
    re:/\b(whats ?app|telegram|signal app|wickr|wire app|hangouts|kik)\b/gi},
  {cat:"channel", w:.15, label:"Direct chat link", why:"t.me and wa.me links take you straight to a stranger's chat.",
    re:/\b(t\.me|wa\.me|chat\.whatsapp\.com)\/\S*/gi},
  // pay
  {cat:"pay", w:.15, label:"Leads with how much you'll earn", why:"Listings that sell the money first and describe the work vaguely are a common scam pattern.",
    re:/\b(earn|make|income of|get paid)\s+(up to\s+|upto\s+)?(₹|rs\.?|inr|\$|usd)\s?[\d,]+/gi},
  {cat:"pay", w:.2, label:"Promises daily or instant payouts", why:"Daily or instant payouts suit task scams and gig fraud, not normal employment.",
    re:/\b(daily|weekly|instant|same[- ]day)\s+(payouts?|payments?|income|salary|earnings?)\b/gi},
  {cat:"pay", w:.25, label:"Easy or guaranteed money", why:"Phrases like 'easy money' or 'guaranteed income' describe a sales pitch, not a job.",
    re:/\b(easy|quick|guaranteed|passive|extra|unlimited)\s+(money|income|earnings|cash)\b/gi},
  {cat:"pay", w:.1, label:"No experience needed", why:"Fine on its own, but a warning sign when it's paired with high pay.",
    re:/\bno (prior )?(experience|qualifications?|skills?)\s*(is\s+)?(needed|required|necessary)?\b/gi},
  // pressure
  {cat:"pressure", w:.15, label:"Pressure to act fast", why:"Deadlines and 'limited slots' are there to stop you from checking.",
    re:/\b(urgent(ly)?|immediate(ly)?\s+(joining|start|hiring)|limited (slots|seats|positions|vacancies)|act (now|fast)|within (24|48|12) ?(hours|hrs)|today only|last chance|hurry|first come)\b/gi},
  {cat:"pressure", w:.2, label:"Asks you to keep it secret", why:"Being told not to discuss the offer with anyone isolates you from people who could spot the scam.",
    re:/\b(don'?t|do not)\s+(tell|share|discuss)\b|\bkeep (this|it) (confidential|secret|private)\b/gi},
  // quality
  {cat:"quality", w:.12, label:"Generic low-skill pitch", why:"'Data entry', 'copy-paste' and 'form filling' jobs are often used as cover for fee scams.",
    re:/\b(data entry|copy[- ]paste (work|jobs?)|form filling|sms sending|captcha (entry|typing))\b/gi},
  {cat:"quality", w:.04, label:"Work-from-home or part-time framing", why:"Very common in real jobs too. It only adds a little weight.",
    re:/\b(part[- ]time|work from home|wfh)\b/gi},
];
export const TRUST = [
  {m:.1, label:"Describes a real hiring process", why:"Mentions assessments, technical rounds or panel interviews.",
    re:/\b(interview rounds?|technical (interview|round)|hr round|panel interview|online assessment|coding (test|round)|case study round)\b/gi},
  {m:.1, label:"States specific requirements and duties", why:"Concrete skills, qualifications and responsibilities take effort to write. Scams tend to be vague.",
    re:/\b(\d+\s*[–-]?\s*\d*\+?\s*(years|yrs)\s+(of\s+)?experience|bachelor'?s|master'?s|degree in|b\.?\s?tech|responsibilities|requirements|qualifications)\b/gi},
  {m:.1, label:"Points to an official careers portal", why:"Applying through the company's own portal is the normal route.",
    re:/\bapply (through|via|on|at) (our|the) (official )?(careers?|website|portal|job portal)\b|\bcareers?\.[a-z0-9-]+\.[a-z]{2,}/gi},
  {m:.15, label:"Says it never charges candidates", why:"Many real employers add this anti-fraud line. Scammers occasionally copy it, so it only counts a little.",
    re:/\bwe (will )?never (ask|charge)\b[^.\n]{0,60}\b(fee|money|payment)/gi},
];

export const FREE_MAIL = new Set(["gmail.com","googlemail.com","yahoo.com","yahoo.co.in","yahoo.in","outlook.com","hotmail.com","live.com","msn.com","rediffmail.com","aol.com","protonmail.com","proton.me","icloud.com","mail.com","gmx.com","yandex.com","zohomail.in","zoho.com"]);
export const SHORTENERS = new Set(["bit.ly","tinyurl.com","t.co","goo.gl","cutt.ly","rb.gy","is.gd","shorturl.at","tiny.cc","ow.ly","rebrand.ly","bitly.com"]);
const RISKY_TLD = new Set(["xyz","top","icu","online","site","click","buzz","work","live","shop","rest","cfd","sbs","quest","monster","loan","win"]);
const BRANDS = ["amazon","google","microsoft","infosys","wipro","accenture","deloitte","flipkart","meta","facebook","apple","cognizant","capgemini","netflix","paypal","linkedin","naukri","indeed","reliance","airtel","zomato","swiggy","tesla","walmart","oracle","adobe","salesforce","hcltech","techmahindra","tcs","ibm","kpmg","ernstyoung","pwc"];
const TWO_PART = new Set(["co.in","co.uk","com.au","co.jp","com.br","org.in","net.in","ac.in","gov.in","co.za","com.sg","com.my"]);

// ---------- Helpers ----------

const sev = w => w >= .35 ? 3 : w >= .18 ? 2 : 1;
export function hostOf(s){
  s = String(s||"").trim().toLowerCase();
  if (!s) return "";
  if (s.includes("@") && !s.includes("/")) s = s.split("@").pop();
  s = s.replace(/^[a-z]+:\/\//,"").replace(/^www\./,"").split(/[\/?#:\s]/)[0];
  return s.replace(/[.,;)]+$/,"");
}
export function regParts(host){
  const p = host.split(".");
  if (p.length < 2) return {sld:host, reg:host, tld:""};
  const last2 = p.slice(-2).join(".");
  if (TWO_PART.has(last2) && p.length >= 3) return {sld:p[p.length-3], reg:p.slice(-3).join("."), tld:p[p.length-1]};
  return {sld:p[p.length-2], reg:last2, tld:p[p.length-1]};
}
function lev(a,b){
  if (Math.abs(a.length-b.length) > 2) return 9;
  const d = Array.from({length:a.length+1},(_,i)=>[i]);
  for (let j=1;j<=b.length;j++) d[0][j]=j;
  for (let i=1;i<=a.length;i++) for (let j=1;j<=b.length;j++)
    d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[a.length][b.length];
}
const compact = s => String(s||"").toLowerCase()
  .replace(/\b(pvt|private|ltd|limited|inc|llc|llp|corp|corporation|co|company|technologies|technology|tech|solutions|services|global|india|group|software|analytics|logistics)\b/g,"")
  .replace(/[^a-z0-9]/g,"");
const companyToken = s => (String(s||"").toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(t=>!/^(pvt|private|ltd|limited|inc|the|and|india|global|group|technologies|solutions|services)$/.test(t))[0] || "";

// ---------- Engine ----------
export function analyze({text = "", company = "", contact = "", link = ""}, {extraFindings = [], extraTrust = []} = {}){
  const findings = [], trust = [];
  for (const r of RULES){
    const ranges = [], quotes = [];
    for (const m of text.matchAll(r.re)){
      ranges.push([m.index, m.index + m[0].length]);
      const q = m[0].trim(); if (!quotes.some(x=>x.toLowerCase()===q.toLowerCase())) quotes.push(q);
    }
    if (ranges.length) findings.push({...r, ranges, quotes:quotes.slice(0,4)});
  }
  for (const t of TRUST){
    const quotes = [...text.matchAll(t.re)].map(m=>m[0].trim());
    if (quotes.length) trust.push({...t, quotes:[...new Set(quotes)].slice(0,3)});
  }

  // Unrealistic pay: compare stated rates with what entry-level work pays
  const lowEffort = /\b(no (prior )?experience|freshers?|part[- ]time|from home|wfh|simple tasks?|easy|mobile phone|students|housewives|homemakers|anyone can)\b/i.test(text);
  const payRe = /(₹|rs\.?|inr|\$|usd)\s?([\d,]+(?:\.\d+)?)\s*(k|thousand|lakh|lac)?\s*(?:[–-]\s*(?:₹|rs\.?|\$)?\s?[\d,]+\s*(?:k)?\s*)?(?:\/|per|a|every)\s*(day|daily|hour|hr|week|month)\b|([\d,]{3,})\s*(rs|rupees|inr|usd|dollars)\s*(?:\/|per|a)\s*(day|hour|hr|week|month)\b/gi;
  const LIM = {INR:{hour:1000,day:3000,week:20000,month:150000}, USD:{hour:60,day:400,week:2500,month:15000}};
  const payHits = [];
  for (const m of text.matchAll(payRe)){
    const cur = /\$|usd|dollar/i.test(m[1]||m[6]||"") ? "USD" : "INR";
    let amt = parseFloat((m[2]||m[5]).replace(/,/g,""));
    const mult = (m[3]||"").toLowerCase(); if (mult==="k"||mult==="thousand") amt*=1000; if (mult==="lakh"||mult==="lac") amt*=100000;
    let unit = (m[4]||m[7]).toLowerCase(); unit = unit==="daily"?"day":unit==="hr"?"hour":unit;
    const lim = LIM[cur][unit];
    if ((lowEffort && amt >= lim && unit!=="month") || (lowEffort && unit==="month" && amt>=lim) || amt >= lim*2)
      payHits.push({q:m[0].trim(), r:[m.index, m.index+m[0].length], strong:lowEffort});
  }
  if (payHits.length) findings.push({cat:"pay", w: payHits.some(h=>h.strong) ? .35 : .2,
    label: lowEffort ? "Pay far above normal for no-experience work" : "Pay well above the usual rate",
    why: "Stated pay is high for the effort described. The amount is there to get you past your doubts.",
    ranges: payHits.map(h=>h.r), quotes: payHits.map(h=>h.q).slice(0,3)});

  // Formatting
  const letters = text.replace(/[^a-zA-Z]/g,"");
  const caps = letters.length > 80 ? (text.replace(/[^A-Z]/g,"").length / letters.length) : 0;
  const bangs = (text.match(/!{2,}/g)||[]).length;
  if (caps > .3 || bangs >= 2) findings.push({cat:"quality", w:.08, label:"Shouty formatting", why:"Lots of capitals and exclamation marks is typical of mass-sent bait, not a recruiter's email.", ranges:[...text.matchAll(/!{2,}/g)].map(m=>[m.index,m.index+m[0].length]), quotes: bangs ? ["!!"] : ["ALL CAPS"]});

  // Contact and domain checks
  const emails = new Set(), hosts = new Set();
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  for (const m of (contact||"").matchAll(emailRe)) emails.add(m[0].toLowerCase());
  for (const m of text.matchAll(emailRe)) emails.add(m[0].toLowerCase());
  const urlRe = /\b(?:https?:\/\/|www\.)[^\s<>"')]+|\b(?:bit\.ly|tinyurl\.com|cutt\.ly|rb\.gy|is\.gd|shorturl\.at|tiny\.cc|goo\.gl)\/[^\s<>"')]+/gi;
  if (link && link.trim()) hosts.add(hostOf(link));
  for (const m of text.matchAll(urlRe)) hosts.add(hostOf(m[0]));
  hosts.delete("");
  const findRange = q => { const i = text.toLowerCase().indexOf(q.toLowerCase()); return i>=0 ? [[i,i+q.length]] : []; };
  const cTok = companyToken(company), cComp = compact(company);
  const nameMatches = sld => !!cTok && (sld.includes(cTok) || (cComp.length>=3 && (sld.includes(cComp) || cComp.includes(sld))));
  const brandFor = sld => {
    for (const b of BRANDS){
      if (sld === b) return null;
      if (sld.includes(b) && sld.length > b.length) return b;
      if (b.length >= 5 && lev(sld,b) > 0 && lev(sld,b) <= 2) return b;
    }
    return null;
  };
  const idf = (w,label,why,q) => findings.push({cat:"identity", w, label, why, ranges:findRange(q), quotes:[q]});
  let corporateMatch = false;
  const linkReg = link ? regParts(hostOf(link)).reg : "";
  for (const e of emails){
    const host = e.split("@")[1], {sld, reg, tld} = regParts(host);
    if (FREE_MAIL.has(host)){
      idf(company ? .25 : .15, "Recruiter uses a free personal email",
        company ? `Says it represents ${company} but writes from ${host}. Companies hire from their own domain.` : `Writes from ${host}, not a company domain.`, e);
      continue;
    }
    const b = brandFor(sld);
    if (b) idf(.35, "Email domain imitates a known brand", `${host} looks like ${b} but isn't its real domain.`, e);
    if (RISKY_TLD.has(tld)) idf(.15, "Email uses a low-cost domain ending", `.${tld} domains are cheap and often used for throwaway scam sites.`, e);
    if (company && !nameMatches(sld) && !b) idf(.2, "Email domain doesn't match the company", `${host} has nothing to do with "${company}".`, e);
    if (company && nameMatches(sld)) corporateMatch = true;
    if (linkReg && reg !== linkReg && !SHORTENERS.has(hostOf(link))) idf(.12, "Email and website are on different domains", `Email is at ${reg}, link goes to ${linkReg}.`, e);
  }
  for (const h of hosts){
    const {sld, tld} = regParts(h);
    if (SHORTENERS.has(h)){ idf(.15, "Link is hidden behind a URL shortener", `${h} hides where the link really goes. Don't enter details on a link you can't see.`, h); continue; }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h)){ idf(.2, "Link points to a bare IP address", "Real careers sites have a domain name.", h); continue; }
    const b = brandFor(sld);
    if (b) idf(.35, "Website imitates a known brand", `${h} contains or resembles "${b}" but isn't ${b}'s official domain.`, h);
    if (RISKY_TLD.has(tld)) idf(.15, "Website uses a low-cost domain ending", `.${tld} domains are cheap and often used for short-lived scam sites.`, h);
    if (company && !nameMatches(sld) && !b && !["linkedin","naukri","indeed","glassdoor","lever","greenhouse","workday","myworkdayjobs","smartrecruiters","google","forms"].includes(sld))
      idf(.12, "Website doesn't match the company", `${h} doesn't contain "${company}".`, h);
  }
  if (corporateMatch) trust.push({m:.2, label:"Email domain matches the company", why:"The recruiter writes from a domain tied to the company name.", quotes:[...emails].filter(e=>!FREE_MAIL.has(e.split("@")[1])).slice(0,2)});
  if (!company && !/\b(pvt|ltd|limited|inc|llc|technologies|solutions)\b/i.test(text) && text.length > 40)
    findings.push({cat:"quality", w:.08, label:"No company named", why:"You can't verify an employer that isn't named.", ranges:[], quotes:["(no company)"]});

  const phones = [...new Set([...`${text}\n${contact||""}`.matchAll(/\+?\d[\d\s-]{8,14}\d/g)].map(m=>normalizePhone(m[0])).filter(p=>p.length>=10))];

  findings.push(...extraFindings);
  trust.push(...extraTrust);
  return {...scoreFindings(findings, trust), emails:[...emails], hosts:[...hosts], phones};
}

// Scoring: each finding is independent evidence, combined probabilistically.
export function scoreFindings(findings, trust){
  let p = 1; for (const f of findings) p *= (1 - f.w);
  const raw = 1 - p;
  const mit = Math.min(.4, trust.reduce((s,t)=>s+t.m,0));
  let score = raw * (1 - mit);
  const critical = findings.some(f => ["money","mule"].includes(f.cat) && f.w >= .35) || findings.some(f=>/OTP/.test(f.label));
  if (critical) score = Math.max(score, .5);
  const cats = {};
  for (const k in CATS){ const fs = findings.filter(f=>f.cat===k); cats[k] = 1 - fs.reduce((a,f)=>a*(1-f.w),1); }
  findings.sort((a,b)=>b.w-a.w);
  return {score: Math.round(score*100), raw: Math.round(raw*100), mit: Math.round(mit*100), critical, findings, trust, cats};
}

// Final score when Claude has reviewed the message: 55% rules, 45% Claude.
export const blend = (rules, ai) => ai == null ? rules : Math.round(.55*rules + .45*ai);

export const normalizePhone = s => String(s).replace(/[^\d+]/g, "").replace(/^00/, "+");

export function bandOf(s){
  if (s >= 75) return {k:"crit", name:"Critical risk", head:"Strong signs of a scam. Don't pay, share documents or click links.", color:"var(--crit)"};
  if (s >= 50) return {k:"high", name:"High risk", head:"Several warning signs. Verify independently before you go any further.", color:"var(--high)"};
  if (s >= 25) return {k:"caution", name:"Caution", head:"Some warning signs. Check these before you share anything.", color:"var(--caution)"};
  return {k:"low", name:"Low risk", head:"Few warning signs. Still confirm the role on the company's own site.", color:"var(--low)"};
}

export const ADVICE = {
  reported: "Other Offer Lens users have reported this contact or domain as a scam. Treat it as unsafe unless the company confirms it through its official website.",
  money: "Don't pay anything. Real employers never charge a fee to hire you, train you or 'activate' your account. If you've already paid, contact your bank or payment app now and ask for a reversal.",
  data: "Don't send ID, bank details or any OTP until you've confirmed the employer through its official website and have a written offer. Never share an OTP or PIN with anyone.",
  mule: "Don't deposit cheques, buy gift cards, forward parcels or let money pass through your account. You could be held responsible for the losses.",
  task: "Don't take 'tasks' that pay for likes or reviews, and never top up money to unlock tasks. Withdrawals are usually blocked once you've paid in.",
  process: "Ask for a video or in-person interview with a named employee whose profile you can check on LinkedIn and the company's site.",
  identity: "Find the company's official website yourself through a search engine, not through the link you were sent, and contact HR using the details listed there.",
  channel: "Ask to continue over an official company email address. A real recruiter can do that.",
  pay: "Compare the pay with similar roles on Glassdoor, Naukri or LinkedIn. Pay far above the market for little effort is bait.",
  pressure: "Take your time. A real offer will still be there after a day spent checking it, and pressure to hurry is a warning sign in itself.",
  quality: "Ask for the full job description, the office address and the hiring manager's name. Vague answers are a warning sign.",
};

