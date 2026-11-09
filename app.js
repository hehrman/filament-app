import { matchOccurrence } from "./match.js";
import {
  ApiError, cached, forgetConnection, isLocal, loadAll, loadConnection, makeSource, mutateSettings, saveConnection,
} from "./data.js";
import {
  filmographyFor, searchCatalog, searchWikidataDirectors, searchWikidataFilms, slugFromCatalog,
} from "./search.js";

const TZ = "America/New_York";
const app = document.getElementById("app");
const sheetRoot = document.getElementById("sheet-root");
const toastRoot = document.getElementById("toast-root");

const state = {
  src: null, data: null, view: "upcoming", watchTab: "directors", archiveFilter: "upcoming",
  archiveQuery: "", running: false, loading: true, error: null, results: null, query: "",
  searching: false, busy: false,
};

/* ----------------------------------------------------------- helpers */
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, w, p = w + "s") => `${n} ${n === 1 ? w : p}`;
const nyDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const todayISO = () => nyDate();
const dateObj = (iso) => new Date(`${iso}T12:00:00`);
const fmtDay = (iso, opts) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(new Date(`${iso}T12:00:00Z`));
function daysFrom(iso) { return Math.round((dateObj(iso) - dateObj(todayISO())) / 864e5); }
function relDay(iso) {
  const n = daysFrom(iso);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n > 1 && n < 7) return `In ${n} days`;
  return "";
}
function fmtWhen(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const day = nyDate(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(d);
  const diff = daysFrom(day);
  if (diff === 0) return `today at ${time}`;
  if (diff === -1) return `yesterday at ${time}`;
  if (diff === 1) return `tomorrow at ${time}`;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(d)}, ${time}`;
}
const fmtTime12 = (hhmm) => {
  const [H, M] = hhmm.split(":").map(Number);
  return `${((H + 11) % 12) + 1}:${String(M).padStart(2, "0")} ${H < 12 ? "AM" : "PM"}`;
};
const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const directorsOf = (f) => (f.directors || []).map((d) => d.name).join(", ");

const ICON = {
  upcoming: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="6"/><path d="M9 11l1.5-2.5L12 11l1.5-2.5L15 11"/><path d="M10 16v3h4v-3"/><path d="M10.5 21h3"/></svg>`,
  watch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="5" cy="7" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="5" cy="17" r="1.6"/><path d="M10 7h10M10 12h10M10 17h7"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="1.5"/><path d="M3.5 12h17"/><path d="M10 8h4M10 16h4" stroke-linecap="round"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--bg)"/><circle cx="15" cy="12" r="2" fill="var(--bg)"/><circle cx="7" cy="17" r="2" fill="var(--bg)"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>`,
};
const TURNBUCKLE = `<svg viewBox="0 0 46 12" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="6" cy="6" r="3"/><path d="M9 6h4"/><rect x="13" y="2.5" width="20" height="7" rx="3.5"/><path d="M17 6h12" stroke-dasharray="1.5 1.5"/><path d="M33 6h4"/><circle cx="40" cy="6" r="3"/></svg>`;
const lampSVG = `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="17" r="10.5" stroke="currentColor" stroke-opacity=".45" stroke-width="1.4"/><path class="filament" d="M14.5 18.5l2.2-3.5 2.2 3.5 2.2-3.5 2.2 3.5 2.2-3.5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 26.5h9v4.5h-9z" fill="#B48A45"/><path d="M15.5 28.4h9" stroke="#120F0C" stroke-opacity=".4"/><path d="M18 31h4v2.2h-4z" fill="#7A5A28"/></svg>`;
const lamp = (st, lg) => `<span class="lamp${lg ? " lamp--lg" : ""}" data-state="${st}" style="color:var(--text-2)">${lampSVG}</span>`;
const wire = `<div class="wire" aria-hidden="true">${TURNBUCKLE}</div>`;

// "A Thinking Room": brass tubes rising toward a curved gold ceiling.
function tubesArt(w = 520, hgt = 220) {
  const n = 13, gap = w / (n + 1);
  let tubes = "";
  for (let i = 1; i <= n; i++) {
    const x = gap * i;
    const arcY = 40 + Math.pow((x - w / 2) / (w / 2), 2) * 34;
    const len = 50 + ((i * 37) % 60);
    tubes += `<rect x="${x - 4}" y="${arcY + 6}" width="8" height="${hgt - arcY - 30 - (60 - len)}" rx="4" fill="url(#tube)"/>`;
  }
  return `<svg class="welcome__art" viewBox="0 0 ${w} ${hgt}" aria-hidden="true">
    <defs>
      <linearGradient id="tube" x1="0" x2="1"><stop offset="0" stop-color="#6E5124"/><stop offset=".4" stop-color="#F0D59C"/><stop offset=".65" stop-color="#B48A45"/><stop offset="1" stop-color="#5A4220"/></linearGradient>
      <linearGradient id="ceil" x1="0" x2="1"><stop offset="0" stop-color="#7C5C2A"/><stop offset=".3" stop-color="#E6C886"/><stop offset=".55" stop-color="#A9853F"/><stop offset=".8" stop-color="#EBCD8C"/><stop offset="1" stop-color="#87652F"/></linearGradient>
      <radialGradient id="warm" cx="50%" cy="20%" r="70%"><stop offset="0" stop-color="#FFB45A" stop-opacity=".22"/><stop offset="1" stop-color="#FFB45A" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${w}" height="${hgt}" fill="url(#warm)"/>
    <path d="M10 ${40 + 34} Q ${w / 2} 6 ${w - 10} ${40 + 34}" stroke="url(#ceil)" stroke-width="10" fill="none" stroke-linecap="round"/>
    ${tubes}
    <rect x="0" y="${hgt - 22}" width="${w}" height="1" fill="#C9A15B" opacity=".5"/>
  </svg>`;
}

