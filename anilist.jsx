/* anilist.jsx — anime, from AniList (anilist.co, the anime tracking
   database). Free and needs no key: one GraphQL endpoint that answers any
   origin. Three ways in:

   - On the title sheet, for anime (TMDB's Animation genre in Japanese, or
     a title opened from AniList): AniList's score, rank and members, the
     studio, source, season and format, the exact time the next episode
     airs, tags, and the prequels, sequels and spin-offs around it.
   - Explore → Anime: what's trending, airing this season, coming next
     season, popular and top rated, straight from AniList, and anime search.
     A title opened from there is matched to its TMDB show (for posters,
     episodes and tracking) when there's a TMDB key.
   - Settings → AniList: your public AniList list brought into the library.
     AniList splits a show into one entry per season (or cour); TMDB keeps
     one show with seasons. Each entry is matched to its TMDB show, by its
     own name or else its prequel's, and your progress through the entries
     is added up and laid onto TMDB's seasons.

   Everything is kept on the device (tvt:anilist:v1): a title's facts for
   a day (12 hours while it airs), the AniList ↔ TMDB links for a month. */
const { useState: useStateN, useEffect: useEffectN, useRef: useRefN } = React;

const ANILIST_API = "https://graphql.anilist.co";
const ANILIST_STORE = "tvt:anilist:v1"; // { m: media by id, l: links, x: Explore lists }
const ANILIST_CONF = "tvt:anilistconf:v1"; // { user, imported }
const ANILIST_MEDIA_MAX = 300;
const ANILIST_LINKS_MAX = 3000;
const ANILIST_FRESH_MS = DAY_MS;
const ANILIST_AIRING_MS = 12 * 36e5;
const ANILIST_LINK_MS = 30 * DAY_MS;
const ANILIST_MISS_MS = 7 * DAY_MS; // a title AniList (or TMDB) hasn't got is looked for again after this
const ANILIST_LIST_FRESH_MS = 30 * 60e3;
// Formats that are a show's run of episodes (one entry per season or
// cour); films are movies; OVAs, specials and music videos aren't tracked.
const ANI_SERIES = new Set(["TV", "TV_SHORT", "ONA"]);

/* ============ Requests ============
   AniList allows about 90 requests a minute (fewer when it's busy). Two
   go at once; a 429 pauses everything for as long as it asks, then tries
   again. */
let aniActive = 0;
let aniPauseUntil = 0;
const aniWaiting = [];
const aniSleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function aniSlot() {
  if (aniActive >= 2) await new Promise((r) => aniWaiting.push(r));
  aniActive++;
}
function aniRelease() {
  aniActive--;
  aniWaiting.shift()?.();
}

/* POST a query. Resolves with its data (null when AniList found nothing);
   rejects with a message to show for anything else. */
async function anilistQuery(query, variables = {}) {
  await aniSlot();
  try {
    for (let tries = 0; ; tries++) {
      const wait = aniPauseUntil - Date.now();
      if (wait > 0) await aniSleep(wait);
      let res;
      try {
        res = await fetch(ANILIST_API, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query, variables }),
        });
      } catch {
        throw new Error("Couldn't reach AniList. Check your connection.");
      }
      if (res.status === 429) {
        if (tries >= 2) throw new Error("AniList is busy. Try again in a minute.");
        aniPauseUntil = Date.now() + Math.min(65, Number(res.headers.get("Retry-After")) || 20) * 1000;
        continue;
      }
      const body = await res.json().catch(() => null);
      const msg = String(body?.errors?.[0]?.message || "");
      if (/private/i.test(msg)) throw new Error("That AniList profile is private. Make your list public in AniList's settings, then try again.");
      if (/user not found/i.test(msg)) throw new Error("There's no AniList user by that name.");
      if (res.status === 404) return body?.data || null;
      if (!res.ok) throw new Error(`AniList error ${res.status}`);
      return body?.data || null;
    }
  } finally {
    aniRelease();
  }
}

/* ============ The cache ============ */
let aniMem = null;
const aniSubs = new Set();
function anilistAll() {
  if (!aniMem) {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(ANILIST_STORE) || "{}") || {}; } catch {}
    aniMem = { m: s.m || {}, l: s.l || {}, x: s.x || {} };
  }
  return aniMem;
}
let aniSaveTimer = 0;
function saveAnilistSoon() {
  clearTimeout(aniSaveTimer);
  aniSaveTimer = setTimeout(() => {
    const all = anilistAll();
    const newest = (o, max) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1].at - a[1].at).slice(0, max));
    const x = Object.fromEntries(Object.entries(all.x).filter(([, v]) => Date.now() - v.at < 14 * DAY_MS));
    // Only a cache: if storage is full, drop it rather than crowd out the list.
    try { localStorage.setItem(ANILIST_STORE, JSON.stringify({ m: newest(all.m, ANILIST_MEDIA_MAX), l: newest(all.l, ANILIST_LINKS_MAX), x })); }
    catch { try { localStorage.removeItem(ANILIST_STORE); } catch {} }
  }, 600);
}
// Batched, like TMDB's, so a burst of answers re-renders once.
let aniNotifyTimer = 0;
function notifyAnilist() {
  if (aniNotifyTimer) return;
  aniNotifyTimer = setTimeout(() => {
    aniNotifyTimer = 0;
    aniSubs.forEach((fn) => fn());
  }, 60);
}
function useAnilistVersion() {
  const [, setV] = useStateN(0);
  useEffectN(() => {
    const fn = () => setV((v) => v + 1);
    aniSubs.add(fn);
    return () => { aniSubs.delete(fn); };
  }, []);
}

/* Links between the two databases: "a:<AniList id>" → the TMDB title
   ({ kind, id }, or id 0 for none), and "t:<kind>:<TMDB id>" → the AniList
   id of its first season (0 for none). */
