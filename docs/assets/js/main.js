/* Prospector Soccer Club — progressive enhancements (site works without JS). */
(() => {
  "use strict";
  document.documentElement.classList.add("js");
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Header shadow on scroll ---------- */
  const header = $("[data-header]");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- Mobile menu ---------- */
  const menu = $("[data-mobile-menu]");
  const toggle = $("[data-menu-toggle]");
  if (menu && toggle) {
    const panel = $(".mobile-menu__panel", menu);
    const open = () => {
      menu.hidden = false;
      requestAnimationFrame(() => menu.classList.add("is-open"));
      toggle.setAttribute("aria-expanded", "true");
      document.body.classList.add("menu-open");
      setTimeout(() => $("a, button", panel)?.focus(), 50);
    };
    const close = () => {
      menu.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("menu-open");
      setTimeout(() => { menu.hidden = true; }, reduceMotion ? 0 : 320);
      toggle.focus();
    };
    toggle.addEventListener("click", open);
    $$("[data-menu-close]", menu).forEach((el) => el.addEventListener("click", close));
    $$("a", menu).forEach((a) => a.addEventListener("click", () => { if (!a.href.includes("mailto:")) close(); }));
    document.addEventListener("keydown", (e) => {
      if (menu.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "Tab") { // focus trap
        const f = $$("a, button", panel);
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    window.matchMedia("(min-width: 1141px)").addEventListener("change", (m) => { if (m.matches && !menu.hidden) close(); });
  }

  /* ---------- Reveal on scroll ---------- */
  const revealEls = $$("[data-reveal]");
  if (revealEls.length && "IntersectionObserver" in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("is-in"));
  }

  /* ---------- Dates ---------- */
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

  /* ---------- Season dial ---------- */
  const dial = $("[data-season]");
  if (dial) {
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    const endOfYear = new Date(today.getFullYear() + 1, 0, 1);
    const pct = ((today - startOfYear) / (endOfYear - startOfYear)) * 100;
    const marker = $("[data-season-today]", dial);
    const label = $("[data-season-label]", dial);
    if (marker) {
      if (!reduceMotion) { marker.style.left = "0%"; requestAnimationFrame(() => setTimeout(() => { marker.style.left = pct + "%"; }, 250)); }
      else marker.style.left = pct + "%";
    }
    const scroller = $(".season__scroller", dial);
    if (scroller && scroller.scrollWidth > scroller.clientWidth) {
      scroller.scrollLeft = Math.max(0, (scroller.scrollWidth * pct) / 100 - scroller.clientWidth * 0.6);
    }
    const months = $$(".season__months span", dial);
    months[today.getMonth()]?.classList.add("is-current");
    if (label) {
      const phases = [
        [0, 1, "Competitive tryouts (by age group)"],
        [2, 2, "Spring season options for comp teams"],
        [3, 5, "Rec registration is open (Apr 1 – Jun 15)"],
        [6, 6, "Rec practices kick off mid-July"],
        [7, 10, "Fall season is underway"],
        [11, 11, "Annual General Meeting & season wrap"],
      ];
      const m = today.getMonth();
      const phase = phases.find(([a, b]) => m >= a && m <= b);
      if (phase) label.textContent = phase[2];
    }
  }

  /* ---------- Event tickets ---------- */
  const ticketList = $("[data-tickets]");
  if (ticketList) {
    const tickets = $$("[data-date]", ticketList);
    const pastHolder = $("[data-tickets-past]");
    const pastList = pastHolder && $(".tickets", pastHolder);
    let nextMarked = false;
    tickets.forEach((t) => {
      const d = parseDate(t.dataset.date);
      if (d < startOfToday) {
        t.classList.add("is-past");
        $(".ticket__add", t)?.remove();
        if (pastList) pastList.appendChild(t);
      } else if (!nextMarked) {
        nextMarked = true;
        t.classList.add("is-next");
        const flag = document.createElement("span");
        flag.className = "pill pill--gold ticket__flag";
        const days = Math.round((d - startOfToday) / 86400000);
        flag.textContent = days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
        $(".ticket__body", t)?.prepend(flag);
      }
    });
    if (pastHolder && pastList && pastList.children.length) {
      pastHolder.hidden = false;
      const c = $("[data-past-count]", pastHolder);
      if (c) c.textContent = pastList.children.length;
    }
    if (!$$("[data-date]", ticketList).length) {
      const empty = $("[data-tickets-empty]");
      if (empty) empty.hidden = false;
    }

    // Add-to-calendar (.ics)
    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const esc = (s) => s.replace(/[\\,;]/g, (c) => "\\" + c);
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".ticket__add");
      if (!btn) return;
      e.preventDefault();
      const t = btn.closest("[data-date]");
      const d = parseDate(t.dataset.date);
      const title = t.dataset.title || "Prospector Soccer Club event";
      const where = t.dataset.where || "";
      let dt;
      if (t.dataset.time) {
        const [h, mi] = t.dataset.time.split(":").map(Number);
        dt = `DTSTART;TZID=America/Los_Angeles:${fmt(d)}T${pad(h)}${pad(mi)}00`; // no end time published
      } else {
        const next = new Date(d); next.setDate(d.getDate() + 1);
        dt = `DTSTART;VALUE=DATE:${fmt(d)}\r\nDTEND;VALUE=DATE:${fmt(next)}`;
      }
      const ics = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Prospector Soccer Club//Events//EN", "BEGIN:VEVENT",
        `UID:${t.dataset.date}-${title.replace(/\W+/g, "")}@prospector.org`,
        `DTSTAMP:${fmt(new Date())}T000000Z`, dt,
        `SUMMARY:${esc("PSC: " + title)}`, `LOCATION:${esc(where)}`,
        "END:VEVENT", "END:VCALENDAR",
      ].join("\r\n");
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `psc-${t.dataset.date}.ics` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  /* ---------- Generic chip filters (teams, documents) ---------- */
  const setPressed = (group, btn) => $$("[data-filter]", group).forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));

  const teamFilters = $("[data-team-filters]");
  if (teamFilters) {
    const teams = $$("[data-gender]");
    teamFilters.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      setPressed(teamFilters, btn);
      const f = btn.dataset.filter;
      teams.forEach((t) => { t.hidden = !(f === "all" || t.dataset.gender === f); });
    });
  }

  const docSearch = $("[data-doc-search]");
  const docFilters = $("[data-doc-filters]");
  if (docSearch || docFilters) {
    let cat = "all";
    const groups = $$("[data-doc-group]");
    const empty = $("[data-doc-empty]");
    const apply = () => {
      const q = (docSearch?.value || "").trim().toLowerCase();
      let total = 0;
      groups.forEach((g) => {
        let shown = 0;
        const groupCat = g.dataset.docGroup;
        $$("[data-doc]", g).forEach((d) => {
          const li = d.closest("li") || d;
          const ok = (cat === "all" || groupCat === cat) && (!q || d.textContent.toLowerCase().includes(q));
          li.hidden = !ok;
          if (ok) shown++;
        });
        g.hidden = shown === 0;
        total += shown;
      });
      if (empty) empty.hidden = total !== 0;
    };
    docSearch?.addEventListener("input", apply);
    docFilters?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      setPressed(docFilters, btn);
      cat = btn.dataset.filter;
      apply();
    });
  }

  /* ---------- Sub-nav active state ---------- */
  const subLinks = $$(".subnav a[href^='#']");
  if (subLinks.length && "IntersectionObserver" in window) {
    const map = new Map(subLinks.map((a) => [a.getAttribute("href").slice(1), a]));
    const targets = [...map.keys()].map((id) => document.getElementById(id)).filter(Boolean);
    const so = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          subLinks.forEach((a) => a.classList.remove("is-active"));
          const a = map.get(en.target.id);
          if (a) {
            a.classList.add("is-active");
            // scroll only the chip strip horizontally — never the document
            const ul = a.closest("ul");
            const left = a.offsetLeft - (ul.clientWidth - a.offsetWidth) / 2;
            ul.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? "auto" : "smooth" });
          }
        }
      });
    }, { rootMargin: "-35% 0px -60% 0px" });
    targets.forEach((t) => so.observe(t));
    // Above the first section nothing is "current"
    const clearAtTop = () => {
      if (targets[0] && targets[0].getBoundingClientRect().top > window.innerHeight * 0.4) {
        subLinks.forEach((a) => a.classList.remove("is-active"));
      }
    };
    window.addEventListener("scroll", clearAtTop, { passive: true });
    clearAtTop();
  }

  /* ---------- Mobile action bar hides over footer ---------- */
  const bar = $("[data-action-bar]");
  const footer = $(".site-footer");
  if (bar && footer && "IntersectionObserver" in window) {
    new IntersectionObserver(([en]) => bar.classList.toggle("is-hidden", en.isIntersecting)).observe(footer);
  }
})();
