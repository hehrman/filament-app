// Letterboxd in the app: read an export .zip on-device, decide which films are
// followed automatically, mark films you've seen, and suggest "For you".
// Mirrors monitor/letterboxd.py (same keys, same thresholds, same aliases).
import { fold, nameKey, titleKey } from "./match.js?v=20261110165329";

export const filmKey = (title, year) => `${titleKey(title)}|${year || ""}`;

export function stars(r) {
  if (!r) return "";
  const full = Math.floor(r);
  return "★".repeat(full) + (r - full >= 0.5 ? "½" : "");
}

export function aliases(title) {
  const out = [];
  const parts = title.split(/,? or:? /i);
  if (parts.length > 1 && parts[0].length >= 4) out.push(parts[0]);
  if (title.includes(":")) {
    const head = title.split(":")[0];
    if (head.length >= 4 && !out.includes(head)) out.push(head);
  }
  return out;
}

/** Watched within the last `months` months (default 4; 0 = rule off). */
export function recentlyWatched(f, months, today = new Date()) {
  const m = months === undefined || months === null ? 4 : Number(months);
  if (!m || !f?.lw) return false;
  return (today - new Date(`${f.lw}T12:00:00`)) / 864e5 < m * 30.44;
}

export function followList(data, cfg, today) {
  if (!data?.films || !cfg || cfg.enabled === false) return [];
  const minR = Number(cfg.min_rating ?? 4.5), wl = !!cfg.include_watchlist;
  const out = [];
  for (const [k, f] of Object.entries(data.films)) {
    let why = null;
    if (recentlyWatched(f, cfg.recent_months, today)) continue;
    if (f.r && f.r >= minR) why = `You rated it ${stars(f.r)} on Letterboxd`;
    else if (wl && f.wl) why = "On your Letterboxd watchlist";
    if (why) out.push({ id: `lb-${k}`, title: f.t, year: f.y, aka: aliases(f.t), label: why, rating: f.r || null });
  }
  return out;
}

/** Merge recent diary entries (from the public feed) — mirrors monitor/letterboxd.py sync_rss. */
export function mergeFeed(data, entries) {
  const out = data?.films ? structuredClone(data) : { version: 1, films: {} };
  let changed = 0;
  for (const e of entries || []) {
    if (!e.t) continue;
    const k = filmKey(e.t, e.y);
    const before = JSON.stringify(out.films[k] || null);
    const rec = out.films[k] || (out.films[k] = { t: e.t, y: e.y || null });
    if (e.r) rec.r = e.r;
    if (e.tmdb) rec.tmdb = e.tmdb;
    rec.w = true;
    delete rec.wl;                                   // watched films leave the watchlist
    if (e.watched && (!rec.lw || e.watched > rec.lw)) rec.lw = e.watched;
    if (JSON.stringify(rec) !== before) changed++;
  }
  out.rss_synced_at = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  return { data: out, changed };
}

/** The Letterboxd record for a screened film (exact year, then ±1). */
export function lookup(data, film) {
  if (!data?.films || !film) return null;
  const tk = titleKey(film.title);
  const y = Number(film.year) || null;
  const cands = y ? [y, y - 1, y + 1] : [""];
  for (const yy of cands) { const r = data.films[`${tk}|${yy}`]; if (r) return r; }
  if (!y) return null;
  // short-title fallback: Screen Slate's "Dr. Strangelove" vs Letterboxd's "Dr. Strangelove or: …"
  return Object.values(data.films).find((f) => Math.abs((f.y || 0) - y) <= 1 && aliases(f.t).some((x) => titleKey(x) === tk)) || null;
}

/** Directors you rate highly: ≥2 films rated 4★+. */
export function lovedDirectors(data) {
  const m = new Map();
  for (const f of Object.values(data?.films || {})) {
    if (!(f.r >= 4) || !f.d) continue;
    for (const d of f.d) {
      const k = d.tmdb ? `t${d.tmdb}` : `n${nameKey(d.n)}`;
      const e = m.get(k) || { name: d.n, tmdb: d.tmdb || null, films: [] };
      e.films.push({ t: f.t, r: f.r });
      m.set(k, e);
    }
  }
  return [...m.values()].filter((e) => e.films.length >= 2).sort((a, b) => b.films.length - a.films.length);
}

/**
 * Suggestions from everything playing in NYC that you don't already follow:
 * films you rated 4★, films on your watchlist, films by directors you love.
 */
