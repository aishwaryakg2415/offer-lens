# Offer Lens

Explainable job-scam risk assessment for students and early-career job seekers.

Paste a job post, recruiter email or WhatsApp/Telegram message. Offer Lens returns a 0–100 risk score, the exact phrases behind it, public signals about the sender's domain, and the steps to take next. It does all this before you send documents, click links or pay anything.

**Live app:** https://offer-lens.onrender.com

> Built for **Problem 10: AI Job Scam Detector** (HRTech / Cyber Safety · NLP / Risk Scoring / Evidence Analysis).

## Features

| | |
|---|---|
| **Instant rule engine** | About 40 NLP signals in 11 risk categories, run in the browser as you type. The same module is used on the server, so both always agree. |
| **Explainable evidence** | Every finding quotes the matched text, shows its weight and is highlighted in the original message. |
| **Public signals** | Domain registration age (RDAP), mail-server records (DNS MX), lookalike-brand and cheap-TLD detection. |
| **Community reports** | Users can report a scam's email, domain and phone number. Later checks that contain them score higher. |
| **AI second opinion** | Claude or Groq (free tier) reviews tone, story and consistency. The rules can't assess those. It returns a calibrated score, observations and questions to ask the recruiter. |
| **Screenshot import** | Upload or paste a chat screenshot and the AI transcribes it. |
| **Accounts** | Sign up, log in, log out, change password, delete account, and a private "My checks" history. Checking an offer never needs an account. Reporting a scam does, so reports can't be spammed. |
| **Privacy by design** | Messages are never stored, only a SHA-256 hash. Each report is tied to the reporting account, so one person counts once. |

## How the score works

```
base       = 1 − ∏ (1 − wᵢ)                 every finding is independent evidence
credit     = min(40%, Σ trust signals)       real interview rounds, matching company email, …
rules      = base × (1 − credit)
floor      = 50 if it asks for money, an OTP, or to move money
final      = 0.55 × rules + 0.45 × AI        when an AI review is included
```

Bands: **0–24** low · **25–49** caution · **50–74** high · **75–100** critical.

The output describes risk, never guilt. Every result states that it is an estimate, not a finding of fraud.

### Risk categories

| Category | Example signals | Max weight |
|---|---|---|
| Asks you to pay | registration / training / kit fee, "refundable" deposit | 0.45 |
| Wants sensitive data | OTP or PIN, bank details, Aadhaar / PAN / SSN | 0.50 |
| Moves money or goods | cheque deposits, gift cards, reshipping, money mule | 0.45 |
| Task or commission scheme | paid likes/ratings, prepaid tasks, USDT | 0.45 |
| Skips real hiring steps | "no interview", interview over Telegram | 0.35 |
| Contact & domain mismatch | Gmail "HR", lookalike domain, new domain, no MX | 0.40 |
| Reported by other users | community reports on email, domain or phone | 0.50 |
| Unrealistic pay | ₹3,000/day for no-experience work | 0.35 |
| Moves to private chat | WhatsApp, Telegram, t.me links | 0.20 |
| Pressure & secrecy | "within 24 hours", "keep this confidential" | 0.20 |
| Vague or sloppy listing | no company named, "data entry", "!!" | 0.12 |

## Architecture

```mermaid
flowchart LR
  B[Browser<br/>public/app.js] -- live, as you type --> E[src/engine.js<br/>rule engine]
  B -- POST /api/assess --> S[Express server<br/>src/server.js]
  S --> E
  S --> P[src/enrich.js<br/>RDAP + DNS MX]
  S --> D[(SQLite<br/>src/db.js)]
  S --> C[src/ai.js<br/>Claude API or Groq]
  B -- POST /api/ocr --> S
  B -- POST /api/reports --> S
```

```
src/
  engine.js   rule engine (pure, shared by browser and server)
  enrich.js   domain age and mail-server lookups, cached, fail-safe
  ai.js       AI review (structured JSON) and screenshot OCR via Claude or Groq
  auth.js     accounts, scrypt passwords, sessions, CSRF guard
  db.js       SQLite: users, sessions, assessment hashes, community reports, stats
  server.js   Express API, rate limiting, security headers
public/       index.html, app.js, styles.css, samples.js
test/         engine and API tests (node:test, offline, Claude stubbed)
```

## Run it

Requires **Node.js 22.13+**. SQLite is built in, so no database setup is needed.

```bash
npm install
```

```bash
cp .env.example .env
```

Add one AI key to `.env`:

- **Free:** `GROQ_API_KEY` from https://console.groq.com/keys
- **Paid:** `ANTHROPIC_API_KEY` from https://platform.claude.com

