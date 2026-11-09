import { creditIsDirector, fold, matchFilm, matchOccurrence } from "./match.js?v=20261109194837";
import {
  ApiError, cached, forgetConnection, isLocal, loadAll, loadConnection, makeSource, mutateSettings, saveConnection,
} from "./data.js?v=20261109194837";
import { followList, forYou, importExport, lookup, lovedDirectors, stars } from "./letterboxd.js?v=20261109194837";
import {
  filmographyFor, searchCatalog, searchWikidataDirectors, searchWikidataFilms, slugFromCatalog,
} from "./search.js?v=20261109194837";

const TZ = "America/New_York";
const app = document.getElementById("app");
const sheetRoot = document.getElementById("sheet-root");
const toastRoot = document.getElementById("toast-root");

const state = {
  src: null, data: null, view: "upcoming", watchTab: "directors", archiveFilter: "upcoming",
  archiveQuery: "", running: false, loading: true, error: null, results: null, query: "",
  searching: false, busy: false, find: "",
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
  calendar: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`,
  share: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3.5M8 7l4-4 4 4"/><path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 10H17"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>`,
};
const TURNBUCKLE = `<svg viewBox="0 0 46 12" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="6" cy="6" r="3"/><path d="M9 6h4"/><rect x="13" y="2.5" width="20" height="7" rx="3.5"/><path d="M17 6h12" stroke-dasharray="1.5 1.5"/><path d="M33 6h4"/><circle cx="40" cy="6" r="3"/></svg>`;
const lampSVG = `<svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="17" r="10.5" stroke="currentColor" stroke-opacity=".45" stroke-width="1.4"/><path class="filament" d="M14.5 18.5l2.2-3.5 2.2 3.5 2.2-3.5 2.2 3.5 2.2-3.5" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 26.5h9v4.5h-9z" fill="#B48A45"/><path d="M15.5 28.4h9" stroke="#120F0C" stroke-opacity=".4"/><path d="M18 31h4v2.2h-4z" fill="#7A5A28"/></svg>`;
const lamp = (st, lg) => `<span class="lamp${lg ? " lamp--lg" : ""}" data-state="${st}" style="color:var(--text-2)">${lampSVG}</span>`;
const wireEl = () => `<div class="wire${state.running ? " wire--live" : ""}" aria-hidden="true">${TURNBUCKLE}<span class="wire__spark"></span></div>`;

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
const settings = () => D().settings || { directors: [], films: [], notifications: {}, schedule: { times: ["09:00"] } };
const lbData = () => D().letterboxd || null;
const lbCfg = () => settings().letterboxd || {};
let interestsMemo = { s: null, l: null, v: null };
/** Everything Filament follows: your directors & films plus Letterboxd favourites. */
function interests() {
  const s = settings(), l = lbData();
  if (interestsMemo.s !== s || interestsMemo.l !== l) interestsMemo = { s, l, v: { ...s, _letterboxd: followList(l, s.letterboxd) } };
  return interestsMemo.v;
}
let upcomingMemo = { k: null, v: null };
function upcomingItems() {
  const key = [D(), interests(), todayISO()];
  if (upcomingMemo.k && upcomingMemo.k.every((x, i) => x === key[i])) return upcomingMemo.v;
  upcomingMemo = { k: key, v: computeUpcoming() };
  return upcomingMemo.v;
}
function computeUpcoming() {
  const today = todayISO();
  const s = interests();
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
/** A director's portrait (Wikimedia Commons) over their initials, which show if there's no photo. */
function personPhoto(name, tmdb, photo) {
  if (photo) return photo;
  const ppl = D().people?.people || {};
  const k = tmdb ? `t${tmdb}` : `n${(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  return ppl[k]?.photo || null;
}
function avatar(name, tmdb, photo, cls = "") {
  const src = personPhoto(name, tmdb, photo);
  return `<span class="avatar gilt ${cls}"><span class="avatar__i">${h(initials(name || "?"))}</span>${src ? `<img src="${h(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>`;
}
/** Poster for a followed film, from what Filament has seen in the listings. */
function catalogPoster(f) {
  const films = D().catalog?.films || {};
  const hit = (f.slug && films[f.slug]) || Object.values(films).find((x) => x.poster && x.title.toLowerCase() === (f.title || "").toLowerCase() && (!f.year || !x.year || Math.abs(x.year - f.year) <= 1));
  return hit?.poster || null;
}

const posterImg = (src, cls) => src
  ? `<img class="${cls}" src="${h(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : "";

function seenTag(films) {
  const rec = films.map((f) => lookup(lbData(), f)).find((r) => r && r.w);
  if (!rec) return "";
  return `<span class="tag tag--seen" title="From your Letterboxd">${rec.r ? `Seen · ${stars(rec.r)}` : "Seen"}</span>`;
}

function screeningCard(d, { muted } = {}) {
  const tag = recency(d);
  const seen = seenTag(d.films);
  const fresh = newTimes(d);
  const fmt = [...new Set(d.films.map((f) => f.format).filter(Boolean))];
  const films = d.films.map((f) => `
    <h3 class="card__title">${h(f.title)}</h3>
    <div class="card__meta">${h(directorsOf(f) || "Director not listed")}${f.year ? `<span class="dot">·</span>${f.year}` : ""}${f.runtime ? `<span class="dot">·</span>${f.runtime} min` : ""}</div>`).join("");
  return `<button class="card${muted || d.status === "missing" ? " card--muted" : ""}" data-action="open" data-key="${h(d.key)}">
    <span class="card__edge plywood" aria-hidden="true"></span>
    <span class="card__body">
      ${posterImg(d.poster, "card__poster")}
      <span class="card__content">
      ${tag || fmt.length || seen ? `<span class="card__top">${tag ? `<span class="tag ${tag.cls}">${h(tag.text)}</span>` : ""}${fmt.map((x) => `<span class="tag tag--fmt">${h(x)}</span>`).join("")}${seen}</span>` : ""}
      ${films}
      <span class="card__where"><span class="venue">${h(d.venue)}</span>${d.series ? `<span class="series">${h(d.series)}</span>` : ""}</span>
      <span class="times">${(d.showtimes?.length ? d.showtimes : ["Time TBA"]).map((t) => `<span class="time${fresh.has(t) ? " time--new" : ""}">${h(t)}</span>`).join("")}</span>
      ${d.notes?.length ? `<span class="notes" style="display:block">✱ ${h(d.notes.join(" · "))}</span>` : ""}
      </span>
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

function nextCheckISO() {
  const [hh, mm] = (settings().schedule?.times?.[0] || "09:00").split(":").map(Number);
  const now = new Date();
  for (let add = 0; add < 3; add++) {
    const at = nyToUTC(nyDate(new Date(now.getTime() + add * 864e5)), hh, mm);
    if (at > now) return at.toISOString();
  }
  return null;
}

function consoleBlock() {
  const st = D().status || {};
  const run = st.last_run;
  let lampState = "off", headline = "Waiting for the first check", meta = [];
  if (state.running) { lampState = "busy"; headline = "Checking today’s listings…"; meta.push("This takes about three minutes."); }
  else if (run && run.ok) {
    lampState = "on";
    const n = run.new || 0, u = run.updated || 0;
    headline = n ? `Found ${plural(n, "new screening")}` : u ? `${plural(u, "update")} to screenings you follow` : "Nothing new";
  } else if (run && !run.ok) { lampState = "error"; headline = "The last check didn’t finish"; }
  if (run) meta.push(`Checked <b>${h(fmtWhen(run.finished || run.started))}</b>`);
  const next = nextCheckISO();
  if (next) meta.push(`Next check <b>${h(fmtWhen(next))}</b>`);
  const ok = st.last_success;
  if (ok?.last_date_with_listings) meta.push(`Listings published through <b>${h(fmtDay(ok.last_date_with_listings, { month: "short", day: "numeric", year: "numeric" }))}</b>`);
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

/* --------------------------------------------- "Is it playing?" search */
const isFollowingCredit = (c) => settings().directors.some((d) => creditIsDirector(c, d));
const isFollowingFilm = (f) => settings().films.some((x) => matchFilm(f, x));
const isLetterboxdFollow = (f) => (interests()._letterboxd || []).some((x) => matchFilm(f, x));
const filmIndex = new Map();   // key -> film, for follow buttons

function findGroups(q) {
  const qq = fold(q).trim();
  const today = todayISO();
  const groups = new Map();
  for (const o of Object.values(D().listings?.occurrences || {})) {
    if (o.status !== "active" || o.date < today) continue;
    for (const f of o.films) {
      const hay = fold([f.title, ...(f.directors || []).map((x) => x.name)].join(" | "));
      if (!hay.includes(qq) && !fold(o.venue).includes(qq) && !fold(o.series || "").includes(qq)) continue;
      const k = f.slug || f.title;
      if (!groups.has(k)) groups.set(k, { key: k, film: f, poster: o.poster, occs: new Map() });
      const g = groups.get(k);
      g.poster = g.poster || o.poster;
      g.occs.set(o.key, o);
    }
  }
  const rank = (g) => (fold(g.film.title).startsWith(qq) ? 0 : fold(g.film.title).includes(qq) ? 1
    : (g.film.directors || []).some((d) => fold(d.name).includes(qq)) ? 2 : 3);
  return [...groups.values()].map((g) => ({ ...g, occs: [...g.occs.values()].sort((a, b) => a.date.localeCompare(b.date) || toMin(a.showtimes?.[0]) - toMin(b.showtimes?.[0])) }))
    .sort((a, b) => rank(a) - rank(b) || a.occs[0].date.localeCompare(b.occs[0].date)).slice(0, 40);
}

function followButtons(films) {
  const out = [];
  const seen = new Set();
  for (const f of films) {
    for (const c of f.directors || []) {
      const k = c.tmdb || c.name;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(isFollowingCredit(c)
        ? `<span class="tag tag--following">Following ${h(c.name)}</span>`
        : `<button class="btn btn--sm" data-action="follow-dir" data-name="${h(c.name)}" data-tmdb="${h(c.tmdb || "")}" data-slug="${h(c.slug || "")}">+ Follow ${h(c.name)}</button>`);
    }
    const fk = f.slug || f.title;
    filmIndex.set(fk, f);
    if ((f.directors || []).some(isFollowingCredit)) continue;   // already covered by a followed director
    if (isLetterboxdFollow(f)) { out.push(`<span class="tag tag--following">Following via Letterboxd</span>`); continue; }
    out.push(isFollowingFilm(f)
      ? `<span class="tag tag--following">Following this film</span>`
      : `<button class="btn btn--sm" data-action="follow-film" data-fk="${h(fk)}">+ Follow “${h(f.title)}”</button>`);
  }
  return out.join("");
}

function viewFind() {
  const q = state.find.trim();
  const groups = findGroups(q);
  const list = groups.map((g) => {
    const f = g.film;
    const slots = g.occs.slice(0, 6).map((o) => `<button class="slot" data-action="open" data-key="${h(o.key)}">
        <b>${h(fmtDay(o.date, { weekday: "short", month: "short", day: "numeric" }))}</b> · ${h(o.venue)} · ${h((o.showtimes || []).slice(0, 3).join(", ") || "Time TBA")}${(o.showtimes || []).length > 3 ? "…" : ""}</button>`).join("");
    return `<article class="find">
      ${posterImg(g.poster, "find__poster")}
      <div class="find__main">
        ${seenTag([f]) ? `<div class="card__top">${seenTag([f])}</div>` : ""}
        <h3 class="card__title">${h(f.title)}</h3>
        <div class="card__meta">${h(directorsOf(f) || "Director not listed")}${f.year ? `<span class="dot">·</span>${f.year}` : ""}${f.runtime ? `<span class="dot">·</span>${f.runtime} min` : ""}</div>
        <div class="find__slots">${slots}${g.occs.length > 6 ? `<span class="slot slot--more">+${g.occs.length - 6} more dates</span>` : ""}</div>
        <div class="find__follow">${followButtons([f])}</div>
      </div>
    </article>`;
  }).join("");
  return `<div class="find-head"><span>${groups.length ? `<b>${plural(groups.length, "film")}</b> playing in New York matching “${h(q)}”` : `Nothing playing in New York matches “${h(q)}”`}</span>
      <button class="btn btn--sm btn--ghost" data-action="find-clear">Clear</button></div>
    ${groups.length ? list : `<div class="empty"><h3>Not playing in New York right now</h3>
      <p>Follow it and Filament will email you the moment it’s scheduled.</p>
      <div class="actions" style="justify-content:center;margin-top:16px">
        <button class="btn btn--brass" data-action="follow-typed" data-kind="films">Follow “${h(q)}” as a film</button>
        <button class="btn" data-action="follow-typed" data-kind="directors">Follow “${h(q)}” as a director</button>
      </div></div>`}`;
}

function forYouBlock() {
  const l = lbData();
  if (!l?.films || lbCfg().enabled === false) return "";
  const followed = (o) => matchOccurrence(o, interests()).length > 0;
  const picks = forYou(Object.values(D().listings?.occurrences || {}), l, followed, todayISO());
  if (!picks.length) return "";
  return `<section class="foryou" aria-label="For you">
    <div class="foryou__head"><div><div class="eyebrow">Based on your Letterboxd</div><h2 class="section-title">For you</h2></div></div>
    <div class="foryou__rail">${picks.map((g) => {
      const o = g.occs[0];
      return `<article class="pick">
        <button class="pick__open" data-action="open" data-key="${h(o.key)}" aria-label="${h(g.film.title)}">
          <span class="pick__art">${posterImg(g.poster, "pick__poster")}</span>
          <span class="pick__title">${h(g.film.title)}</span>
          <span class="pick__why">${h(g.why)}</span>
          <span class="pick__when"><b>${h(fmtDay(o.date, { weekday: "short", month: "short", day: "numeric" }))}</b> · ${h(o.venue)}${g.occs.length > 1 ? ` · +${g.occs.length - 1} more` : ""}</span>
        </button>
        <div class="pick__follow">${followButtons([g.film])}</div>
      </article>`;
    }).join("")}</div>
  </section>`;
}

/* ----------------------------------------------------------- views */
function viewUpcoming() {
  const items = upcomingItems();
  const s = settings();
  const names = [...s.directors.filter((d) => d.enabled !== false).map((d) => d.name), ...s.films.filter((f) => f.enabled !== false).map((f) => f.title)];
  const lbn = (interests()._letterboxd || []).length;
  if (lbn) names.push(`${lbn} Letterboxd favorites`);
  const following = names.length ? `Following ${names.slice(0, 3).map(h).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}` : "You aren’t following anyone yet";
  const body = items.length ? dayGroups(items) : `<div class="empty">${tubesArt(360, 150)}
      <h3>No upcoming screenings yet</h3>
      <p>${D().status?.last_success ? "Nothing you follow is playing in New York right now. Filament checks every morning and will email you the moment something appears." : "Once the first check runs, upcoming screenings of what you follow will appear here."}</p></div>`;
  return `<div class="page">
    ${state.find.trim().length >= 2
      ? `<header class="page-head"><div><div class="eyebrow">Search all of New York</div><h1 class="page-title">Is it playing?</h1><p class="page-sub">Every screening in New York — not just what you follow.</p></div></header>`
      : `<header class="page-head"><div><div class="eyebrow">New York</div><h1 class="page-title">Upcoming</h1><p class="page-sub">${following}</p></div></header>`}
    <div class="search search--find">${ICON.search}<input id="find" type="search" autocomplete="off" placeholder="Is it playing? Search films & directors" value="${h(state.find)}" aria-label="Search everything playing in New York"></div>
    ${state.find.trim().length >= 2 ? viewFind() : `
    ${consoleBlock()}
    ${items.length ? `${wireEl()}<div style="height:22px"></div>` : ""}
    ${body}
    ${forYouBlock()}`}
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
      ${isDir ? avatar(x.name, x.tmdb, null, "avatar--sm") : posterImg(x.poster, "row__poster")}<div><div class="row__title">${h(isDir ? x.name : x.title)}${!isDir && x.year ? ` <span style="color:var(--text-3);font-weight:400">(${x.year})</span>` : ""}</div>
      <div class="row__sub">${h(isDir ? `Recently playing: ${(x.films || []).slice(-3).join(", ")}` : (x.directors || []).join(", "))}</div></div>
      <span class="result__src">In NYC listings</span></button>`);
  for (const x of r.wiki) rows.push(`<button class="result" data-action="add-wiki" data-id="${h(x.qid)}">
      ${isDir ? avatar(x.name, x.tmdb, x.photo, "avatar--sm") : ""}<div><div class="row__title">${h(isDir ? x.name : x.title)}${!isDir && x.year ? ` <span style="color:var(--text-3);font-weight:400">(${x.year})</span>` : ""}${isDir && (x.born || x.died) ? ` <span style="color:var(--text-3);font-weight:400">${x.born || ""}–${x.died || ""}</span>` : ""}</div>
      <div class="row__sub">${h(isDir ? x.description : [x.directors.join(", "), x.description].filter(Boolean).join(" · "))}</div></div>
      <span class="result__src">Film database</span></button>`);
  rows.push(`<button class="result" data-action="add-manual"><div><div class="row__title">Add “${h(state.query.trim())}” as typed</div>
      <div class="row__sub">${isDir ? "Matched by name against the directors in the listings" : "Matched by title against the listings"}</div></div></button>`);
  const note = state.searching ? `<div class="results__note">Searching…</div>` : r.wikiError ? `<div class="results__note">The film database is unavailable right now; NYC listing results and typed names still work.</div>` : "";
  return `<div class="results" role="listbox">${rows.join("")}${note}</div>`;
}

function viewLetterboxd() {
  const l = lbData(), cfg = lbCfg();
  const connected = l?.films && Object.keys(l.films).length && cfg.enabled !== false;
  const importBtn = `<label class="btn btn--brass file-btn">${connected ? "Re-import export" : "Import your Letterboxd export"}<input type="file" accept=".zip,application/zip" data-action="lb-import" hidden></label>`;
  if (!connected) {
    return `<div class="empty lb-empty"><h3>Bring your Letterboxd</h3>
      <p>Follow every film you’ve rated highly, see what you’ve already watched, and get suggestions for what’s playing.</p>
      <div class="actions" style="justify-content:center;margin-top:18px">${importBtn}</div>
      <p class="group-foot" style="margin-top:16px">On letterboxd.com: <b>Settings → Data → Export your data</b>. Upload the .zip here — only film titles, years, ratings and your watchlist are kept.</p></div>`;
  }
  const films = Object.values(l.films);
  const rated = films.filter((f) => f.r).length, wl = films.filter((f) => f.wl).length;
  const follows = interests()._letterboxd || [];
  const minR = Number(cfg.min_rating ?? 4.5);
  const n = upcomingItems().filter((d) => d.status === "active" && d.reasons.some((r) => r.kind === "letterboxd")).length;
  const loved = lovedDirectors(l).slice(0, 12);
  const sw = (key, on, lbl) => `<label class="switch"><input type="checkbox" data-action="lb-set" data-key="${key}" ${on ? "checked" : ""} aria-label="${h(lbl)}"><span></span></label>`;
  return `<div class="group">
      <div class="row"><div class="monogram gilt">LB</div><div class="row__main"><div class="row__title">${h(cfg.username || "Letterboxd")}</div>
        <div class="row__sub">${rated} rated · ${films.filter((f) => f.w).length} watched · ${wl} on watchlist${l.rss_synced_at ? ` · synced ${h(fmtWhen(l.rss_synced_at))}` : ""}</div></div>${importBtn}</div>
      <div class="row"><div class="row__main"><div class="row__title">Follow films I rated</div><div class="row__sub">${follows.length} films followed automatically${n ? ` · <span class="interest__count">${plural(n, "upcoming screening")}</span>` : ""}</div></div>
        <div class="seg">${[[5, "★★★★★"], [4.5, "★★★★½+"], [4, "★★★★+"]].map(([v, l2]) => `<button data-action="lb-min" data-v="${v}" aria-pressed="${minR === v}">${l2}</button>`).join("")}</div></div>
      <div class="row"><div class="row__main"><div class="row__title">Also follow my watchlist</div><div class="row__sub">${plural(wl, "film")} you want to see</div></div>${sw("include_watchlist", !!cfg.include_watchlist, "Follow watchlist")}</div>
      <div class="row"><div class="row__main"><div class="row__title">Sync new ratings every morning</div><div class="row__sub">Reads your public Letterboxd diary, so new favorites are followed automatically</div></div>${sw("sync_rss", cfg.sync_rss !== false, "Sync daily")}</div>
    </div>
    ${loved.length ? `<div class="group-label">Directors you love</div>
    <div class="group">${loved.map((d) => {
      const c = { name: d.name, tmdb: d.tmdb };
      return `<div class="row">${avatar(d.name, d.tmdb)}<div class="row__main"><div class="row__title">${h(d.name)}</div><div class="row__sub">${plural(d.films.length, "film")} rated 4★ or higher · ${h(d.films.slice(0, 3).map((f) => f.t).join(", "))}</div></div>
        ${isFollowingCredit(c) ? `<span class="tag tag--following">Following</span>` : `<button class="btn btn--sm" data-action="follow-dir" data-name="${h(d.name)}" data-tmdb="${h(d.tmdb || "")}" data-slug="">+ Follow</button>`}</div>`;
    }).join("")}</div>` : ""}
    <details class="more lb-list"><summary>Show the ${follows.length} films you follow from Letterboxd</summary>
      <div class="filmography">${follows.sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title)).map((f) => `<span class="chip"><b>${h(f.title)}</b> ${f.year || ""} <span class="stars">${stars(f.rating)}</span></span>`).join("")}</div></details>
    <div class="actions" style="margin-top:18px"><button class="btn btn--sm btn--danger" data-action="lb-off">Stop using Letterboxd</button></div>`;
}

function viewWatchlist() {
  const s = settings();
  const isDir = state.watchTab === "directors";
  const isLb = state.watchTab === "letterboxd";
  const list = isDir
    ? (s.directors.length ? s.directors.map((d) => {
        const n = upcomingCountFor(d.id);
        const upcomingTitles = new Set(upcomingItems().filter((u) => u.reasons.some((r) => r.interest === d.id)).flatMap((u) => u.films.map((f) => f.title.toLowerCase())));
        const fg = d.filmography || [];
        const chip = (f) => `<span class="chip${upcomingTitles.has(f.title.toLowerCase()) ? " chip--on" : ""}"><b>${h(f.title)}</b>${f.year ? ` ${f.year}` : ""}</span>`;
        return `<div class="swipe" data-swipe-kind="directors" data-swipe-id="${h(d.id)}"><div class="swipe__under" aria-hidden="true">Remove</div><article class="interest" style="${d.enabled === false ? "opacity:.6" : ""}">
          <div class="interest__head">
            ${avatar(d.name, d.tmdb, d.photo, "avatar--lg")}
            <div style="flex:1;min-width:0"><div class="interest__name">${h(d.name)}</div>
              <div class="interest__sub">${[d.years, fg.length ? plural(fg.length, "film") : "", n ? `<span class="interest__count">${plural(n, "upcoming screening")}</span>` : "No upcoming screenings"].filter(Boolean).join(" · ")}</div></div>
            <label class="switch" title="Monitoring on/off"><input type="checkbox" data-action="toggle" data-kind="directors" data-id="${h(d.id)}" ${d.enabled === false ? "" : "checked"} aria-label="Monitor ${h(d.name)}"><span></span></label>
            <button class="icon-btn" data-action="remove" data-kind="directors" data-id="${h(d.id)}" aria-label="Remove ${h(d.name)}">${ICON.trash}</button>
          </div>
          ${fg.length ? `<div class="filmography">${fg.slice(0, 10).map(chip).join("")}</div>${fg.length > 10 ? `<details class="more"><summary>Show all ${fg.length} films</summary><div class="filmography">${fg.slice(10).map(chip).join("")}</div></details>` : ""}` : ""}
        </article></div>`;
      }).join("") : `<div class="empty"><h3>No directors yet</h3><p>Search above to follow a director’s entire filmography.</p></div>`)
    : (s.films.length ? `<div class="group">${s.films.map((f) => {
        const n = upcomingCountFor(f.id);
        return `<div class="swipe" data-swipe-kind="films" data-swipe-id="${h(f.id)}"><div class="swipe__under" aria-hidden="true">Remove</div><div class="row" style="${f.enabled === false ? "opacity:.6" : ""}">${posterImg(catalogPoster(f), "row__poster") || `<span class="row__poster row__poster--empty plywood"></span>`}<div class="row__main"><div class="row__title">${h(f.title)}${f.year ? ` <span style="color:var(--text-3);font-weight:400">(${f.year})</span>` : ""}</div>
          <div class="row__sub">${h([(f.directors || []).join(", "), f.aka?.length ? `also “${f.aka.slice(0, 2).join("”, “")}”` : ""].filter(Boolean).join(" · "))}${n ? ` · <span class="interest__count">${plural(n, "upcoming")}</span>` : ""}</div></div>
          <label class="switch"><input type="checkbox" data-action="toggle" data-kind="films" data-id="${h(f.id)}" ${f.enabled === false ? "" : "checked"} aria-label="Monitor ${h(f.title)}"><span></span></label>
          <button class="icon-btn" data-action="remove" data-kind="films" data-id="${h(f.id)}" aria-label="Remove ${h(f.title)}">${ICON.trash}</button></div></div>`;
      }).join("")}</div>` : `<div class="empty"><h3>No individual films yet</h3><p>Follow a single film — like <i>Eyes Wide Shut</i> — without following its director’s whole career.</p></div>`);
  return `<div class="page">
    <header class="page-head"><div><div class="eyebrow">What you follow</div><h1 class="page-title">Watchlist</h1></div>
      <div class="seg" role="group" aria-label="Directors, films or Letterboxd">
        <button data-action="tab" data-tab="directors" aria-pressed="${isDir}">Directors · ${s.directors.length}</button>
        <button data-action="tab" data-tab="films" aria-pressed="${!isDir && !isLb}">Films · ${s.films.length}</button>
        <button data-action="tab" data-tab="letterboxd" aria-pressed="${isLb}">Letterboxd</button>
      </div></header>
    ${isLb ? viewLetterboxd() : `<div class="search">${ICON.search}<input id="q" type="search" autocomplete="off" placeholder="${isDir ? "Add a director — e.g. Stanley Kubrick" : "Add a film — e.g. Eyes Wide Shut"}" value="${h(state.query)}" aria-label="Search">
      ${resultsBlock()}</div>
    ${list}`}
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
    return matchOccurrence(d, interests()).length ? `<span class="tag tag--soon">Upcoming</span>` : `<span class="tag">Unfollowed</span>`;
  };
  const seg = [["upcoming", "Upcoming"], ["past", "Past"], ["removed", "Removed"], ["all", "All"]]
    .map(([k, l]) => `<button data-action="afilter" data-f="${k}" aria-pressed="${f === k}">${l}</button>`).join("");
  return `<div class="page">
    <header class="page-head"><div><div class="eyebrow">Everything Filament has found</div><h1 class="page-title">Archive</h1>
      <p class="page-sub">${plural(all.length, "screening")} discovered since Filament started watching.</p></div></header>
    <div class="toolbar"><div class="seg" role="group">${seg}</div><input id="aq" type="search" placeholder="Filter by film, director or venue" value="${h(state.archiveQuery)}"></div>
    ${rows.length ? `<div class="group">${rows.map((d) => `<button class="ledger-row" data-action="open" data-key="${h(d.key)}">
        <span class="ledger-date">${fmtDay(d.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
        <span class="ledger-main">${posterImg(d.poster, "row__poster")}<span><span class="row__title">${h(d.films.map((x) => x.title).join(" + "))}</span><span class="row__sub" style="display:block">${h(d.venue)} · ${h(directorsOf(d.films[0]))}${d.showtimes?.length ? ` · ${h(d.showtimes.join(", "))}` : ""}</span></span></span>
        ${statusTag(d)}</button>`).join("")}</div>`
      : `<div class="empty"><h3>Nothing here</h3><p>${f === "removed" ? "No screening you follow has been cancelled or moved." : "Screenings appear here as Filament discovers them."}</p></div>`}
  </div>`;
}

function availableFormats(selected) {
  const count = new Map();
  for (const o of Object.values(D().listings?.occurrences || {})) for (const f of o.films) if (f.format) count.set(f.format, (count.get(f.format) || 0) + 1);
  for (const f of selected) if (!count.has(f)) count.set(f, 0);
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([f]) => f);
}
function availableVenues(selected) {
  const v = new Map();
  for (const o of Object.values(D().listings?.occurrences || {})) if (o.venue_slug) v.set(o.venue_slug, o.venue);
  for (const s of selected) if (!v.has(s)) v.set(s, s);
  return [...v].sort((a, b) => a[1].localeCompare(b[1]));
}
function filtersBlock(f) {
  const fm = f.formats || [], vs = f.venues || [], days = f.days || "any";
  const venueNames = availableVenues(vs).filter(([s]) => vs.includes(s)).map(([, n]) => n);
  return `<div class="group">
    <div class="row"><div class="row__main"><div class="row__title">Formats</div><div class="row__sub">${fm.length ? `Only ${h(fm.join(", "))}` : "Any format"}</div>
      <div class="chips">${availableFormats(fm).map((x) => `<button class="chip chip--btn${fm.includes(x) ? " chip--on" : ""}" data-action="fmt" data-v="${h(x)}" aria-pressed="${fm.includes(x)}">${h(x)}</button>`).join("")}</div></div></div>
    <div class="row"><div class="row__main"><div class="row__title">Theaters</div><div class="row__sub">${vs.length ? `Only ${h(venueNames.slice(0, 3).join(", "))}${venueNames.length > 3 ? ` and ${venueNames.length - 3} more` : ""}` : "Any theater"}</div></div>
      <button class="btn btn--sm" data-action="venues">Choose</button></div>
    <div class="row"><div class="row__main"><div class="row__title">Days</div><div class="row__sub">${{ any: "Any day", weekends: "Saturdays and Sundays only", weekdays: "Monday to Friday only" }[days]}</div></div>
      <div class="seg">${[["any", "Any"], ["weekends", "Weekends"], ["weekdays", "Weekdays"]].map(([k, l]) => `<button data-action="days" data-v="${k}" aria-pressed="${days === k}">${l}</button>`).join("")}</div></div>
  </div>`;
}
function openVenueSheet() {
  const vs = settings().notifications?.filters?.venues || [];
  sheetRoot.innerHTML = `<div class="scrim" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="vsheet-title">
      <div class="sheet__grab"></div>
      <div class="sheet__hero"><button class="icon-btn sheet__close" data-action="close-sheet" aria-label="Close">${ICON.close}</button>
        <div class="eyebrow">Email filters</div><h2 class="sheet__title" id="vsheet-title">Theaters</h2>
        <p class="page-sub">Only email screenings at the theaters you tick. Tick none for any theater.</p></div>
      <div class="sheet__section"><div class="group">${availableVenues(vs).map(([slug, name]) => `
        <label class="row" style="cursor:pointer"><div class="row__main"><div class="row__title">${h(name)}</div></div>
          <span class="switch"><input type="checkbox" data-action="venue-toggle" value="${h(slug)}" ${vs.includes(slug) ? "checked" : ""} aria-label="${h(name)}"><span></span></span></label>`).join("")}</div>
        <div class="actions" style="margin-top:16px"><button class="btn btn--brass" data-action="close-sheet">Done</button></div></div>
    </div>`;
  dragToDismiss(sheetRoot.querySelector(".sheet"));
}
function saveFilters(fn, okText) {
  return saveSettings((s) => {
    s.notifications = s.notifications || {};
    s.notifications.filters = { formats: [], venues: [], days: "any", ...(s.notifications.filters || {}) };
    fn(s.notifications.filters);
  }, "Update email filters", okText);
}

function viewSettings() {
  const s = settings();
  const n = s.notifications || {};
  const st = D().status || {};
  const times = s.schedule?.times || ["09:00"];
  const theme = applyTheme();
  const sw = (key, on, lbl) => `<label class="switch"><input type="checkbox" data-action="notif" data-key="${key}" ${on ? "checked" : ""} aria-label="${h(lbl)}"><span></span></label>`;
  const prov = st.email_provider;
  const runs = (st.runs || []).slice(0, 8);
  return `<div class="page">
    <header class="page-head"><div><div class="eyebrow">Preferences</div><h1 class="page-title">Settings</h1></div></header>

    <div class="group-label">Email notifications</div>
    <div class="group">
      <div class="row"><div class="row__main"><div class="row__title">Email alerts</div><div class="row__sub">At most one email a day, only when something changed</div></div>${sw("email_enabled", n.email_enabled !== false, "Email alerts")}</div>
      <div class="row"><div class="row__main"><div class="row__title">Send to</div><div class="row__sub">Leave empty to use the address saved in GitHub</div></div>
        <input type="email" id="recipient" value="${h(n.recipient || "")}" placeholder="you@example.com" style="width:min(240px,46vw)"></div>
      <div class="row"><div class="row__main"><div class="row__title">New screenings</div><div class="row__sub">A film you follow appears on the calendar</div></div>${sw("notify_new", n.notify_new !== false, "New screenings")}</div>
      <div class="row"><div class="row__main"><div class="row__title">Changes</div><div class="row__sub">Rescheduled dates, new or changed showtimes</div></div>${sw("notify_changes", n.notify_changes !== false, "Changes")}</div>
      <div class="row"><div class="row__main"><div class="row__title">Cancellations</div><div class="row__sub">A screening you were told about disappears</div></div>${sw("notify_cancellations", n.notify_cancellations !== false, "Cancellations")}</div>
      <div class="row"><div class="row__main"><div class="row__title">Email service</div><div class="row__sub">${prov === "resend" ? "Resend is connected" : prov === "smtp" ? "Your mail server is connected" : "Not confirmed yet — send a test to check"}</div></div>
        <button class="btn btn--sm" data-action="test-email">Send test email</button></div>
    </div>

    <div class="group-label">What gets emailed</div>
    ${filtersBlock(n.filters || {})}
    <p class="group-foot">Filters only change which screenings are emailed — everything you follow still appears in the app. When formats are chosen, screenings that don’t list a format are skipped.</p>

    <div class="group-label">Schedule</div>
    <div class="group">
      <div class="row"><div class="row__main"><div class="row__title">Daily check</div><div class="row__sub">Every morning, New York time</div></div><span style="font:600 15px var(--font-mono)">${h(fmtTime12(times[0] || "09:00"))}</span></div>
    </div>
    <p class="group-foot">Checks run on GitHub’s computers, so your Mac and iPhone can be off. Daylight saving is handled automatically, and a check that GitHub starts late is still caught. Tap <b>Check now</b> on the Upcoming page any time you want an extra look.</p>

    <div class="group-label">Recent checks</div>
    <div class="group">${runs.length ? runs.map((r) => `<div class="row"><div class="row__main"><div class="row__title">${h(fmtWhen(r.started))} <span style="color:var(--text-3);font-weight:400">· ${r.trigger === "manual" ? "Manual check" : "Daily check"}</span></div>
        <div class="row__sub">${r.ok ? `${r.dates_scanned} days read · ${plural(r.matched_upcoming || 0, "upcoming match", "upcoming matches")} · ${r.new || 0} new · ${r.updated || 0} updates${r.emailed ? ` · emailed` : ""}` : h(r.error || "Failed")}</div></div>
        <span class="tag ${r.ok ? "" : "tag--gone"}">${r.ok ? "OK" : "Failed"}</span></div>`).join("") : `<div class="row"><div class="row__main row__sub">No checks yet.</div></div>`}</div>

    <div class="group-label">Appearance</div>
    <div class="group"><div class="row"><div class="row__main"><div class="row__title">Theme</div></div>
      <div class="seg">${[["system", "Automatic"], ["evening", "Evening"], ["daylight", "Daylight"]].map(([k, l]) => `<button data-action="theme" data-t="${k}" aria-pressed="${theme === k}">${l}</button>`).join("")}</div></div></div>

    <div class="group"><div class="row"><div class="row__main"><div class="row__title">App icon</div>
      <div class="row__sub">Used when you add Filament to your Home Screen (re-add it to change)</div></div>
      <div class="icon-picks">${[["lamp", "Lamp"], ["plywood", "Plywood"], ["gilt", "Gilt"]].map(([k, l]) => `<button class="icon-pick" data-action="app-icon" data-v="${k}" aria-pressed="${appIcon() === k}" aria-label="${l} icon"><img src="${k === "lamp" ? "icon.svg" : `icon-${k}.svg`}" alt=""><span>${l}</span></button>`).join("")}</div></div></div>

    <div class="group-label">This device</div>
    <div class="group">
      <div class="row"><div class="row__main"><div class="row__title">Connected to</div><div class="row__sub">${h(state.src?.label || "")}</div></div>
        ${isLocal() ? "" : `<button class="btn btn--sm btn--danger" data-action="disconnect">Disconnect</button>`}</div>
    </div>
    <div class="group-label">About</div>
    <div class="group"><div class="row"><div class="row__main"><div class="row__title">Where the listings come from</div>
      <div class="row__sub">Filament reads the public New York listings published by <a href="https://www.screenslate.com" target="_blank" rel="noopener">Screen Slate</a>, the independent daily guide to repertory, arthouse and experimental film, once a day. Listings data © Screen Slate. Film details and alternate titles come from Wikidata.</div></div></div></div>
  </div>`;
}

function welcome(errMsg) {
  const c = loadConnection() || {};
  const feat = (n, t, d) => `<li class="feature"><span class="feature__n">${n}</span><div><div class="feature__t">${t}</div><div class="feature__d">${d}</div></div></li>`;
  return `<div class="welcome"><div class="welcome__card">
    ${tubesArt()}
    <div class="eyebrow">Filament · New York</div>
    <h1>Is your favorite film playing in New York?</h1>
    <p class="welcome__lede">Follow the directors and films you love. Filament reads New York’s repertory and arthouse listings every morning, and emails you the moment one of yours is scheduled.</p>
    <ol class="features">
      ${feat("01", "Follow anyone", "A whole director — every film by David Lynch — or a single title like <i>Eyes Wide Shut</i>.")}
      ${feat("02", "See what’s playing", "Every upcoming NYC screening of what you follow, with venue, date, showtimes and format.")}
      ${feat("03", "Get told first", "One email when something new is scheduled, moved or cancelled. Never the same news twice.")}
    </ol>
    ${wireEl()}
    <h2 class="welcome__signin">Open your Filament</h2>
    ${errMsg ? `<p class="error-text">${h(errMsg)}</p>` : ""}
    <form id="connect">
      <label class="field"><span>GitHub username</span><input name="owner" autocomplete="username" autocapitalize="off" value="${h(c.owner || "")}" required></label>
      <label class="field"><span>Repository name</span><input name="repo" autocapitalize="off" value="${h(c.repo || "filament")}" required></label>
      <label class="field"><span>Access token</span><input name="token" type="password" autocomplete="off" placeholder="github_pat_…" required></label>
      <button class="btn btn--brass" style="width:100%;height:48px" ${state.busy ? "disabled" : ""}>${state.busy ? "Opening…" : "Open Filament"}</button>
    </form>
    <details class="steps-wrap"><summary>Where do I get an access token?</summary>
    <ol class="steps">
      <li>On github.com open <b>Settings → Developer settings → Fine-grained tokens → Generate new token</b>.</li>
      <li>Repository access: <b>Only select repositories</b> → your Filament repository.</li>
      <li>Permissions: <b>Contents: Read and write</b> and <b>Actions: Read and write</b>.</li>
      <li>Copy the token and paste it above. It stays on this device only.</li>
    </ol></details>
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
      ${wireEl()}
      <nav class="nav" aria-label="Sections" style="--i:${NAV.findIndex(([k]) => k === (state.prevView || state.view))}"><span class="nav-pill" aria-hidden="true"></span>${NAV.map(([k, l, i]) => `<button class="nav__item" data-action="nav" data-view="${k}" ${state.view === k ? 'aria-current="page"' : ""}>${i}<span>${l}</span><span class="nav__count">${counts[k] ?? ""}</span></button>`).join("")}</nav>
      <div class="rail__foot">Watching New York’s screening calendar.<br>${state.data ? `Next check ${h(fmtWhen(nextCheckISO()))}.` : ""}</div>
    </aside>
    <main class="main${state.enter ? " main--enter" : ""}" id="main">
      <div class="topbar"><span class="wordmark">${lamp(lampState)}<span class="wordmark__type">Filament</span></span>
        <span class="topbar__title" aria-hidden="true">${h({ upcoming: state.find.trim().length >= 2 ? "Is it playing?" : "Upcoming", watch: "Watchlist", archive: "Archive", settings: "Settings" }[state.view])}</span>
        <button class="icon-btn" data-action="reload" aria-label="Refresh">${ICON.refresh}</button></div>
      ${state.error ? `<div class="console__error" style="margin:0 0 18px">${h(state.error)}</div>` : ""}
      ${view}
    </main>
    <nav class="tabbar" aria-label="Sections" style="--i:${NAV.findIndex(([k]) => k === (state.prevView || state.view))}"><span class="tab-pill" aria-hidden="true"></span>${NAV.map(([k, l, i]) => `<button class="tab" data-action="nav" data-view="${k}" ${state.view === k ? 'aria-current="page"' : ""}>${i}<span>${l}</span></button>`).join("")}</nav>`;
  if (active) {
    const el = document.getElementById(active);
    if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch { /* not a text input */ } }
  }
  afterRender();
}

/* --------------------------------------------------------- the sheet */
function findItem(key) {
  return upcomingItems().find((d) => d.key === key) || D().history?.discoveries?.[key] || D().listings?.occurrences?.[key];
}
const EVENT_TEXT = {
  discovered: (e) => e.how === "newly_watched" ? "Matched a newly added interest" : e.how === "initial" ? "Found on Filament’s first check" : "Newly listed",
  showtime_added: (e) => `New showtime: ${(e.times || []).join(", ")}`,
  showtime_removed: (e) => `Showtime dropped: ${(e.times || []).join(", ")}`,
  time_changed: (e) => `Times changed from ${(e.before || []).join(", ")} to ${(e.after || []).join(", ")}`,
  rescheduled: (e) => e.from_date ? `Moved here from ${fmtDay(e.from_date, { month: "short", day: "numeric" })}` : `Moved to ${fmtDay(e.to_date, { month: "short", day: "numeric" })}`,
  removed: () => "Disappeared from the listings",
  reappeared: () => "Reappeared in the listings",
};
function openSheet(key) {
  const d = findItem(key);
  if (!d) return;
  const reasons = d.reasons || matchOccurrence(d, interests());
  const facts = [
    ["Date", fmtDay(d.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })],
    ["Showtimes", (d.showtimes || []).join(", ") || "Time TBA"],
    endsAt(d) ? ["Ends", endsAt(d)] : null,
    ["Venue", d.venue], d.series ? ["Series", d.series] : null,
    ...d.films.flatMap((f, i) => [[d.films.length > 1 ? `Film ${i + 1}` : "Director", d.films.length > 1 ? `${f.title} — ${directorsOf(f)}` : directorsOf(f) || "Not listed"],
      f.format ? ["Format", f.format] : null, f.runtime ? ["Runtime", `${f.runtime} minutes`] : null]),
    d.notes?.length ? ["Notes", d.notes.join(" · ")] : null,
    reasons.length ? ["Why", [...new Set(reasons.map((r) => r.kind === "letterboxd" ? r.label : r.kind === "film" ? `You follow “${r.label}”` : `You follow ${r.label}`))].join("; ")] : null,
    ...(reasons.some((r) => r.kind === "letterboxd") ? [] : d.films.map((f) => lookup(lbData(), f)).filter((r) => r && (r.w || r.wl)).slice(0, 1).map((r) => ["Letterboxd", r.r ? `You rated it ${stars(r.r)}` : r.w ? "You’ve seen it" : "On your watchlist"])),
  ].filter(Boolean);
  const evs = (d.events || []).slice().reverse();
  sheetRoot.innerHTML = `<div class="scrim" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet__grab"></div>
      <div class="console__gilt gilt" style="height:5px;margin:10px 26px 0;border-radius:3px"></div>
      <div class="sheet__hero">
        <button class="icon-btn sheet__close" data-action="close-sheet" aria-label="Close">${ICON.close}</button>
        <div class="sheet__head">${posterImg(d.poster, "sheet__poster")}<div>
        <div class="eyebrow">${h(relDay(d.date) || fmtDay(d.date, { weekday: "long" }))} · ${h(d.venue)}</div>
        <h2 class="sheet__title" id="sheet-title">${h(d.films.map((f) => f.title).join(" + "))}</h2>
        <div class="card__meta">${h(d.films.map((f) => [directorsOf(f), f.year].filter(Boolean).join(", ")).join(" · "))}</div>
        </div></div>
      </div>
      <div class="sheet__section"><dl class="facts">${facts.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join("")}</dl></div>
      <div class="sheet__section"><div class="actions">
        <a class="btn btn--brass" href="${h(d.listing_url)}" target="_blank" rel="noopener">View listing</a>
        ${d.film_url ? `<a class="btn" href="${h(d.film_url)}" target="_blank" rel="noopener">Film page</a>` : ""}
        ${d.ticket_url ? `<a class="btn" href="${h(d.ticket_url)}" target="_blank" rel="noopener">Tickets</a>` : ""}
        <a class="btn" href="https://maps.apple.com/?q=${encodeURIComponent(`${d.venue}, New York, NY`)}" target="_blank" rel="noopener">Directions</a>
        <a class="btn" href="${h(letterboxdURL(d.films[0]))}" target="_blank" rel="noopener">Letterboxd</a>
        <button class="btn" data-action="share" data-key="${h(d.key)}">${ICON.share} Share</button>
      </div></div>
      <div class="sheet__section"><div class="group-label" style="margin-top:0">Add to Calendar</div><div class="actions">
        ${(d.showtimes?.length ? d.showtimes : [null]).map((t) => `<button class="btn btn--sm" data-action="ics" data-key="${h(d.key)}" data-time="${h(t || "")}">${ICON.calendar} ${t ? h(t) : "Add (time TBA)"}</button>`).join("")}
      </div></div>
      <div class="sheet__section"><div class="group-label" style="margin-top:0">Follow</div><div class="actions">${followButtons(d.films)}</div></div>
      ${evs.length || d.discovered_at ? `<div class="sheet__section">${wireEl()}<div class="group-label" style="margin-top:14px">History</div><ul class="timeline">
        ${evs.map((e) => `<li>${h((EVENT_TEXT[e.kind] || (() => e.kind))(e))}<time>${h(fmtWhen(e.at))}</time></li>`).join("")}
        ${d.first_listed ? `<li>First listed<time>${h(fmtWhen(d.first_listed))}</time></li>` : ""}</ul></div>` : ""}
    </div>`;
  sheetRoot.querySelector(".sheet__close").focus();
  sheetRoot.dataset.key = key;
  dragToDismiss(sheetRoot.querySelector(".sheet"));
}
function closeSheet() {
  const sh = sheetRoot.querySelector(".sheet");
  delete sheetRoot.dataset.key;
  if (!sh || reducedMotion()) { sheetRoot.innerHTML = ""; return; }
  sh.classList.add("sheet--out");
  sheetRoot.querySelector(".scrim")?.classList.add("scrim--out");
  setTimeout(() => { if (!sheetRoot.dataset.key) sheetRoot.innerHTML = ""; }, 260);
}

/* ------------------------------------------------- add to calendar (.ics) */
function nyToUTC(dateIso, hh, mm) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const part = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(new Date(guess)).find((p) => p.type === "timeZoneName").value;   // "GMT-05:00"
  const mt = /GMT([+-])(\d\d):(\d\d)/.exec(part);
  const off = mt ? (mt[1] === "-" ? -1 : 1) * (Number(mt[2]) * 60 + Number(mt[3])) : 0;
  return new Date(guess - off * 60000);
}
const icsStamp = (dt) => dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
function buildICS(d, time) {
  const m = /^(\d+):(\d+)(AM|PM)$/.exec(time || "");
  const hh = m ? ((+m[1] % 12) + (m[3] === "PM" ? 12 : 0)) : 19, mm = m ? +m[2] : 0;
  const start = nyToUTC(d.date, hh, mm);
  const minutes = d.films.reduce((a, f) => a + (f.runtime || 0), 0) || 120;
  const end = new Date(start.getTime() + minutes * 60000);
  const desc = [d.films.map((f) => `${f.title} — ${directorsOf(f) || "director not listed"}${f.year ? ` (${f.year})` : ""}${f.format ? `, ${f.format}` : ""}`).join("\n"),
    d.series ? `Series: ${d.series}` : "", ...(d.notes || []), d.ticket_url ? `Tickets: ${d.ticket_url}` : "", `Listing: ${d.listing_url}`].filter(Boolean).join("\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Filament//NYC screenings//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${d.key}-${(time || "tba").replace(/\W/g, "")}@filament`, `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(d.films.map((f) => f.title).join(" + "))}${m ? "" : icsText(" (time TBA)")}`,
    `LOCATION:${icsText(d.venue)}`, `DESCRIPTION:${icsText(desc)}`, `URL:${d.ticket_url || d.listing_url}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", `DESCRIPTION:${icsText(d.films[0].title)} at ${icsText(d.venue)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n") + "\r\n";
}
function downloadICS(d, time) {
  const blob = new Blob([buildICS(d, time)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${d.films[0].title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}-${d.date}.ics`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/** "around 11:30 PM" for each showtime, from the runtime. */
function endsAt(d) {
  const mins = d.films.reduce((a, f) => a + (f.runtime || 0), 0);
  if (!mins || !d.showtimes?.length) return "";
  const fmt = (t) => {
    const m = /^(\d+):(\d+)(AM|PM)$/.exec(t);
    if (!m) return null;
    const start = ((+m[1] % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + +m[2];
    const e = (Math.round((start + mins) / 5) * 5) % 1440;   // "around": nearest 5 minutes
    return `${((Math.floor(e / 60) + 11) % 12) + 1}:${String(e % 60).padStart(2, "0")} ${e < 720 ? "AM" : "PM"}`;
  };
  const ends = d.showtimes.slice(0, 4).map(fmt).filter(Boolean);
  if (!ends.length) return "";
  return ends.length === 1 ? `Around ${ends[0]}` : d.showtimes.slice(0, ends.length).map((t, i) => `${ends[i]} (${t} show)`).join(" · ");
}
function letterboxdURL(f) {
  const rec = lookup(lbData(), f);
  if (rec?.tmdb) return `https://letterboxd.com/tmdb/${rec.tmdb}/`;
  return `https://letterboxd.com/search/films/${encodeURIComponent(`${f.title}${f.year ? ` ${f.year}` : ""}`)}/`;
}

/* ------------------------------------------------------------- share */
async function shareScreening(d) {
  const title = d.films.map((f) => f.title).join(" + ");
  const f0 = d.films[0];
  const when = `${fmtDay(d.date, { weekday: "long", month: "long", day: "numeric" })}${d.showtimes?.length ? ` at ${d.showtimes.join(", ")}` : ""}`;
  const text = `${title}${f0.year || directorsOf(f0) ? ` (${[directorsOf(f0), f0.year].filter(Boolean).join(", ")})` : ""} — ${when} at ${d.venue}`;
  const url = d.ticket_url || d.listing_url;   // the theater's ticket page when there is one
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); } catch (e) { if (e.name !== "AbortError") toast("Couldn’t open sharing"); }
    return;
  }
  try { await navigator.clipboard.writeText(`${text}\nTickets: ${url}`); toast("Copied — paste it anywhere"); }
  catch { toast("Couldn’t copy"); }
}

/* ---------------------------------------------------- Letterboxd import */
async function importLetterboxd(file) {
  toast("Reading your Letterboxd export…");
  try {
    const { data, username } = await importExport(file, lbData());
    const films = Object.values(data.films);
    await state.src.writeFile("letterboxd.json", data, "Import Letterboxd export");
    state.data = { ...state.data, letterboxd: data };
    await saveSettings((s) => {
      s.letterboxd = { min_rating: 4.5, include_watchlist: false, sync_rss: true, ...(s.letterboxd || {}), enabled: true, ...(username ? { username } : {}) };
    }, "Letterboxd settings");
    const n = followList(data, lbCfg()).length;
    toast(`Imported ${films.length} films · following ${n}. Directors are filled in at the next check.`);
  } catch (e) {
    toast(e.message || "Couldn’t read that file");
  }
}

/* ------------------------------------------------------- one-tap follow */
async function followDirector(name, tmdb, slug) {
  toast(`Adding ${name}…`);
  let filmography = [], qid = null, aka = [], years;
  try {
    const hits = await searchWikidataDirectors(name);
    const hit = hits.find((w) => tmdb && w.tmdb === tmdb) || (!tmdb ? hits[0] : null);
    if (hit) { qid = hit.qid; aka = hit.aka; years = hit.born ? `${hit.born}–${hit.died || ""}` : undefined; filmography = await filmographyFor(hit.qid); }
  } catch { /* Wikidata unavailable: following by Screen Slate id still works */ }
  await addInterest({ id: uid("dir", name), name, tmdb: tmdb || null, slug: slug || slugFromCatalog(D().catalog, tmdb, name),
    wikidata: qid, aka, years, filmography, added: todayISO(), enabled: true }, "directors");
}
async function followFilm(f) {
  await addInterest({ id: uid("film", f.title), title: f.title, year: f.year || null, slug: f.slug || null,
    directors: (f.directors || []).map((x) => x.name), aka: [], added: todayISO(), enabled: true }, "films");
}
const reopenSheet = () => { if (sheetRoot.dataset.key) openSheet(sheetRoot.dataset.key); };

/* ------------------------------------------------- motion & small joys */
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function transition(fn) {
  if (document.startViewTransition && !reducedMotion()) document.startViewTransition(fn);
  else fn();
}

function afterRender() {
  // slide the tab/rail indicator from the previous section to the current one
  const idx = NAV.findIndex(([k]) => k === state.view);
  if (state.prevView) {
    requestAnimationFrame(() => document.querySelectorAll(".tabbar, .nav").forEach((n) => n.style.setProperty("--i", idx)));
    state.prevView = null;
  }
  if (state.enter) setTimeout(() => { state.enter = false; }, 0);
  // collapse the big title into the top bar on scroll (iOS large titles)
  const title = document.querySelector(".page-title");
  if (title && "IntersectionObserver" in window) {
    titleObserver?.disconnect();
    titleObserver = new IntersectionObserver(([e]) => document.body.classList.toggle("title-hidden", !e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    titleObserver.observe(title);
  }
  bindSwipes();
}
let titleObserver = null;

// The lamp: a tap makes the filament stutter; a long press blows the bulb.
function flicker(target) {
  if (reducedMotion()) return;
  (target ? [target] : document.querySelectorAll(".lamp")).forEach((l) => {
    l.classList.remove("lamp--flicker"); void l.offsetWidth; l.classList.add("lamp--flicker");
    setTimeout(() => l.classList.remove("lamp--flicker"), 1500);
  });
}
function surge() {
  if (reducedMotion()) return;
  document.querySelectorAll(".lamp").forEach((l) => { l.classList.add("lamp--surge"); setTimeout(() => l.classList.remove("lamp--surge"), 1300); });
}
function particles(x, y, kind, n) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span");
    p.className = kind;
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    p.style.setProperty("--a", `${(360 / n) * i + Math.random() * 20}deg`);
    p.style.setProperty("--d", `${i * 90}ms`);
    p.style.setProperty("--x", `${(Math.random() - 0.5) * 50}px`);
    document.body.append(p);
    setTimeout(() => p.remove(), 2400);
  }
}
function blowLamp(l) {
  if (reducedMotion()) return;
  const r = l.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height * 0.42;
  particles(cx, cy, "spark", 9);
  particles(cx, cy - 6, "smoke", 4);
  l.classList.add("lamp--dead");
  setTimeout(() => { l.classList.remove("lamp--dead"); flicker(l); }, 1900);
}
let pressTimer = 0;
document.addEventListener("pointerdown", (ev) => {
  const l = ev.target.closest(".lamp");
  if (!l) return;
  pressTimer = setTimeout(() => { pressTimer = -1; blowLamp(l); }, 650);
});
document.addEventListener("pointerup", (ev) => {
  const l = ev.target.closest(".lamp");
  if (pressTimer > 0) { clearTimeout(pressTimer); if (l) flicker(l); }
  pressTimer = 0;
});
document.addEventListener("pointercancel", () => { clearTimeout(pressTimer); pressTimer = 0; });

// Removing something: it dissolves into a curl of smoke.
function smokeOut(el) {
  if (!el || reducedMotion()) return Promise.resolve();
  const r = el.getBoundingClientRect();
  particles(r.left + r.width / 2, r.top + r.height / 2, "smoke smoke--big", 5);
  el.classList.add("smoke-out");
  return new Promise((res) => setTimeout(res, 520));
}

// Three things to type into "Is it playing?"
let lastSecret = "";
function secretSearch(q) {
  const k = fold(q).replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  if (k === lastSecret) return;
  lastSecret = k;
  if (k === "damn fine coffee" || k === "damn fine cup of coffee") { flicker(); toast("And hot."); }
  else if (k === "the owls are not what they seem") {
    flicker();
    if (!reducedMotion()) { document.body.classList.add("owls"); setTimeout(() => document.body.classList.remove("owls"), 3200); }
  } else if (k === "fire walk with me") {
    flicker();
    if (!reducedMotion()) {
      const floor = document.createElement("div");
      floor.className = "zigzag";
      document.body.append(floor);
      setTimeout(() => floor.remove(), 4200);
    }
  }
}

// Sheets follow your finger down and close past a threshold.
function dragToDismiss(sheet) {
  if (!sheet) return;
  let y0 = null, dy = 0, t0 = 0;
  sheet.addEventListener("touchstart", (e) => {
    if (sheet.scrollTop > 0) return;
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now();
    sheet.style.transition = "none";
  }, { passive: true });
  sheet.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    if (dy > 0) { e.preventDefault(); sheet.style.transform = `translateY(${dy}px)`; }
  }, { passive: false });
  sheet.addEventListener("touchend", () => {
    if (y0 === null) return;
    const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
    sheet.style.transition = "";
    if (dy > 120 || (fast && dy > 40)) { sheet.style.transform = ""; closeSheet(); }
    else sheet.style.transform = "";
    y0 = null;
  });
}

// Swipe a watchlist row to the left to remove it.
function bindSwipes() {
  document.querySelectorAll(".swipe").forEach((w) => {
    if (w.dataset.bound) return;
    w.dataset.bound = "1";
    const card = w.lastElementChild;
    let x0 = null, y0 = 0, dx = 0, locked = null;
    w.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; locked = null; card.style.transition = "none"; }, { passive: true });
    w.addEventListener("touchmove", (e) => {
      if (x0 === null) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (locked === null && Math.abs(mx) + Math.abs(my) > 8) locked = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (locked !== "x") return;
      e.preventDefault();
      dx = Math.min(0, mx);
      card.style.transform = `translateX(${dx < -120 ? -120 + (dx + 120) * 0.35 : dx}px)`;
      w.classList.toggle("swipe--armed", dx < -110);
    }, { passive: false });
    w.addEventListener("touchend", async () => {
      card.style.transition = "";
      const go = dx < -110;
      w.classList.remove("swipe--armed");
      x0 = null;
      if (!go) { card.style.transform = ""; return; }
      card.style.transform = "translateX(-110%)";
      const kind = w.dataset.swipeKind, id = w.dataset.swipeId;
      const item = settings()[kind].find((x) => x.id === id);
      if (!item) return;
      await new Promise((r) => setTimeout(r, 180));
      await saveSettings((s) => { s[kind] = s[kind].filter((x) => x.id !== id); }, `Stop following ${item.name || item.title}`);
      toast(`Stopped following ${item.name || item.title}`, { label: "Undo", run: () => saveSettings((s) => { if (!s[kind].some((x) => x.id === id)) s[kind].push(item); }, `Follow ${item.name || item.title}`) });
    });
  });
}

