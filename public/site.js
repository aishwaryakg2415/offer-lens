// Site chrome: mobile menu, example cards that load into the checker, live stats.
const $ = id => document.getElementById(id);

// Hidden navigation on small screens
const toggle = $("navToggle"), menu = $("siteMenu");
const setMenu = open => { toggle.setAttribute("aria-expanded", String(open)); menu.classList.toggle("open", open); };
toggle.addEventListener("click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
menu.addEventListener("click", e => { if (e.target.closest("a")) setMenu(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape") setMenu(false); });

// Shadow under the fixed bar once the page scrolls
const nav = document.querySelector(".site-nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
window.addEventListener("scroll", onScroll, {passive: true});
onScroll();

// "Try this example" cards
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-sample]");
  if (!btn) return;
  const sel = $("sampleSel");
  sel.value = btn.dataset.sample;
  sel.dispatchEvent(new Event("change", {bubbles: true}));
  $("check").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
});

// Live stats band
const fmt = n => new Intl.NumberFormat("en-IN").format(n);
fetch("/api/stats").then(r => r.ok ? r.json() : null).then(s => {
  if (!s) return;
  $("statChecks").textContent = fmt(s.assessments);
  $("statRisky").textContent = fmt((s.byBand.high || 0) + (s.byBand.crit || 0));
  $("statReports").textContent = fmt(s.reports);
  const list = $("statDomains");
  if (s.topReportedDomains.length){
    list.replaceChildren(...s.topReportedDomains.slice(0, 4).map(d => {
      const li = document.createElement("li");
      const code = document.createElement("code"); code.textContent = d.value;
      const n = document.createElement("span"); n.textContent = `${d.reports} report${d.reports === 1 ? "" : "s"}`;
      li.append(code, n);
      return li;
    }));
  }
}).catch(() => {});