function toast(msg, action) {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${h(msg)}</span>${action ? `<button>${h(action.label)}</button>` : ""}`;
  if (action) el.querySelector("button").onclick = () => { el.remove(); action.run(); };
  toastRoot.append(el);
  setTimeout(() => el.remove(), action ? 7000 : 3800);
}

function applyTheme() {
  let t = "system";
  try { t = localStorage.getItem("filament.theme") || "system"; } catch { /* ignore */ }
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t === "evening" ? "dark" : "light");
  return t;
}

/* ------------------------------------------------------ derived data */
const D = () => state.data || {};
const settings = () => D().settings || { directors: [], films: [], notifications: {}, schedule: { times: ["09:00", "18:00"] } };

function upcomingItems() {
  const today = todayISO();
  const s = settings();
  const disc = D().history?.discoveries || {};
  const out = [];
  for (const d of Object.values(disc)) {
    if (d.date < today || !["active", "missing"].includes(d.status)) continue;
    const reasons = matchOccurrence(d, s);
    if (!reasons.length) continue;
    out.push({ ...d, reasons, pending: false });
  }
  for (const o of Object.values(D().listings?.occurrences || {})) {
    if (o.date < today || o.status !== "active" || disc[o.key]) continue;
    const reasons = matchOccurrence(o, s);
    if (reasons.length) out.push({ ...o, reasons, pending: true, events: [] });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || toMin(a.showtimes?.[0]) - toMin(b.showtimes?.[0]));
}
function toMin(t) {
  const m = /^(\d+):(\d+)(AM|PM)$/.exec(t || "");
  if (!m) return 9999;
  return ((+m[1] % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + +m[2];
}
function recency(d) {
  const recent = (ts) => ts && Date.now() - new Date(ts).getTime() < 3 * 864e5;
  if (d.status === "missing") return { cls: "tag--gone", text: "No longer listed" };
  if (d.pending) return { cls: "tag--pending", text: "Just matched · emailed next check" };
  const ev = (d.events || []).filter((e) => recent(e.at)).pop();
  if (ev && ev.kind === "rescheduled" && ev.from_date) return { cls: "tag--update", text: `Moved from ${fmtDay(ev.from_date, { month: "short", day: "numeric" })}` };
  if (ev && ["showtime_added", "time_changed", "showtime_removed"].includes(ev.kind)) return { cls: "tag--update", text: ev.kind === "showtime_added" ? "New showtime" : "Time changed" };
  if (recent(d.discovered_at)) return { cls: "tag--new", text: "New" };
  return null;
}
const newTimes = (d) => {
  const ev = (d.events || []).filter((e) => e.kind === "showtime_added").pop();
  return new Set(ev && Date.now() - new Date(ev.at).getTime() < 3 * 864e5 ? ev.times : []);
};

/* --------------------------------------------------------- components */
function screeningCard(d, { muted } = {}) {
  const tag = recency(d);
  const fresh = newTimes(d);
  const fmt = [...new Set(d.films.map((f) => f.format).filter(Boolean))];
  const films = d.films.map((f) => `
    <h3 class="card__title">${h(f.title)}</h3>
    <div class="card__meta">${h(directorsOf(f) || "Director not listed")}${f.year ? `<span class="dot">·</span>${f.year}` : ""}${f.runtime ? `<span class="dot">·</span>${f.runtime} min` : ""}</div>`).join("");
  return `<button class="card${muted || d.status === "missing" ? " card--muted" : ""}" data-action="open" data-key="${h(d.key)}">
    <span class="card__edge plywood" aria-hidden="true"></span>
    <span class="card__body">
      ${tag || fmt.length ? `<span class="card__top">${tag ? `<span class="tag ${tag.cls}">${h(tag.text)}</span>` : ""}${fmt.map((x) => `<span class="tag tag--fmt">${h(x)}</span>`).join("")}</span>` : ""}
      ${films}
      <span class="card__where"><span class="venue">${h(d.venue)}</span>${d.series ? `<span class="series">${h(d.series)}</span>` : ""}</span>
      <span class="times">${(d.showtimes?.length ? d.showtimes : ["Time TBA"]).map((t) => `<span class="time${fresh.has(t) ? " time--new" : ""}">${h(t)}</span>`).join("")}</span>
      ${d.notes?.length ? `<span class="notes" style="display:block">✱ ${h(d.notes.join(" · "))}</span>` : ""}
    </span>
  </button>`;
}

function dayGroups(items) {
  const byDay = new Map();
  for (const it of items) { if (!byDay.has(it.date)) byDay.set(it.date, []); byDay.get(it.date).push(it); }
  return [...byDay].map(([date, its]) => `
    <section class="day" aria-label="${h(fmtDay(date, { weekday: "long", month: "long", day: "numeric" }))}">
      <div class="day__badge">
        <div class="day__num">${fmtDay(date, { day: "numeric" })}</div>
        <div class="day__dow">${fmtDay(date, { weekday: "short" })}</div>
        <div class="day__mon">${fmtDay(date, { month: "long" })}</div>
        ${relDay(date) ? `<div class="day__rel">${relDay(date)}</div>` : ""}
      </div>
      <div class="day__list">${its.map((d) => screeningCard(d)).join("")}</div>
    </section>`).join("");
}

function consoleBlock() {
  const st = D().status || {};
  const run = st.last_run;
  let lampState = "off", headline = "Waiting for the first check", meta = [];
  if (state.running) { lampState = "busy"; headline = "Checking Screen Slate now…"; meta.push("This takes about three minutes."); }
  else if (run && run.ok) {
    lampState = "on";
    const n = run.new || 0, u = run.updated || 0;
    headline = n ? `Found ${plural(n, "new screening")}` : u ? `${plural(u, "update")} to screenings you follow` : "Nothing new on Screen Slate";
  } else if (run && !run.ok) { lampState = "error"; headline = "The last check didn’t finish"; }
  if (run) meta.push(`Checked <b>${h(fmtWhen(run.finished || run.started))}</b>`);
  if (st.next_check) meta.push(`Next check <b>${h(fmtWhen(st.next_check))}</b>`);
  const ok = st.last_success;
  if (ok?.last_date_with_listings) meta.push(`Calendar read through <b>${h(fmtDay(ok.last_date_with_listings, { month: "short", day: "numeric", year: "numeric" }))}</b>`);
  if (ok?.total_screenings) meta.push(`${ok.total_screenings.toLocaleString()} NYC listings read`);
  let err = "";
  if (run && !run.ok && !state.running) {
    const why = run.error_kind === "blocked"
      ? "Screen Slate’s firewall refused GitHub’s computers this time. Filament will try again at the next scheduled time; if this keeps happening, ask Claude to switch Filament to a different runner."
      : run.error_kind === "scan" ? "Your history was left untouched, so nothing will be wrongly reported as cancelled." : "This looks like a bug — ask Claude to take a look.";
    err = `<div class="console__error"><b>What happened:</b> ${h(run.error)}<br><span style="color:var(--text-2)">${h(why)}</span></div>`;
  }
  return `<section class="console" aria-label="Status">
    <div class="console__gilt gilt" aria-hidden="true"></div>
    <div class="console__body">
      ${lamp(lampState, true)}
      <div><p class="console__headline">${headline}</p><div class="console__meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div></div>
      <button class="btn btn--brass" data-action="check" ${state.running ? "disabled" : ""}>${state.running ? "Checking…" : "Check now"}</button>
    </div>${err}
  </section>`;
}

/* ----------------------------------------------------------- views */
function viewUpcoming() {
  const items = upcomingItems();
  const s = settings();
  const names = [...s.directors.filter((d) => d.enabled !== false).map((d) => d.name), ...s.films.filter((f) => f.enabled !== false).map((f) => f.title)];
  const following = names.length ? `Following ${names.slice(0, 3).map(h).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}` : "You aren’t following anyone yet";
  const body = items.length ? dayGroups(items) : `<div class="empty">${tubesArt(360, 150)}
      <h3>No upcoming screenings yet</h3>
      <p>${D().status?.last_success ? "Nothing you follow is on Screen Slate’s NYC calendar right now. Filament checks twice a day and will email you the moment something appears." : "Once the first check runs, upcoming screenings of what you follow will appear here."}</p></div>`;
  return `<div class="page">
    <header class="page-head"><div><div class="eyebrow">Screen Slate · New York</div><h1 class="page-title">Upcoming</h1><p class="page-sub">${following}</p></div></header>
    ${consoleBlock()}
    ${items.length ? `${wire}<div style="height:22px"></div>` : ""}
    ${body}
  </div>`;
}

function upcomingCountFor(interestId) {
  return upcomingItems().filter((d) => d.status === "active" && d.reasons.some((r) => r.interest === interestId)).length;
}

function resultsBlock() {
  if (!state.query || state.query.trim().length < 2) return "";
  const r = state.results || { catalog: [], wiki: [] };
  const isDir = state.watchTab === "directors";
  const rows = [];
  for (const x of r.catalog) rows.push(`<button class="result" data-action="add-catalog" data-id="${h(isDir ? x.slug || x.name : x.slug || x.title)}">
      <div><div class="row__title">${h(isDir ? x.name : x.title)}${!isDir && x.year ? ` <span style="color:var(--text-3);font-weight:400">(${x.year})</span>` : ""}</div>
      <div class="row__sub">${h(isDir ? `Recently on Screen Slate: ${(x.films || []).slice(-3).join(", ")}` : (x.directors || []).join(", "))}</div></div>
      <span class="result__src">Screen Slate</span></button>`);
  for (const x of r.wiki) rows.push(`<button class="result" data-action="add-wiki" data-id="${h(x.qid)}">
      <div><div class="row__title">${h(isDir ? x.name : x.title)}${!isDir && x.year ? ` <span style="color:var(--text-3);font-weight:400">(${x.year})</span>` : ""}${isDir && (x.born || x.died) ? ` <span style="color:var(--text-3);font-weight:400">${x.born || ""}–${x.died || ""}</span>` : ""}</div>
      <div class="row__sub">${h(isDir ? x.description : [x.directors.join(", "), x.description].filter(Boolean).join(" · "))}</div></div>
      <span class="result__src">Wikidata</span></button>`);
  rows.push(`<button class="result" data-action="add-manual"><div><div class="row__title">Add “${h(state.query.trim())}” as typed</div>
      <div class="row__sub">${isDir ? "Matched by name against Screen Slate’s director credits" : "Matched by title against Screen Slate’s listings"}</div></div></button>`);
  const note = state.searching ? `<div class="results__note">Searching…</div>` : r.wikiError ? `<div class="results__note">Wikidata search is unavailable right now; Screen Slate results and typed names still work.</div>` : "";
  return `<div class="results" role="listbox">${rows.join("")}${note}</div>`;
}

function viewWatchlist() {
  const s = settings();
  const isDir = state.watchTab === "directors";
  const list = isDir
    ? (s.directors.length ? s.directors.map((d) => {
        const n = upcomingCountFor(d.id);
        const upcomingTitles = new Set(upcomingItems().filter((u) => u.reasons.some((r) => r.interest === d.id)).flatMap((u) => u.films.map((f) => f.title.toLowerCase())));
        const fg = d.filmography || [];
        const chip = (f) => `<span class="chip${upcomingTitles.has(f.title.toLowerCase()) ? " chip--on" : ""}"><b>${h(f.title)}</b>${f.year ? ` ${f.year}` : ""}</span>`;
        return `<article class="interest" style="${d.enabled === false ? "opacity:.6" : ""}">
          <div class="interest__head">
            <div class="monogram gilt">${h(initials(d.name))}</div>
            <div style="flex:1;min-width:0"><div class="interest__name">${h(d.name)}</div>
              <div class="interest__sub">${[d.years, fg.length ? plural(fg.length, "film") : "", n ? `<span class="interest__count">${plural(n, "upcoming screening")}</span>` : "No upcoming screenings"].filter(Boolean).join(" · ")}</div></div>
            <label class="switch" title="Monitoring on/off"><input type="checkbox" data-action="toggle" data-kind="directors" data-id="${h(d.id)}" ${d.enabled === false ? "" : "checked"} aria-label="Monitor ${h(d.name)}"><span></span></label>
            <button class="icon-btn" data-action="remove" data-kind="directors" data-id="${h(d.id)}" aria-label="Remove ${h(d.name)}">${ICON.trash}</button>
          </div>
          ${fg.length ? `<div class="filmography">${fg.slice(0, 10).map(chip).join("")}</div>${fg.length > 10 ? `<details class="more"><summary>Show all ${fg.length} films</summary><div class="filmography">${fg.slice(10).map(chip).join("")}</div></details>` : ""}` : ""}
        </article>`;
      }).join("") : `<div class="empty"><h3>No directors yet</h3><p>Search above to follow a director’s entire filmography.</p></div>`)
    : (s.films.length ? `<div class="group">${s.films.map((f) => {
        const n = upcomingCountFor(f.id);
        return `<div class="row" style="${f.enabled === false ? "opacity:.6" : ""}"><div class="row__main"><div class="row__title">${h(f.title)}${f.year ? ` <span style="color:var(--text-3);font-weight:400">(${f.year})</span>` : ""}</div>
          <div class="row__sub">${h([(f.directors || []).join(", "), f.aka?.length ? `also “${f.aka.slice(0, 2).join("”, “")}”` : ""].filter(Boolean).join(" · "))}${n ? ` · <span class="interest__count">${plural(n, "upcoming")}</span>` : ""}</div></div>
          <label class="switch"><input type="checkbox" data-action="toggle" data-kind="films" data-id="${h(f.id)}" ${f.enabled === false ? "" : "checked"} aria-label="Monitor ${h(f.title)}"><span></span></label>
          <button class="icon-btn" data-action="remove" data-kind="films" data-id="${h(f.id)}" aria-label="Remove ${h(f.title)}">${ICON.trash}</button></div>`;
      }).join("")}</div>` : `<div class="empty"><h3>No individual films yet</h3><p>Follow a single film — like <i>Eyes Wide Shut</i> — without following its director’s whole career.</p></div>`);
  return `<div class="page">
    <header class="page-head"><div><div class="eyebrow">What Filament looks for</div><h1 class="page-title">Watchlist</h1></div>
      <div class="seg" role="group" aria-label="Directors or films">
        <button data-action="tab" data-tab="directors" aria-pressed="${isDir}">Directors · ${s.directors.length}</button>
        <button data-action="tab" data-tab="films" aria-pressed="${!isDir}">Films · ${s.films.length}</button>
      </div></header>
    <div class="search">${ICON.search}<input id="q" type="search" autocomplete="off" placeholder="${isDir ? "Add a director — e.g. Stanley Kubrick" : "Add a film — e.g. Eyes Wide Shut"}" value="${h(state.query)}" aria-label="Search">
      ${resultsBlock()}</div>
    ${list}
  </div>`;
}

function viewArchive() {
  const today = todayISO();
  const s = settings();
  const all = Object.values(D().history?.discoveries || {});
  const q = state.archiveQuery.trim().toLowerCase();
  const f = state.archiveFilter;
  const rows = all.filter((d) => {
    if (f === "upcoming" && !(d.date >= today && d.status === "active")) return false;
    if (f === "past" && !(d.date < today || d.status === "past")) return false;
    if (f === "removed" && !["missing", "moved"].includes(d.status)) return false;
    if (q && !`${d.films.map((x) => x.title + " " + directorsOf(x)).join(" ")} ${d.venue}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (f === "upcoming" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  const statusTag = (d) => {
    if (d.status === "moved") return `<span class="tag tag--update">Rescheduled</span>`;
    if (d.status === "missing") return `<span class="tag tag--gone">Removed</span>`;
    if (d.date < today || d.status === "past") return `<span class="tag">Screened</span>`;
    return matchOccurrence(d, s).length ? `<span class="tag tag--new">Upcoming</span>` : `<span class="tag">Unfollowed</span>`;
  };
  const seg = [["upcoming", "Upcoming"], ["past", "Past"], ["removed", "Removed"], ["all", "All"]]
    .map(([k, l]) => `<button data-action="afilter" data-f="${k}" aria-pressed="${f === k}">${l}</button>`).join("");
  return `<div class="page">
    <header class="page-head"><div><div class="eyebrow">Everything Filament has found</div><h1 class="page-title">Archive</h1>
      <p class="page-sub">${plural(all.length, "screening")} discovered since Filament started watching.</p></div></header>
    <div class="toolbar"><div class="seg" role="group">${seg}</div><input id="aq" type="search" placeholder="Filter by film, director or venue" value="${h(state.archiveQuery)}"></div>
    ${rows.length ? `<div class="group">${rows.map((d) => `<button class="ledger-row" data-action="open" data-key="${h(d.key)}">
        <span class="ledger-date">${fmtDay(d.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
        <span><span class="row__title">${h(d.films.map((x) => x.title).join(" + "))}</span><span class="row__sub" style="display:block">${h(d.venue)} · ${h(directorsOf(d.films[0]))}${d.showtimes?.length ? ` · ${h(d.showtimes.join(", "))}` : ""}</span></span>
        ${statusTag(d)}</button>`).join("")}</div>`
      : `<div class="empty"><h3>Nothing here</h3><p>${f === "removed" ? "No screening you follow has been cancelled or moved." : "Screenings appear here as Filament discovers them."}</p></div>`}
  </div>`;
}

function viewSettings() {
  const s = settings();
  const n = s.notifications || {};
  const st = D().status || {};
  const times = s.schedule?.times || ["09:00", "18:00"];
  const theme = applyTheme();
  const sw = (key, on, lbl) => `<label class="switch"><input type="checkbox" data-action="notif" data-key="${key}" ${on ? "checked" : ""} aria-label="${h(lbl)}"><span></span></label>`;
  const prov = st.email_provider;
  const runs = (st.runs || []).slice(0, 8);
  return `<div class="page">
    <header class="page-head"><div><div class="eyebrow">Preferences</div><h1 class="page-title">Settings</h1></div></header>

    <div class="group-label">Email notifications</div>
    <div class="group">
      <div class="row"><div class="row__main"><div class="row__title">Email alerts</div><div class="row__sub">One email per check, only when something changed</div></div>${sw("email_enabled", n.email_enabled !== false, "Email alerts")}</div>
      <div class="row"><div class="row__main"><div class="row__title">Send to</div><div class="row__sub">Leave empty to use the address saved in GitHub</div></div>
        <input type="email" id="recipient" value="${h(n.recipient || "")}" placeholder="you@example.com" style="width:min(240px,46vw)"></div>
      <div class="row"><div class="row__main"><div class="row__title">New screenings</div><div class="row__sub">A film you follow appears on the calendar</div></div>${sw("notify_new", n.notify_new !== false, "New screenings")}</div>
      <div class="row"><div class="row__main"><div class="row__title">Changes</div><div class="row__sub">Rescheduled dates, new or changed showtimes</div></div>${sw("notify_changes", n.notify_changes !== false, "Changes")}</div>
      <div class="row"><div class="row__main"><div class="row__title">Cancellations</div><div class="row__sub">A screening you were told about disappears</div></div>${sw("notify_cancellations", n.notify_cancellations !== false, "Cancellations")}</div>
      <div class="row"><div class="row__main"><div class="row__title">Email service</div><div class="row__sub">${prov === "resend" ? "Resend is connected" : prov === "smtp" ? "Your mail server is connected" : "Not confirmed yet — send a test to check"}</div></div>
        <button class="btn btn--sm" data-action="test-email">Send test email</button></div>
    </div>

    <div class="group-label">Schedule</div>
    <div class="group">
      <div class="row"><div class="row__main"><div class="row__title">Morning check</div></div><input type="time" data-action="time" data-i="0" value="${h(times[0] || "09:00")}"></div>
      <div class="row"><div class="row__main"><div class="row__title">Evening check</div></div><input type="time" data-action="time" data-i="1" value="${h(times[1] || "18:00")}"></div>
    </div>
    <p class="group-foot">New York time — daylight saving is handled automatically. Checks run on GitHub’s computers, so your Mac and iPhone can be off. A check can start up to an hour late when GitHub is busy.</p>

    <div class="group-label">Recent checks</div>
    <div class="group">${runs.length ? runs.map((r) => `<div class="row"><div class="row__main"><div class="row__title">${h(fmtWhen(r.started))} <span style="color:var(--text-3);font-weight:400">· ${r.trigger === "manual" ? "Check now" : "Scheduled"}</span></div>
        <div class="row__sub">${r.ok ? `${r.dates_scanned} days read · ${plural(r.matched_upcoming || 0, "upcoming match", "upcoming matches")} · ${r.new || 0} new · ${r.updated || 0} updates${r.emailed ? ` · emailed` : ""}` : h(r.error || "Failed")}</div></div>
        <span class="tag ${r.ok ? "" : "tag--gone"}">${r.ok ? "OK" : "Failed"}</span></div>`).join("") : `<div class="row"><div class="row__main row__sub">No checks yet.</div></div>`}</div>

    <div class="group-label">Appearance</div>
    <div class="group"><div class="row"><div class="row__main"><div class="row__title">Theme</div></div>
      <div class="seg">${[["system", "Automatic"], ["evening", "Evening"], ["daylight", "Daylight"]].map(([k, l]) => `<button data-action="theme" data-t="${k}" aria-pressed="${theme === k}">${l}</button>`).join("")}</div></div></div>

    <div class="group-label">This device</div>
    <div class="group">
      <div class="row"><div class="row__main"><div class="row__title">Connected to</div><div class="row__sub">${h(state.src?.label || "")}</div></div>
        ${isLocal() ? "" : `<button class="btn btn--sm btn--danger" data-action="disconnect">Disconnect</button>`}</div>
    </div>
    <p class="group-foot">Filament reads Screen Slate’s public NYC listings (lab.screenslate.com) twice a day. Listings data © Screen Slate.</p>
  </div>`;
}

function welcome(errMsg) {
  const c = loadConnection() || {};
  return `<div class="welcome"><div class="welcome__card">
    ${tubesArt()}
    <div class="eyebrow">Filament</div>
    <h1>A quiet watch over Screen Slate.</h1>
    <p>Connect this device to your Filament data on GitHub. You only do this once per device.</p>
    ${errMsg ? `<p class="error-text">${h(errMsg)}</p>` : ""}
    <form id="connect">
      <label class="field"><span>GitHub username</span><input name="owner" autocomplete="username" autocapitalize="off" value="${h(c.owner || "")}" required></label>
      <label class="field"><span>Repository name</span><input name="repo" autocapitalize="off" value="${h(c.repo || "filament")}" required></label>
      <label class="field"><span>Access token</span><input name="token" type="password" autocomplete="off" placeholder="github_pat_…" required></label>
      <button class="btn btn--brass" style="width:100%;height:48px" ${state.busy ? "disabled" : ""}>${state.busy ? "Connecting…" : "Connect"}</button>
    </form>
    <ol class="steps">
      <li>On github.com open <b>Settings → Developer settings → Fine-grained tokens → Generate new token</b>.</li>
      <li>Repository access: <b>Only select repositories</b> → your Filament repository.</li>
      <li>Permissions: <b>Contents: Read and write</b> and <b>Actions: Read and write</b>.</li>
      <li>Copy the token and paste it above. It stays on this device only.</li>
    </ol>
  </div></div>`;
}

/* ------------------------------------------------------------ render */
const NAV = [["upcoming", "Upcoming", ICON.upcoming], ["watch", "Watchlist", ICON.watch], ["archive", "Archive", ICON.archive], ["settings", "Settings", ICON.settings]];

function render() {
  if (!state.src) { app.innerHTML = welcome(state.error); bindWelcome(); return; }
  const st = D().status || {};
  const lampState = state.running ? "busy" : st.last_run ? (st.last_run.ok ? "on" : "error") : "off";
  const counts = { upcoming: state.data ? upcomingItems().filter((d) => d.status === "active").length : "", watch: (settings().directors.length + settings().films.length) || "" };
  const view = state.loading && !state.data ? `<div class="page"><div class="skeleton" style="height:150px"></div><div class="skeleton"></div><div class="skeleton"></div></div>`
    : { upcoming: viewUpcoming, watch: viewWatchlist, archive: viewArchive, settings: viewSettings }[state.view]();
  const active = document.activeElement?.id;
  const caret = active && document.activeElement.selectionStart;
  app.innerHTML = `
    <aside class="rail">
      <a class="wordmark" href="#" data-action="nav" data-view="upcoming">${lamp(lampState)}<span class="wordmark__type">Filament</span></a>
      ${wire}
      <nav class="nav" aria-label="Sections">${NAV.map(([k, l, i]) => `<button class="nav__item" data-action="nav" data-view="${k}" ${state.view === k ? 'aria-current="page"' : ""}>${i}<span>${l}</span><span class="nav__count">${counts[k] ?? ""}</span></button>`).join("")}</nav>
      <div class="rail__foot">Watching Screen Slate’s NYC calendar.<br>${st.next_check ? `Next check ${h(fmtWhen(st.next_check))}.` : ""}</div>
    </aside>
    <main class="main" id="main">
      <div class="mobile-top"><span class="wordmark">${lamp(lampState)}<span class="wordmark__type">Filament</span></span>
        <button class="icon-btn" data-action="reload" aria-label="Refresh">${ICON.refresh}</button></div>
      ${state.error ? `<div class="console__error" style="margin:0 0 18px">${h(state.error)}</div>` : ""}
      ${view}
    </main>
    <nav class="tabbar" aria-label="Sections">${NAV.map(([k, l, i]) => `<button class="tab" data-action="nav" data-view="${k}" ${state.view === k ? 'aria-current="page"' : ""}>${i}<span>${l}</span></button>`).join("")}</nav>`;
  if (active) {
    const el = document.getElementById(active);
    if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* not a text input */ } }
  }
}

