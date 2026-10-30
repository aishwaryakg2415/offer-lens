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
  countUp($("statChecks"), s.assessments);
  countUp($("statRisky"), (s.byBand.high || 0) + (s.byBand.crit || 0));
  countUp($("statReports"), s.reports);
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

// ---------- Motion ----------
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Scroll reveal, staggered within each group
if (!reduce && "IntersectionObserver" in window){
  document.documentElement.classList.add("motion");
  const groups = new Map();
  document.querySelectorAll("[data-reveal]").forEach(el => {
    const parent = el.parentElement, i = groups.get(parent) || 0;
    groups.set(parent, i + 1);
    el.style.setProperty("--d", `${Math.min(i, 5) * 0.08}s`);
  });
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); }
  }, {rootMargin: "0px 0px -8% 0px"});
  document.querySelectorAll("[data-reveal]").forEach(el => io.observe(el));
}

// Count-up for the stats band (called after the numbers load)
function countUp(el, to){
  if (reduce || !to){ el.textContent = fmt(to); return; }
  const start = performance.now(), dur = 1200;
  const step = now => {
    const t = Math.min(1, (now - start) / dur), eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(Math.round(to * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Tilt cards toward the pointer
if (!reduce && matchMedia("(hover: hover)").matches){
  document.querySelectorAll("[data-tilt]").forEach(card => {
    card.addEventListener("pointermove", e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      card.style.transform = `perspective(800px) rotateX(${(-y * 6).toFixed(2)}deg) rotateY(${(x * 6).toFixed(2)}deg) translateY(-3px)`;
    });
    card.addEventListener("pointerleave", () => { card.style.transform = ""; });
  });
}

// Draggable chips in the hero, kept inside the hero section
const stage = $("heroStage"), bounds = document.querySelector(".hero");
document.querySelectorAll("[data-drag]").forEach(chip => {
  let x = 0, y = 0, startX = 0, startY = 0, baseX = 0, baseY = 0, box = null;
  chip.addEventListener("pointerdown", e => {
    e.preventDefault();
    chip.setPointerCapture(e.pointerId);
    chip.classList.add("dragging");
    startX = e.clientX - x; startY = e.clientY - y;
    const r = chip.getBoundingClientRect(), h = bounds.getBoundingClientRect();
    baseX = r.left - x; baseY = r.top - y;   // where the chip sits with no offset
    box = {minX: h.left + 8 - baseX, maxX: h.right - 8 - r.width - baseX, minY: h.top + 8 - baseY, maxY: h.bottom - 8 - r.height - baseY};
  });
  chip.addEventListener("pointermove", e => {
    if (!chip.hasPointerCapture(e.pointerId)) return;
    x = Math.max(box.minX, Math.min(box.maxX, e.clientX - startX));
    y = Math.max(box.minY, Math.min(box.maxY, e.clientY - startY));
    chip.style.translate = `${x}px ${y}px`;
  });
  const end = e => { chip.classList.remove("dragging"); if (chip.hasPointerCapture(e.pointerId)) chip.releasePointerCapture(e.pointerId); };
  chip.addEventListener("pointerup", end);
  chip.addEventListener("pointercancel", end);
});
if (stage) stage.addEventListener("pointerdown", () => stage.querySelector(".drag-hint")?.remove(), {once: true});

// Auto-moving carousel: advances every 3.5 s, pauses on hover, focus or touch
const ticker = $("ticker");
if (ticker){
  const card = () => ticker.querySelector(".quote");
  const stepBy = dir => {
    const w = card().getBoundingClientRect().width + 16;
    const atEnd = ticker.scrollLeft + ticker.clientWidth >= ticker.scrollWidth - 4;
    if (dir > 0 && atEnd) ticker.scrollTo({left: 0});
    else ticker.scrollBy({left: dir * w});
  };
  $("tickPrev").addEventListener("click", () => stepBy(-1));
  $("tickNext").addEventListener("click", () => stepBy(1));
  let paused = false;
  for (const ev of ["pointerenter", "focusin", "touchstart"]) ticker.addEventListener(ev, () => { paused = true; }, {passive: true});
  for (const ev of ["pointerleave", "focusout"]) ticker.addEventListener(ev, () => { paused = false; });
  if (!reduce) setInterval(() => { if (!paused && !document.hidden) stepBy(1); }, 3500);
}