function aniLink(k) {
  const v = anilistAll().l[k];
  return v && Date.now() - v.at < (v.id ? ANILIST_LINK_MS : ANILIST_MISS_MS) ? v : null;
}
function setAniLink(k, v) {
  anilistAll().l[k] = { ...v, at: Date.now() };
  saveAnilistSoon();
}
/* The TMDB title an AniList id was matched to, if it's known. */
function anilistTmdb(anilistId) {
  const v = anilistId ? aniLink(`a:${anilistId}`) : null;
  return v?.id ? { kind: v.kind, tmdbId: v.id } : null;
}

/* ============ Media ============ */
const MEDIA_FIELDS = `id idMal type format status episodes duration season seasonYear
  startDate { year month day } title { romaji english native } synonyms
  coverImage { large color } bannerImage description(asHtml: false)
  averageScore popularity favourites genres source countryOfOrigin siteUrl
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt }
  rankings { rank type allTime context season year }
  tags { name rank isMediaSpoiler isGeneralSpoiler }
  relations { edges { relationType node { id type format status episodes seasonYear startDate { year }
    title { romaji english } coverImage { large } } } }`;
// The little Explore and search need for a card.
const TILE_FIELDS = `id format status episodes season seasonYear startDate { year month day }
  title { romaji english } coverImage { large color } bannerImage averageScore popularity
  nextAiringEpisode { episode airingAt }`;