// Pull down on Upcoming to refresh; the lamp warms up as you pull.
(function pullToRefresh() {
  let y0 = null, dy = 0;
  const ind = document.createElement("div");
  ind.className = "ptr";
  ind.innerHTML = lamp("on");
  document.body.append(ind);
  addEventListener("touchstart", (e) => {
    if (window.scrollY > 0 || sheetRoot.innerHTML || state.view !== "upcoming" || !state.src) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { ind.style.cssText = ""; return; }
    const p = Math.min(1, dy / 110);
    ind.style.opacity = String(p);
    ind.style.transform = `translate(-50%, ${Math.min(dy, 130) * 0.6}px) scale(${0.6 + p * 0.4})`;
    ind.classList.toggle("ptr--ready", p >= 1);
  }, { passive: true });
  addEventListener("touchend", () => {
    if (y0 === null) return;
    const ready = dy >= 110;
    y0 = null;
    if (!ready) { ind.style.cssText = ""; ind.classList.remove("ptr--ready"); return; }
    ind.classList.add("ptr--spin");
    refresh(true).then(() => { surge(); ind.classList.remove("ptr--spin", "ptr--ready"); ind.style.cssText = ""; });
  });
})();

// Alternate app icons (picked up when added to the Home Screen).
function appIcon() { try { return localStorage.getItem("filament.icon") || "lamp"; } catch { return "lamp"; } }
function setAppIcon(k) {
  try { localStorage.setItem("filament.icon", k); } catch { /* ignore */ }
  applyAppIcon();
  toast(k === "lamp" ? "Lamp icon" : `${k[0].toUpperCase()}${k.slice(1)} icon — re-add Filament to your Home Screen to see it`);
}
function applyAppIcon() {
  const k = appIcon();
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute("href", k === "lamp" ? "icon-180.png" : `icon-${k}-180.png`);
  document.querySelector('link[rel="icon"]')?.setAttribute("href", k === "lamp" ? "icon.svg" : `icon-${k}.svg`);
}
applyAppIcon();

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
  surge();
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
  reopenSheet();
}