/* --------------------------------------------------------- the sheet */
function findItem(key) {
  return upcomingItems().find((d) => d.key === key) || D().history?.discoveries?.[key] || D().listings?.occurrences?.[key];
}
const EVENT_TEXT = {
  discovered: (e) => e.how === "newly_watched" ? "Matched a newly added interest" : e.how === "initial" ? "Found on Filament’s first check" : "Newly listed on Screen Slate",
  showtime_added: (e) => `New showtime: ${(e.times || []).join(", ")}`,
  showtime_removed: (e) => `Showtime dropped: ${(e.times || []).join(", ")}`,
  time_changed: (e) => `Times changed from ${(e.before || []).join(", ")} to ${(e.after || []).join(", ")}`,
  rescheduled: (e) => e.from_date ? `Moved here from ${fmtDay(e.from_date, { month: "short", day: "numeric" })}` : `Moved to ${fmtDay(e.to_date, { month: "short", day: "numeric" })}`,
  removed: () => "Disappeared from Screen Slate’s listing",
  reappeared: () => "Reappeared on Screen Slate’s listing",
};
function openSheet(key) {
  const d = findItem(key);
  if (!d) return;
  const reasons = d.reasons || matchOccurrence(d, settings());
  const facts = [
    ["Date", fmtDay(d.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })],
    ["Showtimes", (d.showtimes || []).join(", ") || "Time TBA"],
    ["Venue", d.venue], d.series ? ["Series", d.series] : null,
    ...d.films.flatMap((f, i) => [[d.films.length > 1 ? `Film ${i + 1}` : "Director", d.films.length > 1 ? `${f.title} — ${directorsOf(f)}` : directorsOf(f) || "Not listed"],
      f.format ? ["Format", f.format] : null, f.runtime ? ["Runtime", `${f.runtime} minutes`] : null]),
    d.notes?.length ? ["Notes", d.notes.join(" · ")] : null,
    reasons.length ? ["Why", [...new Set(reasons.map((r) => r.kind === "film" ? `You follow “${r.label}”` : `You follow ${r.label}`))].join("; ")] : null,
  ].filter(Boolean);
  const evs = (d.events || []).slice().reverse();
  sheetRoot.innerHTML = `<div class="scrim" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet__grab"></div>
      <div class="console__gilt gilt" style="height:5px;margin:10px 26px 0;border-radius:3px"></div>
      <div class="sheet__hero">
        <button class="icon-btn sheet__close" data-action="close-sheet" aria-label="Close">${ICON.close}</button>
        <div class="eyebrow">${h(relDay(d.date) || fmtDay(d.date, { weekday: "long" }))} · ${h(d.venue)}</div>
        <h2 class="sheet__title" id="sheet-title">${h(d.films.map((f) => f.title).join(" + "))}</h2>
        <div class="card__meta">${h(d.films.map((f) => [directorsOf(f), f.year].filter(Boolean).join(", ")).join(" · "))}</div>
      </div>
      <div class="sheet__section"><dl class="facts">${facts.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join("")}</dl></div>
      <div class="sheet__section"><div class="actions">
        <a class="btn btn--brass" href="${h(d.listing_url)}" target="_blank" rel="noopener">Open on Screen Slate</a>
        ${d.film_url ? `<a class="btn" href="${h(d.film_url)}" target="_blank" rel="noopener">Film page</a>` : ""}
        ${d.ticket_url ? `<a class="btn" href="${h(d.ticket_url)}" target="_blank" rel="noopener">Tickets</a>` : ""}
      </div></div>
      ${evs.length || d.discovered_at ? `<div class="sheet__section">${wire}<div class="group-label" style="margin-top:14px">History</div><ul class="timeline">
        ${evs.map((e) => `<li>${h((EVENT_TEXT[e.kind] || (() => e.kind))(e))}<time>${h(fmtWhen(e.at))}</time></li>`).join("")}
        ${d.first_listed ? `<li>First seen on Screen Slate<time>${h(fmtWhen(d.first_listed))}</time></li>` : ""}</ul></div>` : ""}
    </div>`;
  sheetRoot.querySelector(".sheet__close").focus();
}
const closeSheet = () => { sheetRoot.innerHTML = ""; };

