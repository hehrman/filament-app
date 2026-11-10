// Searching for directors and films to add.
//  1. Screen Slate catalog: every director/film Filament has seen in NYC listings
//     (exact Screen Slate ids — the most reliable match).
//  2. Wikidata (the free database behind Wikipedia): anyone, even if they have
//     never screened in NYC, with TMDB ids, filmographies and alternate titles.
import { fold, nameKey } from "./match.js?v=20261110162704";

const WD = "https://www.wikidata.org/w/api.php";
const SPARQL = "https://query.wikidata.org/sparql";
const DIRECTOR_JOBS = new Set(["Q2526255", "Q3455803", "Q1414443", "Q28389", "Q15214752", "Q222344"]);
const FILM_TYPES = new Set(["Q11424", "Q24862", "Q506240", "Q202866", "Q93204", "Q226730", "Q5398426",
  "Q1261214", "Q17517379", "Q24869", "Q20667187", "Q18011172", "Q21191270", "Q645928", "Q622548"]);

const claimIds = (e, p) => (e.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
const claimStr = (e, p) => (e.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value).find((v) => typeof v === "string");
const claimYear = (e, p) => {
  const ys = (e.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.time).filter(Boolean)
    .map((t) => parseInt(t.slice(1, 5), 10)).filter(Boolean);
  return ys.length ? Math.min(...ys) : null;
};
const label = (e) => e.labels?.en?.value || e.labels?.mul?.value || Object.values(e.labels || {})[0]?.value || "";
const aliases = (e) => (e.aliases?.en || []).map((a) => a.value);

async function wd(params) {
  const q = new URLSearchParams({ format: "json", origin: "*", ...params });
  const r = await fetch(`${WD}?${q}`);
  if (!r.ok) throw new Error(`Wikidata ${r.status}`);
  return r.json();
}

async function entities(ids, props = "labels|aliases|claims|descriptions") {
  if (!ids.length) return {};
  const r = await wd({ action: "wbgetentities", ids: ids.join("|"), props, languages: "en|mul" });
  return r.entities || {};
}

export function searchCatalog(catalog, query, kind) {
  const q = fold(query).trim();
  if (q.length < 2 || !catalog) return [];
  const pool = kind === "director" ? Object.values(catalog.directors || {}) : Object.values(catalog.films || {});
  const field = kind === "director" ? "name" : "title";
  return pool
    .filter((x) => fold(x[field]).includes(q))
    .sort((a, b) => (fold(a[field]).startsWith(q) ? 0 : 1) - (fold(b[field]).startsWith(q) ? 0 : 1))
    .slice(0, 6);
}

export async function searchWikidataDirectors(query) {
  const hits = (await wd({ action: "wbsearchentities", search: query, language: "en", uselang: "en",
    type: "item", limit: "15" })).search || [];
  const ents = await entities(hits.map((h) => h.id));
  return hits.map((h) => ents[h.id]).filter(Boolean).filter((e) => {
    const jobs = claimIds(e, "P106");
    return jobs.some((j) => DIRECTOR_JOBS.has(j)) || claimStr(e, "P4985");
  }).slice(0, 6).map((e) => ({
    source: "wikidata", qid: e.id, name: label(e), aka: aliases(e).slice(0, 6),
    tmdb: claimStr(e, "P4985") ? Number(claimStr(e, "P4985")) : null,
    born: claimYear(e, "P569"), died: claimYear(e, "P570"),
    photo: claimStr(e, "P18") ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(claimStr(e, "P18"))}?width=300` : null,
    description: e.descriptions?.en?.value || "",
  }));
}

export async function searchWikidataFilms(query) {
  const hits = (await wd({ action: "wbsearchentities", search: query, language: "en", uselang: "en",
    type: "item", limit: "15" })).search || [];
  const ents = await entities(hits.map((h) => h.id));
  const films = hits.map((h) => ents[h.id]).filter(Boolean)
    .filter((e) => claimIds(e, "P31").some((t) => FILM_TYPES.has(t))).slice(0, 6);
  const dirIds = [...new Set(films.flatMap((f) => claimIds(f, "P57")))];
  const dirs = await entities(dirIds, "labels");
  return films.map((e) => ({
    source: "wikidata", qid: e.id, title: label(e), year: claimYear(e, "P577"),
    aka: [...new Set([...aliases(e), ...(e.claims?.P1476 || []).map((c) => c.mainsnak?.datavalue?.value?.text)]
      .filter((t) => t && t !== label(e)))].slice(0, 8),
    directors: claimIds(e, "P57").map((id) => label(dirs[id] || {})).filter(Boolean),
    description: e.descriptions?.en?.value || "",
  }));
}

export async function filmographyFor(qid) {
  const query = `SELECT ?film ?filmLabel (MIN(?y) AS ?year) (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
    ?film wdt:P57 wd:${qid} .
    OPTIONAL { ?film wdt:P577 ?d . BIND(YEAR(?d) AS ?y) }
    OPTIONAL { ?film skos:altLabel ?alt FILTER(LANG(?alt) = "en") }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
  } GROUP BY ?film ?filmLabel`;
  const r = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`,
    { headers: { Accept: "application/sparql-results+json" } });
  if (!r.ok) throw new Error(`Wikidata query ${r.status}`);
  const rows = (await r.json()).results.bindings;
  return rows
    .map((b) => ({ title: b.filmLabel?.value, year: b.year ? Number(b.year.value) : null,
      aka: (b.alts?.value || "").split("|").filter(Boolean).slice(0, 5) }))
    // undated entries are usually unrealised projects
    .filter((f) => f.title && !/^Q\d+$/.test(f.title) && f.year)
    .sort((a, b) => (a.year || 9999) - (b.year || 9999));
}

export function slugFromCatalog(catalog, tmdb, name) {
  const all = Object.values(catalog?.directors || {});
  const hit = all.find((d) => tmdb && d.tmdb === tmdb) || all.find((d) => nameKey(d.name) === nameKey(name));
  return hit ? hit.slug : null;
}