const httpsUrl = (u) => (/^https:\/\/[^\s"'<>]+$/.test(u || "") ? u : "");
const aniTitle = (t) => String(t?.english || t?.romaji || "").trim().slice(0, 200);
const pad2 = (n) => String(n).padStart(2, "0");
function fuzzyDate(d) {
  return d?.year && d.month && d.day ? `${d.year}-${pad2(d.month)}-${pad2(d.day)}` : "";
}
const capWord = (s) => String(s || "").charAt(0) + String(s || "").slice(1).toLowerCase();
/* "TV_SHORT" as "TV Short", "LIGHT_NOVEL" as "Light Novel". */
const aniEnum = (s) => String(s || "").split("_").map((w) => (w === "TV" || w === "OVA" || w === "ONA" ? w : capWord(w))).join(" ");

/* The parts of an AniList Media the sheet shows. */
function compactMedia(m) {
  const sd = m.startDate || {};
  const tags = (m.tags || []).filter((t) => !t.isMediaSpoiler && !t.isGeneralSpoiler && t.rank >= 60).slice(0, 8).map((t) => String(t.name).slice(0, 40));
  const ranks = (m.rankings || []).filter((r) => r.allTime);
  const rank = ranks.find((r) => r.type === "RATED") || ranks.find((r) => r.type === "POPULAR") || null;
  const KEEP = ["PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "SUMMARY", "OTHER"];
  const rel = (m.relations?.edges || [])
    .filter((e) => e.node?.type === "ANIME" && KEEP.includes(e.relationType) && aniTitle(e.node.title))
    .sort((a, b) => KEEP.indexOf(a.relationType) - KEEP.indexOf(b.relationType))
    .slice(0, 12)
    .map((e) => ({
      type: e.relationType, id: e.node.id, title: aniTitle(e.node.title), format: e.node.format || "",
      year: String(e.node.seasonYear || e.node.startDate?.year || ""), eps: e.node.episodes || 0, img: httpsUrl(e.node.coverImage?.large),
    }));
  const prequel = rel.find((r) => r.type === "PREQUEL" && ANI_SERIES.has(r.format));
  return {
    at: Date.now(), id: m.id, mal: m.idMal || 0,
    kind: m.format === "MOVIE" ? "movie" : "tv", format: m.format || "", status: m.status || "",
    title: aniTitle(m.title), romaji: String(m.title?.romaji || "").slice(0, 200), english: String(m.title?.english || "").slice(0, 200),
    native: String(m.title?.native || "").slice(0, 200),
    year: String(m.seasonYear || sd.year || ""), date: fuzzyDate(sd), season: m.season || "",
    eps: m.episodes || 0, dur: m.duration || 0,
    img: httpsUrl(m.coverImage?.large), color: /^#[0-9a-f]{6}$/i.test(m.coverImage?.color || "") ? m.coverImage.color : "",
    banner: httpsUrl(m.bannerImage),
    about: plainText(String(m.description || "").replace(/<br\s*\/?>/gi, " ")).slice(0, 900),
    score: m.averageScore || 0, members: m.popularity || 0, favs: m.favourites || 0,
    genres: (m.genres || []).slice(0, 5), source: m.source || "", studio: m.studios?.nodes?.[0]?.name || "",
    next: m.nextAiringEpisode?.airingAt ? { ep: m.nextAiringEpisode.episode, at: m.nextAiringEpisode.airingAt * 1000 } : null,
    rank: rank ? { n: rank.rank, type: rank.type, context: String(rank.context || "") } : null,
    tags, rel, prequel: prequel?.id || 0,
    url: httpsUrl(m.siteUrl) || `https://anilist.co/anime/${m.id}`,
  };
}
const mediaStale = (c) => !c || Date.now() - c.at > (c.status === "RELEASING" ? ANILIST_AIRING_MS : ANILIST_FRESH_MS);

const aniInflight = new Map();
function aniOnce(k, fn) {
  if (aniInflight.has(k)) return aniInflight.get(k);
  const p = fn().finally(() => { aniInflight.delete(k); notifyAnilist(); });
  aniInflight.set(k, p);
  return p;
}

/* A title's facts by AniList id, fetched if stale. A failed refresh keeps
   what was there. */
async function loadAnilistMedia(id) {
  const all = anilistAll();
  if (!mediaStale(all.m[id])) return all.m[id];
  return aniOnce(`m:${id}`, async () => {
    const data = await anilistQuery(`query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`, { id: Number(id) });
    if (data?.Media?.id) {
      all.m[id] = compactMedia(data.Media);
      saveAnilistSoon();
    }
    return all.m[id] || null;
  });
}

/* ============ TMDB → AniList ============
   An anime from TMDB is found on AniList by name (its Japanese name first,
   which AniList matches against the original title), of the same type, out
   the same year (give or take one). For a show, the entry that has no
   prequel is preferred: TMDB's first air date is its first season's. */
const squash = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
async function findAnilistId(t) {
  const formats = t.kind === "movie" ? ["MOVIE"] : ["TV", "TV_SHORT", "ONA", "OVA"];
  const year = Number(t.year) || 0;
  const names = new Set([normTitle(t.title), normTitle(t.orig)].filter(Boolean));
  const native = squash(t.orig);
  const queries = [...new Set([t.orig, t.title].filter((q) => q && q.trim().length > 1))];
  for (const search of queries) {
    const data = await anilistQuery(`query ($s: String, $f: [MediaFormat]) { Page(perPage: 10) { media(search: $s, type: ANIME, format_in: $f, sort: SEARCH_MATCH) {
      id format seasonYear startDate { year } title { romaji english native } synonyms
      relations { edges { relationType node { id type format } } } } } }`, { s: search, f: formats });
    const list = data?.Page?.media || [];
    const named = (m) => [m.title?.english, m.title?.romaji, ...(m.synonyms || [])].some((x) => names.has(normTitle(x))) || (native && squash(m.title?.native) === native);
    const yearOf = (m) => m.seasonYear || m.startDate?.year || 0;
    const root = (m) => !(m.relations?.edges || []).some((e) => e.relationType === "PREQUEL" && e.node?.type === "ANIME" && ANI_SERIES.has(e.node.format));
    const score = (m) => (named(m) ? 4 : 0) + (year && yearOf(m) === year ? 3 : year && Math.abs(yearOf(m) - year) === 1 ? 1 : 0) + (t.kind === "tv" && root(m) ? 1 : 0);
    // With a year it must be out then (±1); without, the name must match.
    const fits = (m) => (year ? Math.abs(yearOf(m) - year) <= 1 && (named(m) || yearOf(m) === year) : named(m));
    const best = list.filter(fits).sort((a, b) => score(b) - score(a))[0];
    if (best) return best.id;
  }
  return 0;
}

/* ============ AniList → TMDB ============
   An AniList entry is matched to TMDB by its own name (English, romaji or
   Japanese against TMDB's name and original name), an animated title of
   the same type out within a year of it. A sequel AniList names "Season 3
   Part 2" isn't a show on TMDB: it takes its prequel's show. */
const SEQUEL_TAIL = /\s*(?:[:\-–—]\s*)?(?:(?:the\s+)?final\s+season.*|season\s*\d+.*|\d+(?:st|nd|rd|th)\s+season.*|part\s*\d+.*|cour\s*\d+.*)$|\s+(?:II|III|IV|V|VI|[2-6])$/i;
const baseTitle = (t) => { const b = String(t || "").replace(SEQUEL_TAIL, "").trim(); return b && b !== t ? b : ""; };

async function tmdbAnimeMatch(m, key) {
  const movie = m.kind === "movie";
  const year = Number(m.year) || 0;
  const tryNames = async (queries, names, native, loose) => {
    for (const q of [...new Set(queries.filter((x) => x && x.trim().length > 1))]) {
      const data = await tmdbRetry(() => tmdbGet(movie ? "/search/movie" : "/search/tv", { query: q, include_adult: "false", language: TMDB_LANGUAGE, page: "1" }, key));
      const hit = (data.results || []).find((r) => {
        if (!(r.genre_ids || []).includes(16)) return false; // animated only: not the live-action remake
        const name = normTitle(movie ? r.title : r.name), orig = movie ? r.original_title : r.original_name;
        if (!(names.has(name) || names.has(normTitle(orig)) || (native && squash(orig) === native))) return false;
        const y = Number(((movie ? r.release_date : r.first_air_date) || "").slice(0, 4));
        return !year || !y || (loose ? y <= year + 1 : Math.abs(y - year) <= 1);
      });
      if (hit) return tmdbTile(hit, movie ? "movie" : "tv");
    }
    return null;
  };
  const titles = [m.english, m.romaji, m.title].filter(Boolean);
  const own = await tryNames([...titles, m.native], new Set(titles.map(normTitle).filter(Boolean)), squash(m.native), false);
  if (own || movie || !m.prequel) return own;
  // A sequel: its name without "Season 2" may be the show's.
  const bases = [...new Set(titles.map(baseTitle).filter(Boolean))];
  return bases.length ? tryNames(bases, new Set(bases.map(normTitle)), "", true) : null;
}

/* The TMDB title for an AniList id: its own match, else its prequel's
   (up to six seasons back). Linked both ways, so the title sheet finds
   AniList again from TMDB. */
async function resolveAnilistToTmdb(id, key, depth = 0) {
  const have = aniLink(`a:${id}`);
  if (have) return have.id ? { kind: have.kind, tmdbId: have.id } : null;
  if (!key) return null;
  return aniOnce(`r:${id}`, async () => {
    const m = await loadAnilistMedia(id);
    if (!m) return null;
    const tile = await tmdbAnimeMatch(m, key);
    if (tile) {
      setAniLink(`a:${id}`, { kind: tile.kind, id: tile.tmdbId });
      if (!m.prequel || !aniLink(`t:${tile.kind}:${tile.tmdbId}`)?.id) setAniLink(`t:${tile.kind}:${tile.tmdbId}`, { id });
      return { kind: tile.kind, tmdbId: tile.tmdbId };
    }
    const up = m.prequel && depth < 6 ? await resolveAnilistToTmdb(m.prequel, key, depth + 1) : null;
    setAniLink(`a:${id}`, up ? { kind: up.kind, id: up.tmdbId } : { id: 0 });
    return up;
  });
}

/* ============ Hooks ============ */
/* useAnilist — AniList's facts for a title: `t` is { anilistId } (opened
   from AniList) or { kind, tmdbId, title, orig, year } (an anime from
   TMDB), or null to skip. Returns { m, loading }. */
function useAnilist(t) {
  useAnilistVersion();
  const tk = t?.tmdbId ? `t:${t.kind}:${t.tmdbId}` : "";
  const linked = t?.anilistId || (tk ? aniLink(tk)?.id : 0) || 0;
  const want = t?.anilistId ? `a${t.anilistId}` : tk;
  useEffectN(() => {
    if (!want) return;
    (async () => {
      let id = t.anilistId || aniLink(tk)?.id;
      if (!id && !aniLink(tk)) {
        id = await aniOnce(`f:${tk}`, () => findAnilistId(t));
        setAniLink(tk, { id });
      }
      if (id) await loadAnilistMedia(id);
    })().catch(() => {}).finally(notifyAnilist);
  }, [want]);
  const m = linked ? anilistAll().m[linked] || null : null;
  return { m, loading: !!want && !m && [...aniInflight.keys()].length > 0 };
}

/* useAnimeTmdb — for a title opened from AniList, its TMDB match
   ({ kind, tmdbId }), null when there's none (or no key), undefined while
   it's being looked for. */
function useAnimeTmdb(anilistId, key) {
  useAnilistVersion();
  const known = anilistId ? aniLink(`a:${anilistId}`) : null;
  const [done, setDone] = useStateN(false);
  useEffectN(() => {
    setDone(false);
    if (!anilistId || !key || known) return;
    let live = true;
    resolveAnilistToTmdb(anilistId, key).catch(() => {}).finally(() => { if (live) setDone(true); });
    return () => { live = false; };
  }, [anilistId, key]);
  if (!anilistId) return null;
  if (known) return known.id ? { kind: known.kind, tmdbId: known.id } : null;
  return key && !done ? undefined : null;
}

/* ============ Explore ============ */
const ANI_SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"];
/* The anime season a date falls in, as AniList lists them by premiere
   (Winter is January to March), `shift` seasons on. */
function anilistSeason(date = new Date(), shift = 0) {
  const q = Math.floor(date.getMonth() / 3) + shift;
  return { season: ANI_SEASONS[((q % 4) + 4) % 4], year: date.getFullYear() + Math.floor(q / 4) };
}
const seasonName = (s) => (s === "FALL" ? "Autumn" : capWord(s));

/* A card from AniList: the shape tmdbTile makes, with the AniList id,
   its cover (img) and banner as URLs, and when its next episode airs. */
function anilistTile(m) {
  const title = aniTitle(m?.title);
  if (!m?.id || !title) return null;
  const sd = m.startDate || {};
  const link = anilistTmdb(m.id);
  return {
    anilistId: m.id, kind: m.format === "MOVIE" ? "movie" : "tv", title, anime: true,
    tmdbId: link?.tmdbId || null,
    year: String(m.seasonYear || sd.year || ""), date: fuzzyDate(sd),
    poster: "", backdrop: "", img: httpsUrl(m.coverImage?.large), banner: httpsUrl(m.bannerImage),
    vote: (m.averageScore || 0) / 10, votes: m.averageScore ? m.popularity || 1 : 0, overview: "",
    format: m.format || "", eps: m.episodes || 0,
    next: m.nextAiringEpisode?.airingAt ? { ep: m.nextAiringEpisode.episode, at: m.nextAiringEpisode.airingAt * 1000 } : null,
  };
}

/* The Anime shelves, one request for all of them (aliases). The season
   names are AniList's own enum values, never typed in. */
function animeShelves(now = new Date()) {
  const cur = anilistSeason(now), nxt = anilistSeason(now, 1);
  return [
    { k: "trending", title: "Trending Now", args: "sort: TRENDING_DESC" },
    { k: "season", title: `${seasonName(cur.season)} ${cur.year}`, eyebrow: "Airing this season", args: `season: ${cur.season}, seasonYear: ${cur.year}, sort: POPULARITY_DESC` },
    { k: "next", title: `${seasonName(nxt.season)} ${nxt.year}`, eyebrow: "Coming next season", args: `season: ${nxt.season}, seasonYear: ${nxt.year}, sort: POPULARITY_DESC` },
    { k: "popular", title: "All-Time Popular", args: "sort: POPULARITY_DESC" },
    { k: "top", title: "Top Rated", args: "sort: SCORE_DESC" },
    { k: "movies", title: "Anime Movies", args: "format: MOVIE, sort: POPULARITY_DESC" },
  ];
}
let aniExploreMounted = 0;
function loadAnimeExplore() {
  const shelves = animeShelves();
  const k = `explore:${shelves[1].title}`;
  return aniOnce(`x:${k}`, async () => {
    const q = `query { ${shelves.map((s) => `${s.k}: Page(perPage: 20) { media(type: ANIME, isAdult: false, ${s.args}) { ${TILE_FIELDS} } }`).join("\n")} }`;
    const data = await anilistQuery(q);
    const lists = {};
    for (const s of shelves) lists[s.k] = (data?.[s.k]?.media || []).map(anilistTile).filter(Boolean);
    anilistAll().x[k] = { at: Date.now(), lists };
    saveAnilistSoon();
    return lists;
  });
}
/* useAnimeExplore — { shelves, lists (null until in), error, retry }. */
function useAnimeExplore() {
  useAnilistVersion();
  const shelves = animeShelves();
  const k = `explore:${shelves[1].title}`;
  const [error, setError] = useStateN("");
  const [attempt, setAttempt] = useStateN(0);
  useEffectN(() => {
    aniExploreMounted++;
    setError("");
    const c = anilistAll().x[k];
    if (!c || Date.now() - c.at > ANILIST_LIST_FRESH_MS) loadAnimeExplore().catch((e) => setError(e.message || "Couldn't load anime"));
    return () => { aniExploreMounted--; };
  }, [k, attempt]);
  const c = anilistAll().x[k];
  // Cards pick up TMDB links made since the list was saved.
  const lists = c ? Object.fromEntries(Object.entries(c.lists).map(([n, l]) => [n, l.map((t) => (t.tmdbId ? t : { ...t, tmdbId: anilistTmdb(t.anilistId)?.tmdbId || null }))])) : null;
  return { shelves, lists, error, retry: () => setAttempt((a) => a + 1) };
}
/* Pull to refresh: the Anime shelves afresh, if they're on screen. */
function refreshAnilist() {
  if (!aniExploreMounted) return Promise.resolve(0);
  return loadAnimeExplore().then(() => 1);
}

/* useAnilistSearch — AniList's matches for `query`, a beat after the
   typing stops; same shape as useTmdbSearch. */
function useAnilistSearch(query, enabled) {
  const [state, setState] = useStateN({ results: [], loading: false, error: "" });
  const q = query.trim();
  useEffectN(() => {
    if (!enabled || q.length < 2) { setState({ results: [], loading: false, error: "" }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    const t = setTimeout(() => {
      anilistQuery(`query ($s: String) { Page(perPage: 20) { media(search: $s, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { ${TILE_FIELDS} } } }`, { s: q })
        .then((data) => { if (live) setState({ results: (data?.Page?.media || []).map(anilistTile).filter(Boolean), loading: false, error: "" }); })
        .catch((e) => { if (live) setState({ results: [], loading: false, error: e.message || "Search failed" }); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [q, enabled]);
  return state;
}

/* ============ On the title sheet ============ */
/* When a time is from now: "in 3 days", "in 5 hours", "in 20 min". */
function fmtCountdown(at, now = Date.now()) {
  const min = Math.round((at - now) / 60000);
  if (min <= 0) return "out now";
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 36) return `in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}
const fmtAiring = (at) => new Date(at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const RELATION_LABELS = { PREQUEL: "Prequel", SEQUEL: "Sequel", PARENT: "Main story", SIDE_STORY: "Side story", SPIN_OFF: "Spin-off", ALTERNATIVE: "Alternative", SUMMARY: "Recap", OTHER: "Related" };

/* The On AniList section: score, members and rank in a strip, the next
   episode to the minute, the studio and where it's from, tags, and the
   titles around it (tap one to open it). Nothing until AniList has it. */
function AnilistSection({ m, onOpen }) {
  if (!m?.id) return null;
  const cells = [
    m.score > 0 && { label: "Score", value: `${m.score}%`, sub: m.members ? `${fmtCount(m.members)} members` : "on AniList" },
    m.rank && { label: m.rank.type === "RATED" ? "Rank" : "Popularity", value: `#${m.rank.n.toLocaleString("en-GB")}`, sub: m.rank.type === "RATED" ? "highest rated" : "most popular" },
    m.favs > 0 && { label: "Favourites", value: fmtCount(m.favs), sub: "hearts" },
  ].filter(Boolean);
  const rows = [
    m.next && { k: "next", label: `Episode ${m.next.ep}`, value: fmtAiring(m.next.at), sub: fmtCountdown(m.next.at), accent: true },
    m.studio && { k: "studio", label: "Studio", value: m.studio },
    { k: "format", label: "Format", value: [aniEnum(m.format), m.eps ? plural(m.eps, "episode") : m.status === "RELEASING" ? "Airing" : "", m.dur ? `${m.dur} min` : ""].filter(Boolean).join(" · ") },
    (m.season || m.year) && { k: "season", label: "Season", value: [m.season ? seasonName(m.season) : "", m.year].filter(Boolean).join(" "), sub: m.status === "NOT_YET_RELEASED" ? "Not out yet" : m.status === "RELEASING" ? "Airing now" : "" },
    m.source && m.source !== "ORIGINAL" && { k: "source", label: "Based on", value: `A ${aniEnum(m.source).toLowerCase()}` },
    m.source === "ORIGINAL" && { k: "source", label: "Story", value: "An original" },
  ].filter(Boolean);
  const link = { color: "var(--accent)", textDecoration: "none", fontSize: 13.5, fontWeight: 600 };
  return (
    <DetailSection title="On AniList">
      {cells.length > 0 && (
        <div style={{ background: "var(--bg-2)", borderRadius: 16, overflow: "hidden", marginBottom: 10 }}>
          <InfoStrip cells={cells} flat />
        </div>
      )}
      <div style={{ background: "var(--bg-2)", borderRadius: 16, padding: "2px 14px" }}>
        {rows.map((r, i) => (
          <div key={r.k} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "11px 0", borderTop: i ? "1px solid var(--line-soft)" : "none" }}>
            <div className="label" style={{ width: 86, flexShrink: 0, color: r.accent ? "var(--accent)" : undefined }}>{r.label}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, overflowWrap: "anywhere" }}>{r.value}</div>
              {r.sub && <div style={{ fontSize: 12.5, color: r.accent ? "var(--accent)" : "var(--ink-dim)", marginTop: 2 }}>{r.sub}</div>}
            </div>
          </div>
        ))}
      </div>
      {m.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          {m.tags.map((t, i) => (
            <span key={t} className="tvt-chip-in" style={{ fontSize: 12.5, padding: "5px 10px", borderRadius: 999, background: "var(--fill)", color: "var(--ink-dim)", animationDelay: `${i * 30}ms` }}>{t}</span>
          ))}
        </div>
      )}
      {m.rel.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="label" style={{ margin: "0 0 8px" }}>Around it</div>
          <div className="tvt-shelf" style={{ margin: "0 -20px", padding: "2px 20px 6px", scrollPadding: "0 20px" }}>
            {m.rel.map((r) => (
              <PosterCard key={r.id} width={96} onOpen={onOpen}
                tile={{ anilistId: r.id, kind: r.format === "MOVIE" ? "movie" : "tv", title: r.title, year: r.year, poster: "", img: r.img, anime: true, tmdbId: anilistTmdb(r.id)?.tmdbId || null }}
                sub={[RELATION_LABELS[r.type], r.format === "MOVIE" ? "Movie" : r.year].filter(Boolean).join(" · ")} />
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
        <a href={m.url} target="_blank" rel="noopener noreferrer" style={link}>Open on AniList</a>
        {m.mal > 0 && <a href={`https://myanimelist.net/anime/${m.mal}`} target="_blank" rel="noopener noreferrer" style={{ ...link, color: "var(--ink-dim)", fontWeight: 500 }}>MyAnimeList</a>}
      </div>
    </DetailSection>
  );
}

/* ============ Your AniList, into the library ============ */
const LIST_FIELDS = `id format episodes seasonYear startDate { year } title { english romaji native }
  relations { edges { relationType node { id type format } } }`;
const ANI_STATUS = { CURRENT: "watching", REPEATING: "watching", PAUSED: "watching", DROPPED: "watching", COMPLETED: "watched", PLANNING: "watchlist" };
const aniDate = (sec) => (sec > 0 ? new Date(sec * 1000).toISOString() : "");
const fuzzyIso = (d) => { const s = fuzzyDate(d); return s ? new Date(`${s}T20:00:00`).toISOString() : ""; };
const prequelOf = (m) => (m.relations?.edges || []).find((e) => e.relationType === "PREQUEL" && e.node?.type === "ANIME" && ANI_SERIES.has(e.node.format))?.node.id || 0;

/* An absolute episode count (12 into season 1's 10 is S2 · E2) laid onto
   TMDB's seasons; past the last one known, the last episode. */
function absToSeasonEp(abs, d) {
  if (!(abs > 0)) return { season: 1, episode: 0 };
  const ss = d?.seasons ? Object.keys(d.seasons).map(Number).filter((s) => s > 0).sort((a, b) => a - b) : [];
  if (!ss.length) return { season: 1, episode: abs };
  let left = abs;
  for (const s of ss) {
    if (left <= d.seasons[s]) return { season: s, episode: left };
    left -= d.seasons[s];
  }
  const last = ss[ss.length - 1];
  return { season: last, episode: d.seasons[last] };
}

/* fetchAnilistLibrary — a public AniList list as import "files" for
   planImport. Each show's entries (one per season) become one title on its
   TMDB show, at the furthest episode you've reached across them; movies are
   movies. `onStep(text)` hears how it's going. Needs the TMDB key. */
async function fetchAnilistLibrary(user, key, onStep = () => {}) {
  onStep("Reading your list…");
  const entries = new Map(); // media id → list entry
  for (let chunk = 1; chunk <= 20; chunk++) {
    const data = await anilistQuery(`query ($u: String, $c: Int) { MediaListCollection(userName: $u, type: ANIME, chunk: $c, perChunk: 500, forceSingleCompletedList: true) {
      hasNextChunk lists { entries { status progress score(format: POINT_100) updatedAt createdAt completedAt { year month day } media { ${LIST_FIELDS} } } } } }`, { u: user, c: chunk });
    const col = data?.MediaListCollection;
    if (!col) throw new Error("There's no AniList user by that name.");
    for (const l of col.lists || []) for (const e of l.entries || []) if (e.media?.id && !entries.has(e.media.id)) entries.set(e.media.id, e);
    if (!col.hasNextChunk) break;
  }
  if (!entries.size) return { files: [], total: 0, skipped: 0, unmatched: 0 };

  // Every show entry's prequels, back to its first season, even ones not on
  // your list (their episodes count towards where you are).
  const media = new Map([...entries.values()].map((e) => [e.media.id, e.media]));
  for (let round = 0; round < 8; round++) {
    const missing = [...new Set([...media.values()].map(prequelOf).filter((id) => id && !media.has(id)))];
    if (!missing.length) break;
    onStep("Finding earlier seasons…");
    for (let i = 0; i < missing.length; i += 50) {
      const data = await anilistQuery(`query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ${LIST_FIELDS} } } }`, { ids: missing.slice(i, i + 50) });
      for (const m of data?.Page?.media || []) media.set(m.id, m);
      for (const id of missing.slice(i, i + 50)) if (!media.has(id)) media.set(id, { id, format: "", relations: { edges: [] } });
    }
  }
  const chainOf = (id) => {
    const out = [], seen = new Set();
    for (let m = media.get(id); m && !seen.has(m.id); m = media.get(prequelOf(m))) { seen.add(m.id); out.push(m); }
    return out; // this one first, back to the first season
  };

  // Match on TMDB: every series entry and its prequels, every movie.
  const flat = (m) => ({ kind: m.format === "MOVIE" ? "movie" : "tv", year: String(m.seasonYear || m.startDate?.year || ""), english: m.title?.english || "", romaji: m.title?.romaji || "", native: m.title?.native || "", title: aniTitle(m.title), prequel: prequelOf(m) });
  const want = new Set();
  const listed = [...entries.values()].filter((e) => ANI_SERIES.has(e.media.format) || e.media.format === "MOVIE");
  for (const e of listed) for (const m of e.media.format === "MOVIE" ? [e.media] : chainOf(e.media.id)) if (m.title) want.add(m.id);
  const own = new Map(); // id → { kind, tmdbId } | null, by its own name
  const queue = [...want].filter((id) => {
    const l = aniLink(`a:${id}`);
    if (l && l.own !== false) { own.set(id, l.id ? { kind: l.kind, tmdbId: l.id } : null); return false; }
    return true;
  });
  let done = 0;
  const total = queue.length;
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      onStep(`Matching on TMDB… ${++done} of ${total}`);
      let hit = null;
      try { hit = await tmdbAnimeMatch(flat(media.get(id)), key); } catch (e) { if (/key/i.test(e.message || "")) throw e; }
      own.set(id, hit ? { kind: hit.kind, tmdbId: hit.tmdbId } : null);
    }
  };
  await Promise.all([0, 1, 2, 3].map(worker));

  // Each entry's show: its own match, else its nearest prequel's.
  const showOf = new Map();
  const show = (id) => {
    if (showOf.has(id)) return showOf.get(id);
    showOf.set(id, null); // a loop of prequels (AniList has a few) ends here
    const hit = own.get(id) || null;
    const m = media.get(id);
    const s = hit || (m && prequelOf(m) ? show(prequelOf(m)) : null);
    showOf.set(id, s);
    return s;
  };
  for (const id of want) {
    const s = show(id);
    setAniLink(`a:${id}`, s ? { kind: s.kind, id: s.tmdbId, own: !!own.get(id) } : { id: 0 });
    if (own.get(id) && !prequelOf(media.get(id) || {})) setAniLink(`t:${s.kind}:${s.tmdbId}`, { id });
  }

  // Episodes before an entry on the same show: its prequels' (all of them,
  // or as far as you got where AniList doesn't know how many).
  const offset = (id) => {
    const s = show(id);
    let n = 0;
    for (const m of chainOf(id).slice(1)) {
      const t = show(m.id);
      if (!s || !t || t.tmdbId !== s.tmdbId || t.kind !== s.kind) continue;
      n += m.episodes || entries.get(m.id)?.progress || 0;
    }
    return n;
  };

  onStep("Fetching episode lists…");
  const shows = new Map(); // "kind:id" → entries on it
  const recs = [];
  const films = []; // [details key, record]: named as TMDB names them
  let unmatched = 0, skipped = 0;
  for (const e of entries.values()) {
    const fmt = e.media.format;
    if (!ANI_SERIES.has(fmt) && fmt !== "MOVIE") { skipped++; continue; }
    const s = show(e.media.id);
    if (!s) {
      unmatched++;
      continue;
    }
    if (fmt === "MOVIE") {
      if (e.status === "DROPPED") { skipped++; continue; }
      const done = e.status === "COMPLETED" || e.status === "REPEATING";
      const at = done ? fuzzyIso(e.completedAt) || aniDate(e.updatedAt) : "";
      const rec = {
        title: aniTitle(e.media.title), kind: "movie", year: String(e.media.seasonYear || e.media.startDate?.year || ""), tmdbId: s.tmdbId, imdbId: "",
        rating: e.score > 0 ? clampRating(Math.max(0.5, e.score / 20)) : 0, status: ANI_STATUS[e.status] || "watchlist", weak: false, caughtUp: false,
        season: 0, episode: 0, note: "", added: aniDate(e.createdAt), last: at, watches: at ? [{ s: 0, e: 0, at }] : [],
      };
      recs.push(rec);
      films.push([`movie:${s.tmdbId}`, rec]);
      continue;
    }
    const k = `${s.kind}:${s.tmdbId}`;
    const done = e.status === "COMPLETED" || e.status === "REPEATING";
    const abs = offset(e.media.id) + (done ? Math.max(e.media.episodes || 0, e.progress || 0) : e.progress || 0);
    shows.set(k, [...(shows.get(k) || []), { e, abs, s }]);
  }

  // One title per show, from the entry furthest along.
  const keys = [...new Set([...shows.keys(), ...films.map(([k]) => k)])];
  const details = new Map();
  let fetched = 0;
  const dq = [...keys];
  await Promise.all([0, 1, 2, 3].map(async () => {
    while (dq.length) {
      const k = dq.shift();
      const [kind, id] = k.split(":");
      let d = cachedDetails(kind, Number(id));
      if (detailsStale(d)) { try { d = await tmdbRetry(() => loadDetails(kind, Number(id), key)); } catch {} }
      if (d) details.set(k, d);
      onStep(`Fetching episode lists… ${++fetched} of ${keys.length}`);
    }
  }));
  for (const [k, rec] of films) if (details.get(k)?.title) rec.title = details.get(k).title;
  for (const [k, list] of shows) {
    const lead = [...list].sort((a, b) => b.abs - a.abs || (a.e.status === "PLANNING") - (b.e.status === "PLANNING") || b.e.updatedAt - a.e.updatedAt)[0];
    const d = details.get(k);
    const at = absToSeasonEp(lead.abs, d);
    let status = ANI_STATUS[lead.e.status] || "watching";
    if (status === "watchlist" && lead.abs > 0) status = "watching";
    // Finished on AniList is Watched here only once there's nothing more
    // out: a show with a new season since is still on the go.
    if (status === "watched" && d?.seasons && !(isFinished(d) && lead.abs >= airedEpisodes(d))) status = "watching";
    const rated = [...list].filter((x) => x.e.score > 0).sort((a, b) => b.e.updatedAt - a.e.updatedAt)[0];
    const started = list.filter((x) => x.e.status !== "PLANNING");
    recs.push({
      title: d?.title || aniTitle(chainOf(lead.e.media.id).slice(-1)[0]?.title) || aniTitle(lead.e.media.title), kind: "tv",
      year: (d?.date || "").slice(0, 4), tmdbId: lead.s.tmdbId, imdbId: "",
      rating: rated ? clampRating(Math.max(0.5, rated.e.score / 20)) : 0, status, weak: false, caughtUp: false,
      season: at.episode ? at.season : 0, episode: at.episode, note: "",
      added: list.map((x) => aniDate(x.e.createdAt)).filter(Boolean).sort()[0] || "",
      last: started.map((x) => aniDate(x.e.updatedAt)).filter(Boolean).sort().pop() || "",
      watches: [],
    });
  }
  return { files: [{ role: "watched", recs }], total: entries.size, skipped, unmatched };
}

/* ============ In Settings ============ */
let aniConf = null;
const aniConfSubs = new Set();
function anilistConf() {
  if (!aniConf) {
    try { aniConf = JSON.parse(localStorage.getItem(ANILIST_CONF) || "{}") || {}; } catch { aniConf = {}; }
  }
  return aniConf;
}
function setAnilistConf(patch) {
  aniConf = { ...anilistConf(), ...patch };
  try { localStorage.setItem(ANILIST_CONF, JSON.stringify(aniConf)); } catch {}
  aniConfSubs.forEach((fn) => fn());
}
function useAnilistConf() {
  const [, setV] = useStateN(0);
  useEffectN(() => {
    const fn = () => setV((v) => v + 1);
    aniConfSubs.add(fn);
    return () => { aniConfSubs.delete(fn); };
  }, []);
  return anilistConf();
}
const cleanAniUser = (s) => String(s || "").trim().replace(/^@/, "").replace(/^https?:\/\/anilist\.co\/user\/([^/]+).*$/i, "$1").replace(/[^\w-]/g, "").slice(0, 40);

/* The username and the import, through the same merge as a CSV import:
   titles only move further along, nothing is removed, and Undo puts it
   back. `getItems` reads the library at the moment it's planned. */
function AnilistSettings({ getItems, tmdbKey, onImport }) {
  const conf = useAnilistConf();
  const [step, setStep] = useStateN("");
  const liveRef = useRefN(true);
  useEffectN(() => () => { liveRef.current = false; }, []);
  const note = { fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5, marginBottom: 10 };
  const user = cleanAniUser(conf.user);
  const say = (t) => { if (liveRef.current) setStep(t); };

  const importNow = async () => {
    if (!user || step) return;
    say("Reading your list…");
    try {
      const got = await fetchAnilistLibrary(user, tmdbKey, say);
      const n = got.files.reduce((a, f) => a + f.recs.length, 0);
      if (!n) { showToast(got.total ? `None of ${plural(got.total, "title")} matched on TMDB` : "That AniList list is empty"); return; }
      const plan = planImport(got.files, getItems());
      const left = [got.unmatched && `${got.unmatched} not on TMDB`, got.skipped && `${got.skipped} specials, OVAs or dropped movies`].filter(Boolean).join(", ");
      if (!plan.added && !plan.updated) { showToast(`Already up to date with AniList${left ? ` (${left} left out)` : ""}`); return; }
      const where = [["watching", "Watching"], ["watched", "Watched"], ["watchlist", "Watchlist"]]
        .filter(([k]) => plan.into[k]).map(([k, l]) => `${plan.into[k]} to ${l}`).join(", ");
      const ok = await askConfirm({
        title: `Bring in ${plural(plan.added + plan.updated, "anime")} from AniList?`,
        body: `${plan.added} new, ${plan.updated} updated${where ? ` (${where})` : ""}. Each show's seasons are added up onto its TMDB episodes, and nothing goes back a step.${left ? ` Left out: ${left}.` : ""} You can undo straight after.`,
        confirmLabel: "Import",
      });
      if (!ok) return;
      // Planned again on the library as it is now (a sync may have landed).
      onImport(planImport(got.files, getItems()));
      setAnilistConf({ imported: Date.now() });
    } catch (e) {
      showToast(e.message || "Couldn't import from AniList");
    } finally {
      say("");
    }
  };

  return (
    <div>
      <div style={note}>
        Anime facts on each title sheet and the Anime shelves in Explore need nothing set up. To bring in your list, enter your AniList username: your shows land at the furthest episode you've reached across their seasons.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input aria-label="AniList username" value={conf.user || ""} onChange={(e) => setAnilistConf({ user: e.target.value })} placeholder="AniList username"
          autoComplete="off" autoCapitalize="off" spellCheck={false} style={{ ...fieldStyle(), flex: 1, minWidth: 0 }} />
        <button type="button" onClick={importNow} disabled={!user || !tmdbKey || !!step} style={{ ...accentBtn(), opacity: user && tmdbKey ? 1 : 0.4, flexShrink: 0 }}>{step ? "Importing…" : "Import"}</button>
      </div>
      {step && <div className="tvt-pop" role="status" style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 8 }}>{step}</div>}
      <div style={{ fontSize: 12.5, color: "var(--ink-faint)", lineHeight: 1.5, marginTop: 8 }}>
        {!tmdbKey ? "Importing needs the TMDB key (above), to find each anime's show and seasons. " : ""}
        Your list must be public. Specials and OVAs are left out.
        {conf.imported > 0 && !step && ` Last imported ${fmtAgo(conf.imported)}.`}
      </div>
    </div>
  );
}

Object.assign(window, {
  anilistQuery, anilistTmdb, resolveAnilistToTmdb, useAnilist, useAnimeTmdb, anilistSeason, anilistTile, useAnimeExplore, refreshAnilist,
  useAnilistSearch, fmtCountdown, AnilistSection, absToSeasonEp, fetchAnilistLibrary, AnilistSettings, useAnilistConf, baseTitle,
});