/* ----------------------------------------------------------- actions */
async function refresh(quiet) {
  if (!state.src) return;
  state.loading = true;
  if (!quiet) render();
  try {
    state.data = await loadAll(state.src);
    state.error = null;
    state.running = !!(await state.src.activeRun().catch(() => null));
    if (state.running) pollRun();
  } catch (e) {
    state.error = e instanceof ApiError ? e.message : `Couldn’t load your data: ${e.message}`;
  }
  state.loading = false;
  render();
}

let polling = false;
async function pollRun() {
  if (polling) return;
  polling = true;
  while (true) {
    await new Promise((r) => setTimeout(r, 8000));
    const run = await state.src.activeRun().catch(() => null);
    if (!run) break;
  }
  polling = false;
  state.running = false;
  await refresh(true);
  toast("Check finished");
}

async function saveSettings(fn, msg, okText) {
  // optimistic local update, then a safe read-modify-write on GitHub
  const local = structuredClone(settings());
  fn(local);
  state.data.settings = local;
  render();
  try {
    state.data.settings = await mutateSettings(state.src, fn, msg);
    if (okText) toast(okText);
  } catch (e) {
    toast(e.message || "Couldn’t save");
    await refresh(true);
  }
}

let searchTimer = 0, searchSeq = 0;
function runSearch(q) {
  state.query = q;
  clearTimeout(searchTimer);
  if (q.trim().length < 2) { state.results = null; render(); return; }
  const kind = state.watchTab === "directors" ? "director" : "film";
  state.results = { catalog: searchCatalog(D().catalog, q, kind), wiki: state.results?.wiki || [] };
  state.searching = true;
  render();
  const seq = ++searchSeq;
  searchTimer = setTimeout(async () => {
    let wiki = [], wikiError = false;
    try { wiki = kind === "director" ? await searchWikidataDirectors(q) : await searchWikidataFilms(q); } catch { wikiError = true; }
    if (seq !== searchSeq) return;
    state.searching = false;
    state.results = { catalog: searchCatalog(D().catalog, q, kind), wiki, wikiError };
    render();
  }, 350);
}