The app still works without either: you get the rules, public signals and community reports, and the AI review and screenshot import are hidden.

```bash
node --env-file=.env --disable-warning=ExperimentalWarning src/server.js
```

Open http://localhost:3000.

### Tests

```bash
npm test
```

35 tests cover the scoring rules, enrichment, both AI providers, every API endpoint, accounts, sessions, CSRF, lockout, security headers and the privacy guarantees. AI and network calls are stubbed, so tests are free and run offline.

### Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/aishwaryakg2415/offer-lens)

1. Click the button (or Render dashboard → **New → Blueprint** → pick this repo). It reads `render.yaml`.
2. When asked, paste your `GROQ_API_KEY` (free, from https://console.groq.com/keys). Leave `ANTHROPIC_API_KEY` empty unless you have one.
3. Click **Apply**. The first build takes 2–4 minutes; your site is at `https://offer-lens.onrender.com` or a similar name.

On the free plan the service sleeps after 15 minutes without visitors (the next visit takes about a minute to wake), and its disk is temporary, so accounts and reports reset on each deploy or restart. Add a Render persistent disk mounted at `/opt/render/project/src/data` on a paid plan to keep them.

### Docker

```bash
docker build -t offer-lens .
```

```bash
docker run -p 3000:3000 -e GROQ_API_KEY=your-key -v offer-lens-data:/app/data offer-lens
```

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/api/health` | | `{ok, ai, provider, model}` |
| `POST` | `/api/assess` | `{text, company?, contact?, link?, useAI?}` | score, band, findings, public signals, AI review |
| `POST` | `/api/ocr` | `{image: "data:image/png;base64,…"}` | `{text}` |
| `POST` | `/api/reports` | `{text, company?, contact?, link?}` (signed in) | identifiers reported |
| `GET` | `/api/stats` | | totals by band, top reported domains |
| `GET` | `/api/auth/me` | | current user and CSRF token |
| `POST` | `/api/auth/signup` | `{name, email, password}` | user, CSRF token, session cookie |
| `POST` | `/api/auth/login` | `{email, password}` | user, CSRF token, session cookie |
| `POST` | `/api/auth/logout` | | ends the session |
| `POST` | `/api/auth/password` | `{current, next}` | changes password, signs out other devices |
| `POST` | `/api/auth/delete` | `{password}` | deletes the account and its history |
| `GET` | `/api/me/assessments` | | your recent checks (scores only) |

Example:

```bash
curl -s localhost:3000/api/assess -H 'content-type: application/json' -d '{"text":"Pay a registration fee of Rs 499 and share your OTP","useAI":false}'
```

## Security notes

**Accounts**
- Passwords are hashed with scrypt (N=2¹⁵, r=8, p=1, 16-byte random salt) and compared in constant time. Plain passwords are never stored or logged.
- Password rules: 10–128 characters, not a common password, not your email name.
- Sessions use 32 random bytes in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Only a SHA-256 of the token is stored, so a database leak doesn't expose live sessions. Sessions last 7 days and rotate on every login.
- Changing your password signs out every other device. Deleting your account needs your password.
- Login returns the same message and takes the same time whether or not the email exists, so it can't be used to discover accounts.
- 5 wrong passwords lock the account for 15 minutes. Logins are rate-limited to 10 per IP per 15 minutes and sign-ups to 5 per IP per hour.

**Cross-site request forgery (CSRF)**
- Every signed-in write must send the session's CSRF token in `X-CSRF-Token`.
- All API writes must be JSON and same-origin, which forms on other websites can't produce.

**Headers and transport**
- Strict Content-Security-Policy (no inline scripts, no framing, no plugins), `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, a locked-down `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`.
- `Strict-Transport-Security` when served over HTTPS (`NODE_ENV=production`). API responses are `no-store`.

**Data and abuse**

- The job message is untrusted. The AI prompt marks it as data and tells the model to ignore any instructions inside it.
- Strict Content-Security-Policy, no inline scripts, `nosniff`, `no-referrer`.
- Input size limits, plus per-IP rate limits on Claude calls and reports.
- Well-known platforms (LinkedIn, Naukri, Google, …) can never be added to the report list.
- Domain lookups time out quickly and never produce a finding when they fail.

## Roadmap

- Calibrate weights on a labelled dataset, such as the public EMSCAD fake-job-postings set.
- Browser extension and a WhatsApp forward-to-check bot.
- Hindi and regional-language signals.
- Company-registry lookups (MCA, Companies House) by name.

## License

MIT
