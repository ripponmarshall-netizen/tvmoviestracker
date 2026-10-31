/* wikidata.jsx — "Did You Know" on the title sheet, from Wikidata (the
   free knowledge base behind Wikipedia): awards won and nominations, box
   office against budget, what it's based on, who made it, where it was
   filmed and set, where it's from, and what comes before and after it.
   Wikidata is free and needs no key. A title is found by its TMDB id or
   IMDb id in one SPARQL query, and kept on the device: looked up again
   after 30 days, or after a week for one Wikidata hasn't got. Its data is
   CC0 (no strings), but the sheet still says where it came from. */
const { useState: useStateW, useEffect: useEffectW } = React;

const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
const WIKIDATA_STORE = "tvt:wikidata:v1";
const WIKIDATA_MAX = 300; // titles kept; past this the longest-unchecked go
const WIKIDATA_FRESH_MS = 30 * DAY_MS;
const WIKIDATA_MISS_MS = 7 * DAY_MS;
const WD_USD = "http://www.wikidata.org/entity/Q4917"; // money is shown only in US dollars
const WD_LIST_MAX = 6; // names kept per fact
const WD_AWARDS_MAX = 12;

let wikidataMem = null;
const wikidataInflight = new Map();

function wikidataAll() {
  if (!wikidataMem) {
    try { wikidataMem = JSON.parse(localStorage.getItem(WIKIDATA_STORE) || "{}") || {}; } catch { wikidataMem = {}; }
  }
  return wikidataMem;
}
let wikidataSaveTimer = 0;
function saveWikidataSoon() {
  clearTimeout(wikidataSaveTimer);
  wikidataSaveTimer = setTimeout(() => {
    const all = wikidataAll();
    const out = {};
    for (const k of Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, WIKIDATA_MAX)) out[k] = all[k];
    // Only a cache: if storage is full, drop it rather than crowd out the list.
    try { localStorage.setItem(WIKIDATA_STORE, JSON.stringify(out)); } catch { try { localStorage.removeItem(WIKIDATA_STORE); } catch {} }
  }, 500);
}
const wikidataStale = (c) => !c || Date.now() - c.at > (c.id ? WIKIDATA_FRESH_MS : WIKIDATA_MISS_MS);

/* Simple facts: a key for each, and the Wikidata property it reads. */
const WD_FACTS = [
  ["based", "P144"], ["dir", "P57"], ["creator", "P170"], ["music", "P86"], ["filmed", "P915"], ["set", "P840"],
  ["country", "P495"], ["lang", "P364"], ["series", "P179"], ["follows", "P155"], ["next", "P156"],
];

/* The query: the title (by TMDB id, or IMDb id) and one row per fact,
   tagged by ?k. Awards and nominations carry the year (P585); box office
   and budget their amount and currency. Ids are checked before they go in. */
function wikidataQuery(kind, tmdbId, imdb) {
  const find = [`{ ?item wdt:${kind === "tv" ? "P4983" : "P4947"} "${Number(tmdbId)}" }`];
  if (/^tt\d+$/.test(imdb || "")) find.push(`{ ?item wdt:P345 "${imdb}" }`);
  return `SELECT ?item ?article ?k ?v ?vLabel ?n ?unit ?when WHERE {
  ${find.join(" UNION ")}
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> }
  OPTIONAL {
    { BIND("award" AS ?k) ?item p:P166 ?st. ?st ps:P166 ?v. OPTIONAL { ?st pq:P585 ?when } }
    UNION { BIND("nom" AS ?k) ?item p:P1411 ?st. ?st ps:P1411 ?v. OPTIONAL { ?st pq:P585 ?when } }
    UNION { BIND("box" AS ?k) ?item p:P2142/psv:P2142 ?q. ?q wikibase:quantityAmount ?n; wikibase:quantityUnit ?unit }
    UNION { BIND("budget" AS ?k) ?item p:P2130/psv:P2130 ?q. ?q wikibase:quantityAmount ?n; wikibase:quantityUnit ?unit }
    UNION { VALUES (?k ?wd) { ${WD_FACTS.map(([k, p]) => `("${k}" wdt:${p})`).join(" ")} } ?item ?wd ?v. }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
} LIMIT 800`;
}

