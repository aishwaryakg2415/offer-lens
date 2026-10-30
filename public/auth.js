// Log in, sign up and account UI.
import { api, session, onSessionChange, loadSession, logIn, signUp, logOut, deleteAccount } from "/session.js";

const $ = id => document.getElementById(id);
const authDialog = $("authDialog"), accountDialog = $("accountDialog");
const initials = name => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");

// ---------- Nav ----------
onSessionChange(({user}) => {
  $("navGuest").hidden = !!user;
  $("navUser").hidden = !user;
  if (user){
    $("userName").textContent = user.name.split(" ")[0];
    $("avatar").textContent = $("avatarLg").textContent = initials(user.name);
  }
  if (!user && accountDialog.open) accountDialog.close();
});

// ---------- Dialog helpers ----------
function open(dialog){ if (!dialog.open) dialog.showModal(); }
document.querySelectorAll("dialog [data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
for (const d of [authDialog, accountDialog]){
  d.addEventListener("click", e => { if (e.target === d) d.close(); });   // click on the backdrop
}

function showTab(which, reason){
  const login = which === "login";
  $("tabLogin").setAttribute("aria-selected", String(login));
  $("tabSignup").setAttribute("aria-selected", String(!login));
  $("loginForm").hidden = !login;
  $("signupForm").hidden = login;
  $("authTitle").textContent = login ? "Welcome back" : "Create your account";
  if (reason !== undefined){ $("authReason").textContent = reason; $("authReason").hidden = !reason; }
  for (const id of ["loginError", "signupError"]) $(id).hidden = true;
  open(authDialog);
  (login ? $("loginEmail") : $("signupName")).focus();
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-auth]");
  if (b){ e.preventDefault(); showTab(b.dataset.auth, b.closest("dialog") ? undefined : ""); }
});
$("tabLogin").addEventListener("click", () => showTab("login"));
$("tabSignup").addEventListener("click", () => showTab("signup"));
document.addEventListener("offerlens:login", e => showTab("login", e.detail?.reason || ""));

// Show / hide password
document.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", () => {
  const input = $(b.dataset.toggle), show = input.type === "password";
  input.type = show ? "text" : "password";
  b.textContent = show ? "Hide" : "Show";
}));

// Password strength meter (a guide only; the server enforces the rules)
$("signupPassword").addEventListener("input", e => {
  const v = e.target.value;
  let score = 0;
  if (v.length >= 10) score++;
  if (v.length >= 14) score++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
  if (/\d/.test(v) || /[^A-Za-z0-9]/.test(v)) score++;
  if (/\s/.test(v.trim()) && v.length >= 14) score++;
  const pct = Math.min(100, score * 20), bar = $("pwBar");
  bar.style.width = pct + "%";
  bar.style.background = pct < 40 ? "var(--crit)" : pct < 80 ? "var(--caution)" : "var(--low)";
});

for (const [form, err] of [["loginForm", "loginError"], ["signupForm", "signupError"]])
  $(form).addEventListener("input", () => { $(err).hidden = true; });

function showError(id, err){ $(id).textContent = err.message; $(id).hidden = false; }
async function busy(btn, fn){
  const label = btn.textContent; btn.disabled = true; btn.textContent = "Please wait…";
  try{ await fn(); } finally{ btn.disabled = false; btn.textContent = label; }
}

$("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  busy($("loginBtn"), async () => {
    try{
      await logIn($("loginEmail").value, $("loginPassword").value);
      $("loginForm").reset(); authDialog.close();
    }catch(err){ showError("loginError", err); $("loginPassword").select(); }
  });
});

$("signupForm").addEventListener("submit", e => {
  e.preventDefault();
  busy($("signupBtn"), async () => {
    try{
      await signUp($("signupName").value, $("signupEmail").value, $("signupPassword").value);
      $("signupForm").reset(); $("pwBar").style.width = "0"; authDialog.close();
    }catch(err){ showError("signupError", err); }
  });
});

// ---------- Account ----------
const fmtDate = s => new Date(s.replace(" ", "T") + "Z").toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"});
const BAND = {low: ["Low risk", "b-low"], caution: ["Caution", "b-caution"], high: ["High risk", "b-high"], crit: ["Critical risk", "b-crit"]};
const CAT_NAMES = {reported: "Reported", money: "Asks to pay", data: "Sensitive data", mule: "Moves money", task: "Task scheme", process: "Skips hiring steps", identity: "Contact mismatch", channel: "Private chat", pay: "Unrealistic pay", pressure: "Pressure", quality: "Vague listing"};

async function openAccount(){
  const u = session.user; if (!u) return;
  $("profileName").textContent = u.name;
  $("profileEmail").textContent = u.email;
  $("profileSince").textContent = `Member since ${fmtDate(u.createdAt).split(",")[0]}`;
  for (const id of ["pwMsg", "delMsg"]) $(id).textContent = "";
  open(accountDialog);
  const h = $("history");
  h.innerHTML = `<p class="hint">Loading…</p>`;
  try{
    const {assessments} = await api("/api/me/assessments");
    if (!assessments.length){ h.innerHTML = `<p class="empty">No checks yet. Run a full check while signed in and it appears here.</p>`; return; }
    h.replaceChildren(...assessments.map(a => {
      const row = document.createElement("div"); row.className = "hist-row";
      const [name, cls] = BAND[a.band] || BAND.low;
      const top = Object.entries(a.categories).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => CAT_NAMES[k] || k);
      const score = document.createElement("strong"); score.className = "hist-score"; score.textContent = a.score;
      const badge = document.createElement("span"); badge.className = `badge ${cls}`; badge.textContent = name;
      const cats = document.createElement("span"); cats.className = "hist-cats"; cats.textContent = top.join(" · ") || "No risk signals";
      const when = document.createElement("span"); when.className = "hist-date"; when.textContent = fmtDate(a.created_at);
      row.append(score, badge, cats, when);
      return row;
    }));
  }catch(err){ h.innerHTML = ""; const p = document.createElement("p"); p.className = "form-error"; p.textContent = err.message; h.append(p); }
}
$("userBtn").addEventListener("click", openAccount);
$("logoutBtn").addEventListener("click", () => logOut());

$("pwForm").addEventListener("submit", e => {
  e.preventDefault();
  busy($("pwBtn"), async () => {
    try{
      await api("/api/auth/password", {current: $("pwCurrent").value, next: $("pwNext").value});
      $("pwForm").reset(); $("pwMsg").className = "form-msg ok"; $("pwMsg").textContent = "Password updated. Other devices have been signed out.";
    }catch(err){ $("pwMsg").className = "form-msg err"; $("pwMsg").textContent = err.message; }
  });
});

$("delForm").addEventListener("submit", e => {
  e.preventDefault();
  busy($("delBtn"), async () => {
    try{ await deleteAccount($("delPassword").value); $("delForm").reset(); }
    catch(err){ $("delMsg").className = "form-msg err"; $("delMsg").textContent = err.message; }
  });
});

loadSession();