const uid = (prefix, s) => `${prefix}-${s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36).slice(-4)}`;

async function addInterest(entry, kind) {
  const list = kind === "directors" ? "directors" : "films";
  const label = entry.name || entry.title;
  const dup = settings()[list].find((x) => (entry.tmdb && x.tmdb === entry.tmdb) || (x.name || x.title).toLowerCase() === label.toLowerCase() && (!entry.year || !x.year || entry.year === x.year));
  if (dup) { toast(`You already follow ${label}`); return; }
  state.query = ""; state.results = null;
  await saveSettings((s) => { s[list].push(entry); }, `Follow ${label}`, `Now following ${label}`);
}

async function onAction(el, ev) {
  const a = el.dataset.action;
  if (a === "nav") { ev.preventDefault(); state.view = el.dataset.view; state.query = ""; state.results = null; render(); window.scrollTo({ top: 0 }); return; }
  if (a === "open") return openSheet(el.dataset.key);
  if (a === "close-sheet") return closeSheet();
  if (a === "reload") return refresh();
  if (a === "tab") { state.watchTab = el.dataset.tab; state.query = ""; state.results = null; return render(); }
  if (a === "afilter") { state.archiveFilter = el.dataset.f; return render(); }
  if (a === "theme") { try { localStorage.setItem("filament.theme", el.dataset.t); } catch { /* ignore */ } applyTheme(); return render(); }
  if (a === "check") {
    try { await state.src.dispatch("check-now"); state.running = true; render(); toast("Checking Screen Slate — about three minutes"); pollRun(); }
    catch (e) { toast(e.message); }
    return;
  }
  if (a === "test-email") {
    try { await state.src.dispatch("test-email"); toast("Test email requested — it should arrive within a couple of minutes"); }
    catch (e) { toast(e.message); }
    return;
  }
  if (a === "disconnect") {
    if (!confirm("Disconnect this device? Your watchlist and history stay safe on GitHub.")) return;
    forgetConnection(); state.src = null; state.data = null; return render();
  }
  if (a === "remove") {
    const kind = el.dataset.kind, id = el.dataset.id;
    const item = settings()[kind].find((x) => x.id === id);
    if (!item) return;
    await saveSettings((s) => { s[kind] = s[kind].filter((x) => x.id !== id); }, `Stop following ${item.name || item.title}`);
    toast(`Stopped following ${item.name || item.title}`, { label: "Undo", run: () => saveSettings((s) => { if (!s[kind].some((x) => x.id === id)) s[kind].push(item); }, `Follow ${item.name || item.title}`) });
    return;
  }
  if (a === "add-manual") {
    const q = state.query.trim();
    if (state.watchTab === "directors") await addInterest({ id: uid("dir", q), name: q, aka: [], filmography: [], added: todayISO(), enabled: true }, "directors");
    else await addInterest({ id: uid("film", q), title: q, aka: [], directors: [], added: todayISO(), enabled: true }, "films");
    return;
  }
  if (a === "add-catalog") {
    const isDir = state.watchTab === "directors";
    const pool = isDir ? D().catalog?.directors : D().catalog?.films;
    const x = Object.values(pool || {}).find((v) => (isDir ? v.slug || v.name : v.slug || v.title) === el.dataset.id);
    if (!x) return;
    if (isDir) {
      // Try to enrich with a filmography from Wikidata (by TMDB id), but never block on it.
      let filmography = [], qid = null, aka = [];
      try {
        const hits = await searchWikidataDirectors(x.name);
        const hit = hits.find((w) => w.tmdb && w.tmdb === x.tmdb) || hits[0];
        if (hit && (!x.tmdb || hit.tmdb === x.tmdb)) { qid = hit.qid; aka = hit.aka; filmography = await filmographyFor(hit.qid); }
      } catch { /* offline: fine */ }
      await addInterest({ id: uid("dir", x.name), name: x.name, tmdb: x.tmdb || null, slug: x.slug || null, wikidata: qid, aka, filmography, added: todayISO(), enabled: true }, "directors");
    } else {
      await addInterest({ id: uid("film", x.title), title: x.title, year: x.year || null, slug: x.slug || null, directors: x.directors || [], aka: [], added: todayISO(), enabled: true }, "films");
    }
    return;
  }
  if (a === "add-wiki") {
    const x = (state.results?.wiki || []).find((w) => w.qid === el.dataset.id);
    if (!x) return;
    if (state.watchTab === "directors") {
      toast(`Adding ${x.name}…`);
      let filmography = [];
      try { filmography = await filmographyFor(x.qid); } catch { /* still useful without it */ }
      const years = x.born ? `${x.born}–${x.died || ""}` : undefined;
      await addInterest({ id: uid("dir", x.name), name: x.name, tmdb: x.tmdb, slug: slugFromCatalog(D().catalog, x.tmdb, x.name), wikidata: x.qid, aka: x.aka, years, filmography, added: todayISO(), enabled: true }, "directors");
    } else {
      await addInterest({ id: uid("film", x.title), title: x.title, year: x.year, directors: x.directors, aka: x.aka, wikidata: x.qid, added: todayISO(), enabled: true }, "films");
    }
  }
}

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el || el.tagName === "INPUT") return;
  onAction(el, ev);
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.action === "toggle") {
    const { kind, id } = el.dataset, on = el.checked;
    saveSettings((s) => { const x = s[kind].find((i) => i.id === id); if (x) x.enabled = on; }, `${on ? "Resume" : "Pause"} monitoring`, on ? "Monitoring resumed" : "Paused");
  } else if (el.dataset.action === "notif") {
    const k = el.dataset.key, on = el.checked;
    saveSettings((s) => { s.notifications = { ...(s.notifications || {}), [k]: on }; }, "Update notification settings", "Saved");
  } else if (el.dataset.action === "time") {
    const i = Number(el.dataset.i), v = el.value;
    if (!/^\d\d:\d\d$/.test(v)) return;
    const next = [...(settings().schedule?.times || ["09:00", "18:00"])];
    next[i] = v;
    saveSettings((s) => { s.schedule = s.schedule || { timezone: TZ }; const t = [...(s.schedule.times || ["09:00", "18:00"])]; t[i] = v; s.schedule.times = t; },
      "Change check times", `Checks at ${next.map(fmtTime12).join(" and ")}`);
  } else if (el.id === "recipient") {
    const v = el.value.trim();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast("That doesn’t look like an email address"); return; }
    saveSettings((s) => { s.notifications = { ...(s.notifications || {}), recipient: v }; }, "Update email address", "Saved");
  }
});
document.addEventListener("input", (ev) => {
  if (ev.target.id === "q") runSearch(ev.target.value);
  if (ev.target.id === "aq") { state.archiveQuery = ev.target.value; render(); }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") { if (sheetRoot.innerHTML) closeSheet(); else if (state.query) { state.query = ""; state.results = null; render(); } }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.src) refresh(true); });

function bindWelcome() {
  const form = document.getElementById("connect");
  if (!form) return;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const conn = { owner: f.get("owner").trim(), repo: f.get("repo").trim(), token: f.get("token").trim() };
    state.busy = true; state.error = null; render();
    try {
      const src = makeSource(conn);
      await src.verify();
      conn.branch = src.branch;
      saveConnection(conn);
      state.src = src; state.busy = false;
      await refresh();
    } catch (e) {
      state.busy = false; state.error = e.message; state.src = null; render();
    }
  };
}

/* -------------------------------------------------------------- boot */
applyTheme();
const conn = loadConnection();
if (isLocal() || conn) {
  state.src = makeSource(conn || {});
  const c = cached();
  if (c?.data && !isLocal()) { state.data = c.data; state.loading = false; }
  render();
  refresh(!!state.data);
} else {
  state.loading = false;
  render();
}