export function forYou(occurrences, data, isFollowed, today, recentMonths) {
  if (!data?.films) return [];
  const loved = new Map(lovedDirectors(data).flatMap((d) => [[d.tmdb ? `t${d.tmdb}` : "", d], [`n${nameKey(d.name)}`, d]]).filter(([k]) => k));
  const groups = new Map();
  for (const o of occurrences) {
    if (o.status !== "active" || o.date < today || isFollowed(o)) continue;
    for (const f of o.films) {
      const rec = lookup(data, f);
      if (rec && recentlyWatched(rec, recentMonths)) continue;   // you just saw it
      let score = 0, why = "";
      if (rec?.r >= 4) { score = 3 + rec.r; why = `You rated it ${stars(rec.r)}`; }
      else if (rec?.wl) { score = 6; why = "On your Letterboxd watchlist"; }
      else {
        const d = (f.directors || []).map((c) => loved.get(c.tmdb ? `t${c.tmdb}` : "") || loved.get(`n${nameKey(c.name)}`)).find(Boolean);
        if (d) { score = 2 + Math.min(d.films.length, 10) / 10; why = `By ${d.name}. You’ve rated ${d.films.length} of their films 4★ or higher`; }
      }
      if (!score) continue;
      const k = f.slug || fold(f.title);
      const g = groups.get(k) || { key: k, film: f, poster: o.poster, why, score, seen: rec || null, occs: [] };
      g.poster = g.poster || o.poster;
      g.occs.push(o);
      groups.set(k, g);
    }
  }
  return [...groups.values()]
    .map((g) => ({ ...g, occs: g.occs.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => b.score - a.score || a.occs[0].date.localeCompare(b.occs[0].date))
    .slice(0, 14);
}

/* ---------------------------------------------------- reading the export */

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Minimal .zip reader: returns {basename: text} for the files we want. */
export async function readZip(buffer, wanted) {
  const b = new Uint8Array(buffer), v = new DataView(buffer);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That file isn’t a .zip export.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), cmtLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + cmtLen;
    const base = name.split("/").pop();
    if (name.includes("__MACOSX") || name.split("/").length > 2 || !wanted.includes(base) || out[base]) continue;
    const lnl = v.getUint16(local + 26, true), lel = v.getUint16(local + 28, true);
    const start = local + 30 + lnl + lel;
    const raw = b.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    if (data) out[base] = dec.decode(data).replace(/^﻿/, "");
  }
  return out;
}

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries((head || []).map((h, i) => [h, r[i] ?? ""])));
}

/** Build letterboxd.json from an export, keeping earlier director lookups. */
export async function importExport(file, previous) {
  const files = await readZip(await file.arrayBuffer(), ["ratings.csv", "watched.csv", "watchlist.csv", "diary.csv", "profile.csv"]);
  if (!files["ratings.csv"] && !files["watched.csv"]) throw new Error("This doesn’t look like a Letterboxd export (no ratings.csv or watched.csv inside).");
  const films = {};
  const year = (y) => parseInt(String(y).slice(0, 4), 10) || null;
  const put = (t, y, fields) => {
    if (!t) return null;
    const k = filmKey(t, year(y));
    const rec = films[k] || (films[k] = { t, y: year(y) });
    Object.assign(rec, fields);
    if (previous?.films?.[k]?.d) rec.d = previous.films[k].d;
    if (previous?.films?.[k]?.tmdb) rec.tmdb = previous.films[k].tmdb;
    return rec;
  };
  for (const r of parseCSV(files["watched.csv"] || "")) put(r.Name, r.Year, { w: true });
  for (const r of parseCSV(files["ratings.csv"] || "")) {
    const x = parseFloat(r.Rating);
    put(r.Name, r.Year, { w: true, ...(x > 0 && x <= 5 ? { r: x } : {}) });
  }
  for (const r of parseCSV(files["diary.csv"] || "")) {
    const d = (r["Watched Date"] || r.Date || "").trim();
    if (!/^\d{4}-\d\d-\d\d$/.test(d)) continue;
    const rec = put(r.Name, r.Year, { w: true });
    if (rec && (!rec.lw || d > rec.lw)) rec.lw = d;
  }
  for (const r of parseCSV(files["watchlist.csv"] || "")) {
    const rec = put(r.Name, r.Year, {});
    if (rec && !rec.w) rec.wl = true;
  }
  const prof = parseCSV(files["profile.csv"] || "")[0];
  return {
    data: { version: 1, imported_at: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"), films },
    username: prof?.Username || null,       // nothing else from the profile is kept
  };
}