/* GET, so the browser sends no preflight; WDQS answers any origin. */
async function wikidataGet(query) {
  let res;
  try {
    res = await fetch(`${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`, { headers: { accept: "application/sparql-results+json" } });
  } catch {
    throw new Error("Couldn't reach Wikidata. Check your connection.");
  }
  if (res.status === 429) throw new Error("Wikidata is busy. Try again in a moment.");
  if (!res.ok) throw new Error(`Wikidata error ${res.status}`);
  return (await res.json())?.results?.bindings || [];
}

/* The rows as facts: { id (the Q-number, "" when not found), wiki (the
   English Wikipedia article), wins, noms, awards ([name, year], the big
   ones first), box and budget (US$), and a list of names for each of
   WD_FACTS }. A label Wikidata has only as a Q-number is left out. */
const WD_MAJOR = /academy award|oscar|primetime emmy|golden globe|bafta|palme d|golden lion|golden bear|peabody|screen actors guild|critics' choice|grammy/i;
function compactWikidata(rows) {
  const qid = (uri) => (String(uri || "").match(/Q\d+$/) || [""])[0];
  const id = qid(rows[0]?.item?.value);
  const out = { at: Date.now(), id };
  if (!id) return out;
  const wiki = rows.find((r) => r.article)?.article.value || "";
  out.wiki = /^https:\/\/en\.wikipedia\.org\//.test(wiki) ? wiki : "";
  const names = {}, wins = new Map(), noms = new Set(), money = { box: 0, budget: 0 };
  for (const r of rows) {
    if (qid(r.item?.value) !== id || !r.k) continue;
    const k = r.k.value;
    const label = String(r.vLabel?.value || "").slice(0, 120);
    const named = label && !/^Q\d+$/.test(label);
    const year = (r.when?.value || "").slice(0, 4);
    if (k === "award" && named) wins.set(`${label}|${year}`, [label, year]);
    else if (k === "nom" && named) noms.add(`${label}|${year}`);
    else if (k === "box" || k === "budget") {
      const n = Number(r.n?.value);
      if (r.unit?.value === WD_USD && n > 0) money[k] = Math.max(money[k], n);
    } else if (named) (names[k] = names[k] || new Set()).add(label);
  }
  out.wins = wins.size;
  out.noms = noms.size;
  out.awards = [...wins.values()]
    .sort((a, b) => WD_MAJOR.test(b[0]) - WD_MAJOR.test(a[0]) || b[1].localeCompare(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, WD_AWARDS_MAX);
  out.box = money.box;
  out.budget = money.budget;
  for (const [k] of WD_FACTS) if (names[k]) out[k] = [...names[k]].slice(0, WD_LIST_MAX);
  return out;
}

/* A title's place in the cache. */
const wikidataKey = (kind, tmdbId) => `${kind}:${tmdbId}`;

async function loadWikidata(t) {
  const k = wikidataKey(t.kind, t.tmdbId);
  const all = wikidataAll();
  if (!wikidataStale(all[k])) return;
  if (wikidataInflight.has(k)) return wikidataInflight.get(k);
  const p = wikidataGet(wikidataQuery(t.kind, t.tmdbId, t.imdb))
    .then((rows) => { all[k] = compactWikidata(rows); saveWikidataSoon(); })
    .finally(() => wikidataInflight.delete(k));
  wikidataInflight.set(k, p);
  return p;
}

/* useWikidata — what Wikidata has on a title ({ kind, tmdbId, imdb }),
   null until it's in. Pass null to wait (for TMDB's details, which carry
   the IMDb id). */
function useWikidata(t) {
  const [, setV] = useStateW(0);
  const k = t?.tmdbId ? wikidataKey(t.kind, t.tmdbId) : "";
  useEffectW(() => {
    if (!k) return;
    let live = true;
    loadWikidata(t).catch(() => {}).finally(() => { if (live) setV((v) => v + 1); });
    return () => { live = false; };
  }, [k, t?.imdb]);
  return k ? wikidataAll()[k] || null : null;
}

/* ============ On the title sheet ============ */
/* US$ as "$262.7M". */
const fmtUsd = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
/* ["A", "B", "C"] as "A, B and C". */
const andList = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0] || "");

