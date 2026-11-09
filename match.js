// Mirror of monitor/match.py + monitor/normalize.py. Keep in sync:
// tests/match_vectors.json is run against both (tests/match_js.test.mjs).

const LEADING = ["the ", "a ", "an "];
const SPECIAL = { "ł": "l", "Ł": "L", "ø": "o", "Ø": "O", "ß": "ss", "æ": "ae", "œ": "oe" };

export function fold(s) {
  return (s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[łŁøØßæœ]/g, (c) => SPECIAL[c])
    .toLowerCase();
}

export function titleWords(title) {
  let t = fold(title).trim();
  t = t.replace(/\s*[([]\s*\d{4}\s*[)\]]\s*$/, "");
  t = t.replace(/&/g, " and ");
  t = t.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  for (const a of LEADING) {
    if (t.startsWith(a) && t.length > a.length) { t = t.slice(a.length); break; }
  }
  return t;
}
export const titleKey = (t) => titleWords(t).replace(/ /g, "");
export const nameKey = (n) => fold(n).replace(/[^a-z0-9]+/g, "");

function yearOk(want, got, tol = 1) {
  if (!want || !got) return null;
  return Math.abs(Number(want) - Number(got)) <= tol;
}
const titleKeys = (e) => new Set([e.title, ...(e.aka || [])].map(titleKey).filter(Boolean));
const titlePhrases = (e) => new Set([e.title, ...(e.aka || [])].map(titleWords).filter(Boolean));

function eventContains(eventTitle, phrases) {
  const words = " " + fold(eventTitle).replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim() + " ";
  for (const p of phrases) if (p.replace(/ /g, "").length >= 8 && words.includes(` ${p} `)) return true;
  return false;
}

export function creditIsDirector(credit, interest) {
  if (interest.tmdb && credit.tmdb) return Number(interest.tmdb) === Number(credit.tmdb);
  const keys = new Set([interest.name, ...(interest.aka || [])].map(nameKey).filter(Boolean));
  return keys.has(nameKey(credit.name));
}

export function matchDirector(film, interest) {
  for (const c of film.directors || []) if (creditIsDirector(c, interest)) return "director";
  const fk = titleKey(film.title);
  for (const w of interest.filmography || []) {
    if (!titleKeys(w).has(fk)) {
      if (film.event && eventContains(film.title, titlePhrases(w))) return "event";
      continue;
    }
    const y = yearOk(w.year, film.year);
    if (y === true) return "filmography";
    if (y === null && !(film.directors || []).length && !film.year) return "filmography";
  }
  return null;
}

export function matchFilm(film, interest) {
  if (interest.slug && film.slug && interest.slug === film.slug) return "film";
  if (!titleKeys(interest).has(titleKey(film.title))) {
    if (film.event && eventContains(film.title, titlePhrases(interest))) return "event";
    return null;
  }
  const y = yearOk(interest.year, film.year);
  if (y !== null) return y ? "film" : null;
  const want = new Set((interest.directors || []).filter(Boolean).map(nameKey));
  const got = new Set((film.directors || []).map((d) => nameKey(d.name)).filter(Boolean));
  if (want.size && got.size) return [...want].some((w) => got.has(w)) ? "film" : null;
  return "film";
}

export function matchOccurrence(occ, settings) {
  const out = [];
  for (const film of occ.films || []) {
    for (const d of settings.directors || []) {
      if (d.enabled === false) continue;
      const why = matchDirector(film, d);
      if (why) out.push({ kind: why, interest: d.id, label: d.name, film: film.title });
    }
    for (const f of settings.films || []) {
      if (f.enabled === false) continue;
      const why = matchFilm(film, f);
      if (why) out.push({ kind: why, interest: f.id, label: f.title, film: film.title });
    }
    // films followed automatically from Letterboxd (see letterboxd.js followList)
    for (const f of settings._letterboxd || []) {
      if (matchFilm(film, f)) out.push({ kind: "letterboxd", interest: f.id, label: f.label, film: film.title });
    }
  }
  return out;
}
