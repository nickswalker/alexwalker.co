// Cinemaxxing next-gen — view toggle, day selector, filtering, modal, live freshness. No deps.
// The By-Format / By-Time views are shared between Tonight and This Week (one set of handlers).
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const main = $("main");
  const seg = $("#viewToggle");
  const scoreBtns = $$("[data-filter-format]");
  const venueBtns = $$("[data-filter-venue]");
  const emptyMsg = $("#emptyFiltered") || $("#weekEmpty");

  const activeFormats = new Set();
  let activeVenue = "";

  // Keep "Today"/"Tonight" wording correct across the heading, the day-picker tab and the
  // "More Today" badge even when the static page was built before sunset — and flip it LIVE
  // at sunset while the page is open.
  function applyDaypart() {
    let ss = 0;
    for (const el of $$(".js-daypart")) {
      if (el.dataset.tomorrow === "1") continue;
      const s = parseInt(el.dataset.sunset || "0", 10);
      if (!s) continue;
      ss = s;
      el.textContent = Date.now() >= s ? "Tonight" : "Today";
    }
    if (ss && Date.now() >= ss) {
      for (const el of $$(".badge-more")) {
        if (/\bToday\b/.test(el.textContent)) el.textContent = el.textContent.replace(/\bToday\b/, "Tonight");
      }
    }
    return ss;
  }
  const _sunsetMs = applyDaypart();
  if (_sunsetMs) {
    const _until = _sunsetMs - Date.now();
    if (_until > 0 && _until < 24 * 3600 * 1000) setTimeout(applyDaypart, _until + 1000);
  }

  const inHiddenDay = (el) => { const dv = el.closest(".dayviews"); return dv && dv.hidden; };

  function apply() {
    // Poster tiles (By format) — filter by format + venue.
    for (const tile of $$(".ptile")) {
      const okF = activeFormats.size === 0 || activeFormats.has(tile.dataset.format || "more");
      const okV = !activeVenue || (tile.dataset.venues || "").split(",").includes(activeVenue);
      tile.hidden = !(okF && okV);
    }
    for (const sec of $$(".psec")) sec.hidden = !sec.querySelector(".ptile:not([hidden])");

    // Time cards (By time) — same filters.
    for (const c of $$(".tcard")) {
      const okF = activeFormats.size === 0 || activeFormats.has(c.dataset.format || "other");
      const okV = !activeVenue || (c.dataset.venues || "").split(",").includes(activeVenue);
      c.hidden = !(okF && okV);
    }
    for (const slot of $$(".tslot")) slot.hidden = !slot.querySelector(".tcard:not([hidden])");

    // "Nothing matches" — count what's visible in the active view + active day.
    if (emptyMsg) {
      const sel = (main && main.dataset.view === "time") ? ".tcard" : ".ptile";
      const visible = $$(sel).some(el => !el.hidden && !inHiddenDay(el));
      emptyMsg.hidden = visible;
    }
  }

  // View toggle (By format / By time) — drives every view via main[data-view].
  if (seg && main) {
    for (const opt of seg.querySelectorAll(".seg-opt")) {
      opt.addEventListener("click", () => {
        const mode = opt.dataset.view;
        seg.dataset.mode = mode;
        main.dataset.view = mode;
        seg.querySelectorAll(".seg-opt").forEach(o => o.classList.toggle("seg-on", o === opt));
        apply();
      });
    }
  }

  // Scoreboard format tiles are display-only (counts + film/no-film faces) — NOT filters.

  // Venue pills — single select (All clears).
  const venueSelect = $(".venue-select");   // mobile dropdown mirror of the chips
  for (const btn of venueBtns) {
    btn.addEventListener("click", () => {
      activeVenue = btn.dataset.filterVenue || "";
      venueBtns.forEach(b => b.classList.toggle("chip-on", b === btn));
      if (venueSelect) venueSelect.value = activeVenue;
      apply();
    });
  }
  if (venueSelect) {
    venueSelect.addEventListener("change", () => {
      activeVenue = venueSelect.value || "";
      venueBtns.forEach(b => b.classList.toggle("chip-on", (b.dataset.filterVenue || "") === activeVenue));
      apply();
    });
  }

  // Day selector swaps which day's views are shown + updates the heading to that day.
  const weekDays = $("#weekDays");
  if (weekDays) {
    const dayBtns = $$(".week-day", weekDays);
    const dayviews = $$("#weekBody .dayviews");
    for (const b of dayBtns) {
      b.addEventListener("click", () => {
        const iso = b.dataset.iso;
        for (const dv of dayviews) dv.hidden = dv.dataset.iso !== iso;
        for (const x of dayBtns) {
          const on = x === b;
          x.classList.toggle("week-day-on", on);
          x.setAttribute("aria-selected", on ? "true" : "false");
        }
        apply();
      });
    }
  }

  // Scrollable venue row: a chip left half-visible at the right edge pulses to hint at more.
  for (const row of $$(".chips")) {
    const updatePeek = () => {
      const rr = row.getBoundingClientRect().right;
      for (const c of row.children) {
        const r = c.getBoundingClientRect();
        c.classList.toggle("chip-peek", r.left < rr - 6 && r.right > rr + 6);
      }
    };
    row.addEventListener("scroll", updatePeek, { passive: true });
    window.addEventListener("resize", updatePeek);
    updatePeek();
  }

  // ── Mobile hamburger (secondary nav) ────────────────────────────────────────
  const hamb = $(".hamb"), hambMenu = $(".hamb-menu");
  if (hamb && hambMenu) {
    hamb.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = hambMenu.hidden;
      hambMenu.hidden = !willOpen;
      hamb.setAttribute("aria-expanded", String(willOpen));
    });
    document.addEventListener("click", (e) => {
      if (!hambMenu.hidden && !hambMenu.contains(e.target) && !hamb.contains(e.target)) {
        hambMenu.hidden = true; hamb.setAttribute("aria-expanded", "false");
      }
    });
  }

  // ── Mobile: stack the sticky menu bars flush (section bar → day selector → controls) so the
  //    whole header stays visible, never gaps, and never changes height while scrolling. ──
  function stackSticky() {
    const sp = $(".sprockets-top"), tb = $(".titlebar");
    // The section bar (This Week line) is NOT sticky on mobile — it scrolls away. Only the day
    // selector + controls stay stuck, flush under the title bar.
    const stack = [$(".week-days"), $(".controls")];
    for (const el of stack) if (el) el.style.top = "";
    if (window.innerWidth > 860) return;
    // iOS standalone: the sticky header is offset by the safe-area (notch) inset, so the stack base
    // must include it, or the day selector would overlap the title bar. Measure it with a probe.
    const _probe = document.createElement("div");
    _probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);";
    document.body.appendChild(_probe);
    const safeTop = _probe.getBoundingClientRect().height;
    _probe.remove();
    let top = safeTop + (sp ? sp.offsetHeight : 0) + (tb ? tb.offsetHeight : 0);
    for (const el of stack) {
      if (!el) continue;
      el.style.top = top + "px";
      top += el.offsetHeight - 1;   // 1px overlap so sub-pixel rounding can't leave a seam
    }
  }
  window.addEventListener("resize", stackSticky);
  window.addEventListener("load", stackSticky);
  stackSticky();

  // Mobile: shrink the title bar once you scroll down, to give content more room. The other
  // sticky bars keep their size; recompute the stack whenever the title-bar height changes.
  let _shrunk = false;
  window.addEventListener("scroll", () => {
    const should = window.innerWidth <= 860 && window.scrollY > 24;
    if (should !== _shrunk) {
      _shrunk = should;
      document.body.classList.toggle("scrolled", should);   // shrinks titlebar + minimizes the This Week bar
      stackSticky();
    }
  }, { passive: true });

  // ── Badge shrink-wrap ───────────────────────────────────────────────────────
  // A label badge that wraps onto two lines ("DRESS-UP / SCREENING" on a narrow phone tile) keeps
  // its full max-width as an inline-block, so the pill ends up much wider than its text. CSS can't
  // size a box to its longest wrapped line, so measure the lines and pin the width to them. Applies
  // to every label badge (tiles, By-time cards, detail window); single-line badges are untouched.
  const FIT_SEL = ".ptile-event, .tcard-event, .ev-label, .fdetail-soldout, .ptile-soldout";
  function fitBadge(el) {
    el.style.width = "";
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const lines = {};
    for (const r of rg.getClientRects()) {
      if (!r.width) continue;
      const k = Math.round(r.top);
      lines[k] = (lines[k] || 0) + r.width;
    }
    const ws = Object.values(lines);
    if (ws.length < 2 || !el.offsetWidth) return;
    // Range rects include transforms (the modal scales in) — convert back to layout pixels.
    const scale = el.getBoundingClientRect().width / el.offsetWidth || 1;
    const cs = getComputedStyle(el);
    const extra = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
                + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    el.style.width = Math.ceil(Math.max(...ws) / scale + extra + 1) + "px";
  }
  function fitBadges(root = document) { for (const el of $$(FIT_SEL, root)) fitBadge(el); }
  // Re-fit when a badge's container gets laid out (hidden day/view becoming visible) or resizes.
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver((entries) => { for (const e of entries) fitBadges(e.target); });
    const seen = new Set();
    for (const el of $$(FIT_SEL)) {
      const host = el.parentElement;
      if (host && !seen.has(host)) { seen.add(host); ro.observe(host); }
    }
  } else {
    fitBadges();
    window.addEventListener("resize", () => fitBadges());
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitBadges());

  // ── Detail modal (tap a poster) ─────────────────────────────────────────────
  const modal = $("#filmModal");
  const modalBody = $("#modalBody");
  let lastFocus = null;
  // Scroll-lock that actually holds on iOS: pin <body> in place (overflow:hidden alone lets the
  // page behind scroll during a touch-drag, which is what made the background jump on swipe-away).
  let _savedScrollY = 0;
  function lockScroll() {
    _savedScrollY = window.scrollY || window.pageYOffset || 0;
    const b = document.body.style;
    b.position = "fixed"; b.top = -_savedScrollY + "px"; b.left = "0"; b.right = "0";
    b.width = "100%"; b.overflow = "hidden";
    document.body.classList.add("modal-open");   // lifts the content above the sticky bars so the modal overlaps them
  }
  function unlockScroll() {
    const b = document.body.style;
    b.position = ""; b.top = ""; b.left = ""; b.right = ""; b.width = ""; b.overflow = "";
    document.body.classList.remove("modal-open");
    window.scrollTo(0, _savedScrollY);
  }
  function openModal(tpl, trigger) {
    if (!modal || !tpl) return;
    lastFocus = trigger || null;
    modalBody.innerHTML = "";
    // importNode, not content.cloneNode: a clone is still owned by the template's inert document
    // and iOS Safari can leave its <img>s unloaded after adoption (venue-logo placeholder showed as
    // a bare grey box, 2026-10-26). importNode creates the nodes in THIS document so they load.
    modalBody.appendChild(document.importNode(tpl.content, true));
    modal.hidden = false;
    fitBadges(modalBody);
    requestAnimationFrame(() => modal.classList.add("open"));
    lockScroll();
  }
  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.classList.remove("open");
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      modal.hidden = true; modalBody.innerHTML = ""; unlockScroll();
      if (lastFocus) { try { lastFocus.focus(); } catch (e) {} }
    };
    modal.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 320);
  }
  if (modal) {
    // Delegated so it covers every poster + time card across all week days.
    const esc = (window.CSS && CSS.escape) ? CSS.escape : (x) => x.replace(/["\\]/g, "\\$&");
    document.addEventListener("click", (e) => {
      if (!e.target.closest) return;
      const pbtn = e.target.closest(".ptile-btn");
      if (pbtn) { openModal(pbtn.parentElement.querySelector("template.ptile-detail"), pbtn); return; }
      // By-time card → reuse the matching film's detail from the format view (full venues/times).
      const tbtn = e.target.closest(".tcard-btn");
      if (tbtn) {
        const cardEl = tbtn.closest(".tcard");
        const film = cardEl.dataset.film || "", fmt = cardEl.dataset.format || "";
        const scope = cardEl.closest(".dayviews") || document;
        const pt = scope.querySelector(`.ptile[data-film="${esc(film)}"][data-format="${esc(fmt)}"]`)
                || scope.querySelector(`.ptile[data-film="${esc(film)}"]`);
        const tpl = pt && pt.querySelector("template.ptile-detail");
        if (tpl) openModal(tpl, tbtn);
      }
    });
    for (const el of $$("[data-close]", modal)) el.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    // Swipe-to-dismiss — touch drag-down + trackpad overscroll-up, only when scrolled to the top.
    const card = modal.querySelector(".modal-card");
    const backdrop = modal.querySelector(".modal-backdrop");
    let startY = 0, dy = 0, dragging = false;
    card.addEventListener("touchstart", (e) => {
      if (card.scrollTop > 0) return;
      startY = e.touches[0].clientY; dy = 0; dragging = true;
      card.style.transition = "none";
    }, { passive: true });
    card.addEventListener("touchmove", (e) => {
      if (!dragging) return;
      const delta = e.touches[0].clientY - startY;
      if (delta <= 0) {               // dragging up → hand control back so the card can scroll
        dy = 0; dragging = false; card.style.transform = "";
        if (backdrop) backdrop.style.opacity = ""; return;
      }
      dy = delta;
      if (e.cancelable) e.preventDefault();   // block page/card scroll + rubber-band while dismissing
      card.style.transform = "translateY(" + dy + "px)";
      if (backdrop) backdrop.style.opacity = String(Math.max(0, 1 - dy / 420));
    }, { passive: false });
    card.addEventListener("touchend", () => {
      if (!dragging) return;
      dragging = false;
      card.style.transition = ""; card.style.transform = "";
      if (backdrop) backdrop.style.opacity = "";
      if (dy > 90) closeModal();
    });
    let wheelAcc = 0, wheelTimer = null;
    card.addEventListener("wheel", (e) => {
      if (card.scrollTop > 0) { wheelAcc = 0; return; }
      if (e.deltaY < 0) {
        wheelAcc += e.deltaY;
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => { wheelAcc = 0; }, 180);
        if (wheelAcc < -150) { wheelAcc = 0; closeModal(); }
      }
    }, { passive: true });
  }

  apply();

  // Live "last checked N min ago".
  const fresh = $("[data-fresh-epoch]");
  if (fresh) {
    const epoch = parseInt(fresh.dataset.freshEpoch, 10);
    const tick = () => {
      if (!epoch) return;
      const m = Math.max(0, Math.round((Date.now() - epoch) / 60000));
      fresh.textContent = "Last checked " + (m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`);
    };
    tick(); setInterval(tick, 30000);
  }

  // ── Deep link from the weekly email ─────────────────────────────────────────
  // /#film=<title>[&fmt=<key>] opens that film's detail card in the By-format view.
  function openFromHash() {
    const h = location.hash || "";
    const fm = h.match(/[#&]film=([^&]*)/);
    if (!fm) return;
    let want = fm[1]; try { want = decodeURIComponent(want.replace(/\+/g, " ")); } catch (e) {}
    const km = h.match(/[#&]fmt=([^&]*)/);
    let fmt = km ? km[1] : ""; try { fmt = decodeURIComponent(fmt); } catch (e) {}
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const wn = norm(want);
    if (!wn) return;
    // Land on the By-format view so the tile + its detail are the format ones.
    if (main && main.dataset.view !== "format") {
      main.dataset.view = "format";
      if (seg) {
        seg.dataset.mode = "format";
        seg.querySelectorAll(".seg-opt").forEach(o => o.classList.toggle("seg-on", o.dataset.view === "format"));
      }
      apply();
    }
    const tiles = $$(".ptile");
    let tile = fmt && tiles.find(t => norm(t.dataset.film) === wn && t.dataset.format === fmt);
    if (!tile) tile = tiles.find(t => norm(t.dataset.film) === wn);
    if (!tile) tile = tiles.find(t => { const n = norm(t.dataset.film); return n && (n.indexOf(wn) === 0 || wn.indexOf(n) === 0); });
    if (!tile) return;
    const tpl = tile.querySelector("template.ptile-detail");
    const btn = tile.querySelector(".ptile-btn");
    if (tpl) {
      try { tile.scrollIntoView({ block: "center" }); } catch (e) {}
      openModal(tpl, btn);
    }
  }
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
})();