/* Box office against budget, as a line and the story it tells. */
function moneyFact(w) {
  if (w.box && w.budget) {
    const x = w.box / w.budget;
    const sub = x >= 2 ? `About ${x >= 10 ? Math.round(x) : x.toFixed(1)} times what it cost to make`
      : x >= 1 ? "It made back its budget, just about"
      : `It made back only ${Math.round(x * 100)}% of what it cost`;
    return { label: "Box office", value: `${fmtUsd(w.box)} on a ${fmtUsd(w.budget)} budget`, sub };
  }
  if (w.box) return { label: "Box office", value: fmtUsd(w.box) };
  if (w.budget) return { label: "Budget", value: fmtUsd(w.budget) };
  return null;
}

/* The facts as rows for the card, the most interesting first. */
function wikidataFacts(w) {
  const rows = [];
  if (w.wins || w.noms) {
    const value = w.wins
      ? `Won ${plural(w.wins, "award")}${w.noms ? ` · ${plural(w.noms, "nomination")}` : ""}`
      : `${plural(w.noms, "nomination")}`;
    rows.push({ k: "awards", label: "Awards", value, list: (w.awards || []).slice(0, 4).map(([n, y]) => (y ? `${n} (${y})` : n)), more: Math.max(0, w.wins - 4) });
  }
  const money = moneyFact(w);
  if (money) rows.push({ k: "money", ...money });
  if (w.based) rows.push({ k: "based", label: "Based on", value: andList(w.based) });
  const made = [
    w.dir && `Directed by ${andList(w.dir)}`,
    w.creator && `Created by ${andList(w.creator)}`,
    w.music && `Music by ${andList(w.music)}`,
  ].filter(Boolean);
  if (made.length) rows.push({ k: "made", label: "Made by", value: made.join(" · ") });
  const where = [w.filmed && `Filmed in ${andList(w.filmed.slice(0, 4))}`, w.set && `Set in ${andList(w.set.slice(0, 4))}`].filter(Boolean);
  if (where.length) rows.push({ k: "where", label: "Locations", value: where.join(" · ") });
  const from = [w.country && andList(w.country), w.lang && `in ${andList(w.lang)}`].filter(Boolean);
  if (from.length) rows.push({ k: "from", label: "From", value: from.join(", ") });
  const series = [w.series && `Part of ${andList(w.series)}`, w.follows && `Follows ${andList(w.follows)}`, w.next && `Followed by ${andList(w.next)}`].filter(Boolean);
  if (series.length) rows.push({ k: "series", label: "Series", value: series.join(" · ") });
  return rows;
}

/* The Did You Know section: nothing at all until Wikidata has something
   to say. */
function WikidataSection({ w }) {
  if (!w?.id) return null;
  const rows = wikidataFacts(w);
  if (!rows.length && !w.wiki) return null;
  const link = { color: "var(--accent)", textDecoration: "none", fontSize: 13.5, fontWeight: 600 };
  return (
    <DetailSection title="Did You Know">
      {rows.length > 0 && (
        <div style={{ background: "var(--bg-2)", borderRadius: 16, padding: "2px 14px" }}>
          {rows.map((r, i) => (
            <div key={r.k} className="tvt-pop" style={{ display: "block", padding: "11px 0", borderTop: i ? "1px solid var(--line-soft)" : "none" }}>
              <div className="label">{r.label}</div>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, marginTop: 3, overflowWrap: "anywhere" }}>{r.value}</div>
              {r.sub && <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 2 }}>{r.sub}</div>}
              {r.list?.length > 0 && (
                <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.45, marginTop: 6 }}>
                  {r.list.map((x) => <div key={x}>· {x}</div>)}
                  {r.more > 0 && <div style={{ color: "var(--ink-faint)" }}>and {r.more} more</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 16, marginTop: rows.length ? 10 : 0 }}>
        {w.wiki && <a href={w.wiki} target="_blank" rel="noopener noreferrer" style={link}>Read on Wikipedia</a>}
        <a href={`https://www.wikidata.org/wiki/${w.id}`} target="_blank" rel="noopener noreferrer" style={{ ...link, color: "var(--ink-dim)", fontWeight: 500 }}>Wikidata</a>
      </div>
    </DetailSection>
  );
}

Object.assign(window, { useWikidata, WikidataSection, fmtUsd });