async function onAction(el, ev) {
  const a = el.dataset.action;
  if (a === "nav") {
    ev.preventDefault();
    if (el.classList.contains("wordmark") || el.closest(".wordmark")) flicker();
    if (state.view === el.dataset.view) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    state.prevView = state.view;
    state.view = el.dataset.view; state.query = ""; state.results = null; state.enter = true;
    transition(() => { render(); window.scrollTo({ top: 0 }); });
    return;
  }
  if (a === "open") return openSheet(el.dataset.key);
  if (a === "close-sheet") return closeSheet();
  if (a === "reload") return refresh();
  if (a === "tab") { state.watchTab = el.dataset.tab; state.query = ""; state.results = null; state.enter = true; return transition(render); }
  if (a === "afilter") { state.archiveFilter = el.dataset.f; return render(); }
  if (a === "app-icon") { setAppIcon(el.dataset.v); return render(); }
  if (a === "theme") { try { localStorage.setItem("filament.theme", el.dataset.t); } catch { /* ignore */ } applyTheme(); return render(); }
  if (a === "check") {
    try { await state.src.dispatch("check-now"); state.running = true; render(); toast("Checking today’s listings — about three minutes"); pollRun(); }
    catch (e) { toast(e.message); }
    return;
  }
  if (a === "test-email") {
    try { await state.src.dispatch("test-email"); toast("Test email requested — it should arrive within a couple of minutes"); }
    catch (e) { toast(e.message); }
    return;
  }
  if (a === "find-clear") { state.find = ""; return render(); }
  if (a === "share") { const d = findItem(el.dataset.key); if (d) shareScreening(d); return; }
  if (a === "lb-min") return saveSettings((s) => { s.letterboxd = { ...(s.letterboxd || {}), min_rating: Number(el.dataset.v) }; }, "Letterboxd: change rating threshold", `Following films rated ${stars(Number(el.dataset.v))}${Number(el.dataset.v) < 5 ? " and up" : ""}`);
  if (a === "lb-off") {
    if (!confirm("Stop following films from Letterboxd? Your imported data stays saved, and you can turn it back on any time.")) return;
    return saveSettings((s) => { s.letterboxd = { ...(s.letterboxd || {}), enabled: false }; }, "Letterboxd: turn off", "Letterboxd turned off");
  }
  if (a === "ics") { const d = findItem(el.dataset.key); if (d) { downloadICS(d, el.dataset.time); toast("Calendar event created — open it to add to Calendar"); } return; }
  if (a === "follow-dir") return followDirector(el.dataset.name, el.dataset.tmdb ? Number(el.dataset.tmdb) : null, el.dataset.slug || null);
  if (a === "follow-film") { const f = filmIndex.get(el.dataset.fk); if (f) await followFilm(f); return; }
  if (a === "follow-typed") {
    const q = state.find.trim();
    if (el.dataset.kind === "directors") await followDirector(q, null, null);
    else await addInterest({ id: uid("film", q), title: q, aka: [], directors: [], added: todayISO(), enabled: true }, "films");
    return;
  }
  if (a === "fmt") {
    const v = el.dataset.v;
    return saveFilters((f) => { f.formats = f.formats.includes(v) ? f.formats.filter((x) => x !== v) : [...f.formats, v]; }, "Saved");
  }
  if (a === "days") return saveFilters((f) => { f.days = el.dataset.v; }, "Saved");
  if (a === "venues") return openVenueSheet();
  if (a === "disconnect") {
    if (!confirm("Disconnect this device? Your watchlist and history stay safe on GitHub.")) return;
    forgetConnection(); state.src = null; state.data = null; return render();
  }
  if (a === "remove") {
    const kind = el.dataset.kind, id = el.dataset.id;
    const item = settings()[kind].find((x) => x.id === id);
    if (!item) return;
    await smokeOut(el.closest(".swipe, .interest, .row"));
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
      await addInterest({ id: uid("dir", x.name), name: x.name, tmdb: x.tmdb, slug: slugFromCatalog(D().catalog, x.tmdb, x.name), wikidata: x.qid, aka: x.aka, years, filmography, photo: x.photo || null, added: todayISO(), enabled: true }, "directors");
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
    const next = [...(settings().schedule?.times || ["09:00"])];
    next[i] = v;
    saveSettings((s) => { s.schedule = s.schedule || { timezone: TZ }; const t = [...(s.schedule.times || ["09:00"])]; t[i] = v; s.schedule.times = t; },
      "Change check times", `Checks at ${next.map(fmtTime12).join(" and ")}`);
  } else if (el.dataset.action === "lb-set") {
    const k = el.dataset.key, on = el.checked;
    saveSettings((s) => { s.letterboxd = { ...(s.letterboxd || {}), [k]: on }; }, "Letterboxd settings", "Saved");
  } else if (el.dataset.action === "lb-import" && el.files?.[0]) {
    importLetterboxd(el.files[0]);
  } else if (el.dataset.action === "venue-toggle") {
    const v = el.value, on = el.checked;
    saveFilters((f) => { f.venues = on ? [...new Set([...f.venues, v])] : f.venues.filter((x) => x !== v); });
  } else if (el.id === "recipient") {
    const v = el.value.trim();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast("That doesn’t look like an email address"); return; }
    saveSettings((s) => { s.notifications = { ...(s.notifications || {}), recipient: v }; }, "Update email address", "Saved");
  }
});
document.addEventListener("input", (ev) => {
  if (ev.target.id === "q") runSearch(ev.target.value);
  if (ev.target.id === "aq") { state.archiveQuery = ev.target.value; render(); }
  if (ev.target.id === "find") { state.find = ev.target.value; render(); secretSearch(state.find); }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    if (sheetRoot.innerHTML) closeSheet();
    else if (state.query) { state.query = ""; state.results = null; render(); }
    else if (state.find) { state.find = ""; render(); }
  }
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
