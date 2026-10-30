// Shared session state and the one API helper every page script uses.
// It sends the CSRF token the server issued for the signed-in session.
export const session = {user: null, csrf: null};
const listeners = new Set();

export const onSessionChange = fn => { listeners.add(fn); fn(session); };
function setSession(user, csrf){
  session.user = user; session.csrf = csrf;
  for (const fn of listeners) fn(session);
}

export async function api(path, body, {method = body === undefined ? "GET" : "POST"} = {}){
  const headers = {};
  if (method !== "GET"){ headers["content-type"] = "application/json"; if (session.csrf) headers["x-csrf-token"] = session.csrf; }
  const res = await fetch(path, {method, headers, credentials: "same-origin", body: method === "GET" ? undefined : JSON.stringify(body ?? {})});
  const data = await res.json().catch(() => ({}));
  if (!res.ok){
    // A stale tab after logout elsewhere: refresh our view of the session.
    if (data.error === "bad_csrf" || data.error === "login_required") loadSession();
    throw Object.assign(new Error(data.message || `Request failed (${res.status})`), {code: data.error, status: res.status});
  }
  return data;
}

export async function loadSession(){
  try{ const d = await api("/api/auth/me"); setSession(d.user, d.csrfToken); }
  catch{ setSession(null, null); }
}

export async function signUp(name, email, password){
  const d = await api("/api/auth/signup", {name, email, password}); setSession(d.user, d.csrfToken); return d.user;
}
export async function logIn(email, password){
  const d = await api("/api/auth/login", {email, password}); setSession(d.user, d.csrfToken); return d.user;
}
export async function logOut(){
  try{ await api("/api/auth/logout", {}); } finally{ setSession(null, null); }
}
export async function deleteAccount(password){
  await api("/api/auth/delete", {password}); setSession(null, null);
}

// Ask the page to open the log-in dialog (auth.js listens), e.g. after a 401.
export const requestLogin = (reason = "") => document.dispatchEvent(new CustomEvent("offerlens:login", {detail: {reason}}));
