// Accounts and sessions.
// - Passwords: scrypt (N=2^15, r=8, p=1) with a 16-byte random salt, compared in constant time.
// - Sessions: 32 random bytes in an HttpOnly, SameSite=Lax cookie; only its SHA-256 is stored.
// - CSRF: every signed-in, state-changing request must echo the session's CSRF token in
//   the X-CSRF-Token header. All API writes also require a JSON body and a same-origin
//   Origin header, which plain HTML forms on other sites cannot send.
import express from "express";
import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const SCRYPT = {N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024};
const KEYLEN = 64;
export const COOKIE = "ol_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COMMON = new Set(["password", "password1", "password123", "123456789", "1234567890", "12345678910", "qwertyuiop", "iloveyou123", "letmein123", "welcome123", "admin12345", "abcdefghij"]);

export async function hashPassword(password){
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored){
  const [alg, N, r, p, salt, hash] = String(stored).split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, {N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem});
  return timingSafeEqual(key, expected);
}

// Used when an email has no account, so a login attempt takes the same time either way.
const DUMMY_HASH = await hashPassword(randomBytes(12).toString("hex"));

const sha256 = s => createHash("sha256").update(s).digest("hex");

export function passwordProblem(password, email = ""){
  if (typeof password !== "string" || password.length < 10) return "Use at least 10 characters.";
  if (password.length > 128) return "Use 128 characters or fewer.";
  if (COMMON.has(password.toLowerCase())) return "That password is too common. Choose another.";
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) return "Don't use your email address in your password.";
  if (/^(.)\1+$/.test(password)) return "Don't use one repeated character.";
  return null;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

function parseCookies(header = ""){
  const out = {};
  for (const part of header.split(";")){
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isSecure = req => req.secure || process.env.NODE_ENV === "production";

function setSessionCookie(req, res, token){
  res.append("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${isSecure(req) ? "; Secure" : ""}`);
}
function clearSessionCookie(req, res){
  res.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? "; Secure" : ""}`);
}

const publicUser = u => !u ? null : {id: Number(u.id), name: u.name, email: u.email, createdAt: u.created_at};
const fail = (res, status, error, message) => res.status(status).json({error, message});

// Attaches req.user and req.session when the cookie names a live session.
export function sessionMiddleware(db){
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)){
      const s = db.sessionByHash(sha256(token));
      if (s){ req.session = s; req.user = db.userById(s.user_id); }
    }
    next();
  };
}

// Blocks cross-site writes: same-origin Origin, JSON body, and the CSRF token when signed in.
export function csrfGuard(req, res, next){
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin){
    let host;
    try{ host = new URL(origin).host; }catch{ host = null; }
    if (host !== req.headers.host) return fail(res, 403, "bad_origin", "This request came from another website and was blocked.");
  }
  if (req.headers["content-length"] !== "0" && !req.is("application/json")) return fail(res, 415, "json_required", "Send the request as JSON.");
  if (req.session && req.headers["x-csrf-token"] !== req.session.csrf) return fail(res, 403, "bad_csrf", "Your session token is missing or out of date. Reload the page and try again.");
  next();
}

export const requireUser = (req, res, next) => req.user ? next() : fail(res, 401, "login_required", "Log in to do this.");

export function authRouter(db, {loginLimit, signupLimit}){
  const r = express.Router();

  async function startSession(req, res, userId){
    if (req.session) db.deleteSession(req.session.token_hash);   // rotate on every login
    const token = randomBytes(32).toString("base64url");
    const csrf = randomBytes(24).toString("base64url");
    db.createSession({tokenHash: sha256(token), userId, csrf, ttlMs: SESSION_TTL_MS});
    setSessionCookie(req, res, token);
    return csrf;
  }

  r.get("/me", (req, res) => res.json({user: publicUser(req.user), csrfToken: req.session?.csrf ?? null}));

  r.post("/signup", signupLimit, async (req, res, next) => {
    try{
      const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : "";
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const password = req.body?.password;
      if (!name) return fail(res, 400, "invalid_name", "Enter your name.");
      if (!EMAIL_RE.test(email)) return fail(res, 400, "invalid_email", "Enter a valid email address.");
      const problem = passwordProblem(password, email);
      if (problem) return fail(res, 400, "weak_password", problem);
      if (db.userByEmail(email)) return fail(res, 409, "email_taken", "An account with this email already exists. Log in instead.");
      const id = db.createUser({email, name, passwordHash: await hashPassword(password)});
      const csrfToken = await startSession(req, res, id);
      res.status(201).json({user: publicUser(db.userById(id)), csrfToken});
    }catch(err){ next(err); }
  });

  r.post("/login", loginLimit, async (req, res, next) => {
    try{
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 128) : "";
      const user = db.userByEmail(email);
      if (user && user.locked_until > Date.now())
        return fail(res, 429, "locked", "Too many failed attempts. Try again in 15 minutes.");
      const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !ok){
        if (user) db.recordLoginFailure(user.id);
        return fail(res, 401, "bad_credentials", "Email or password is incorrect.");
      }
      db.clearLoginFailures(user.id);
      const csrfToken = await startSession(req, res, user.id);
      res.json({user: publicUser(user), csrfToken});
    }catch(err){ next(err); }
  });

  r.post("/logout", (req, res) => {
    if (req.session) db.deleteSession(req.session.token_hash);
    clearSessionCookie(req, res);
    res.json({ok: true});
  });

  r.post("/password", requireUser, loginLimit, async (req, res, next) => {
    try{
      const {current, next: nextPw} = req.body ?? {};
      if (typeof current !== "string" || !(await verifyPassword(current.slice(0, 128), req.user.password_hash)))
        return fail(res, 401, "bad_credentials", "Your current password is incorrect.");
      const problem = passwordProblem(nextPw, req.user.email);
      if (problem) return fail(res, 400, "weak_password", problem);
      db.setPassword(req.user.id, await hashPassword(nextPw));
      db.deleteOtherSessions(req.user.id, req.session.token_hash);   // sign out other devices
      res.json({ok: true});
    }catch(err){ next(err); }
  });

  r.post("/delete", requireUser, loginLimit, async (req, res, next) => {
    try{
      const password = typeof req.body?.password === "string" ? req.body.password.slice(0, 128) : "";
      if (!(await verifyPassword(password, req.user.password_hash)))
        return fail(res, 401, "bad_credentials", "Your password is incorrect.");
      db.deleteUser(req.user.id);
      clearSessionCookie(req, res);
      res.json({ok: true});
    }catch(err){ next(err); }
  });

  return r;
}
