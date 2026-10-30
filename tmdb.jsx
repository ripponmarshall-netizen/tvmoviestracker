/* tmdb.jsx — search, posters, title details and the Explore lists from The
   Movie Database (TMDB). Uses your own free TMDB key, entered in Settings
   (and kept in your profile when you're signed in). Requests go straight
   from the browser to TMDB; images load from TMDB's image server. */
const { useState: useStateT, useEffect: useEffectT } = React;

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/";
// en-US has the most complete English titles and posters on TMDB.
const TMDB_LANGUAGE = "en-US";
const DAY_MS = 864e5;

/* A poster path ("/abc.jpg") as a URL at one of TMDB's widths: w92, w154,
   w185, w342, w500, w780 or original. */
function posterUrl(path, size = "w185") {
  return path ? TMDB_IMG + size + path : "";
}
/* A backdrop (16:9 still) at w300, w780, w1280 or original. */
function backdropUrl(path, size = "w780") {
  return path ? TMDB_IMG + size + path : "";
}

/* "2022-02-18" as "18 Feb 2022". TMDB dates are plain days, so they're
   read and shown in UTC: in Jamaica (UTC−5) local time would make it the
   17th. */
const DATE_LONG = { day: "numeric", month: "short", year: "numeric" };
const DATE_SHORT = { day: "numeric", month: "short" };
function fmtDate(iso, opts = DATE_LONG) {
  const t = Date.parse(iso || "");
  return t ? new Date(t).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" }) : "";
}
/* Minutes as "2h 12m", "45m" or "3h". */
function fmtRuntime(min) {
  if (!min) return "";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
/* 12345 as "12K". */
function fmtCount(n) {
  return new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
}

/* Either kind of TMDB key works: a v4 "API Read Access Token" (a long
   token starting eyJ) goes in a header; a v3 "API Key" (32 characters)
   goes in the address, which also spares the browser a CORS preflight. */
async function tmdbGet(path, params, key, signal) {
  const url = new URL(TMDB_API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { accept: "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);
  let res;
  try {
    res = await fetch(url, { headers, signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error("Couldn't reach TMDB. Check your connection.");
  }
  if (res.status === 401) throw new Error("TMDB didn't accept the key. Check it in Settings.");
  if (!res.ok) throw new Error(`TMDB error ${res.status}`);
  return res.json();
}

/* A show or movie from any TMDB list (search, trending, popular, "more
   like this") as a tile: enough to draw a card and open its sheet.
   `kind` is for lists that don't say (/movie/popular has no media_type). */
function tmdbTile(r, kind) {
  kind = r?.media_type || kind;
  if (kind !== "tv" && kind !== "movie") return null;
  const title = (kind === "tv" ? r.name : r.title) || "";
  if (!title || !r.id) return null;
  const date = (kind === "tv" ? r.first_air_date : r.release_date) || "";
  return {
    tmdbId: r.id, kind, title, date,
    year: date.slice(0, 4),
    poster: r.poster_path || "",
    backdrop: r.backdrop_path || "",
    vote: r.vote_average || 0,
    votes: r.vote_count || 0,
    overview: (r.overview || "").slice(0, 400),
  };
}

/* Shows and movies matching `query`, in TMDB's order of relevance. */
async function searchTitles(query, key, signal, limit = 8) {
  const data = await tmdbGet("/search/multi", { query, include_adult: "false", language: TMDB_LANGUAGE, page: "1" }, key, signal);
  return (data.results || []).map((r) => tmdbTile(r)).filter(Boolean).slice(0, limit);
}

/* Check a key with the cheapest call TMDB has. Resolves, or throws with
   a message to show. */
function testTmdbKey(key) {
  return tmdbGet("/configuration", {}, key);
}

/* ============ Details ============
   A title's facts (dates, runtime, ratings, seasons), kept on the device so
   stats, Up Next and the title sheet work offline and open instantly.
   Shows go stale after a day (new episodes air), movies after a month;
   stale details still show while fresh ones load. "More like this" comes
   in the same request but is kept for this visit only. */
const DETAILS_STORE = "tvt:tmdb:v1";
const DETAILS_MAX = 400; // past this, the longest-unrefreshed are dropped
const detailsKey = (kind, id) => `${kind}:${id}`;
let detailsMem = null;
const recsMem = new Map();
const detailsInflight = new Map();
const detailsFailed = new Set(); // not retried until back online or reload
const detailsSubs = new Set();
window.addEventListener("online", () => detailsFailed.clear());

function detailsAll() {
  if (!detailsMem) {
    try { detailsMem = JSON.parse(localStorage.getItem(DETAILS_STORE) || "{}") || {}; } catch { detailsMem = {}; }
  }
  return detailsMem;
}
let detailsSaveTimer = 0;
function saveDetailsSoon() {
  clearTimeout(detailsSaveTimer);
  detailsSaveTimer = setTimeout(() => {
    const all = detailsAll();
    const keys = Object.keys(all);
    if (keys.length > DETAILS_MAX) {
      keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - DETAILS_MAX).forEach((k) => delete all[k]);
    }
    // It's only a cache: if storage is full, drop it rather than leave
    // the list itself (tvt:v1) without room to save.
    try { localStorage.setItem(DETAILS_STORE, JSON.stringify(all)); } catch { try { localStorage.removeItem(DETAILS_STORE); } catch {} }
  }, 500);
}
// Batched, so a burst of fetches re-renders once rather than per title.
let detailsNotifyTimer = 0;
function notifyDetails() {
  if (detailsNotifyTimer) return;
  detailsNotifyTimer = setTimeout(() => {
    detailsNotifyTimer = 0;
    detailsSubs.forEach((fn) => fn());
  }, 60);
}

function cachedDetails(kind, id) {
  return id ? detailsAll()[detailsKey(kind, id)] || null : null;
}
function detailsStale(d) {
  return !d || Date.now() - d.at > (d.kind === "tv" ? DAY_MS : 30 * DAY_MS);
}

/* The parts of TMDB's /tv/{id} or /movie/{id} the app uses. For a show,
   `seasons` maps season number to episode count (specials left out),
   `last` is the latest aired episode as [season, episode], and `next` the
   next one announced. `rt` is minutes: a movie's runtime, or a show's
   typical episode (0 when TMDB doesn't know). */
function compactDetails(kind, r) {
  const tv = kind === "tv";
  const seasons = {};
  if (tv) for (const s of r.seasons || []) if (s.season_number > 0 && s.episode_count > 0) seasons[s.season_number] = s.episode_count;
  const runs = tv ? (r.episode_run_time || []).filter((n) => n > 0) : [];
  const rt = tv
    ? (runs.length ? Math.round(runs.reduce((a, b) => a + b, 0) / runs.length) : r.last_episode_to_air?.runtime || r.next_episode_to_air?.runtime || 0)
    : r.runtime || 0;
  const ep = (x) => (x && x.season_number > 0 && x.episode_number > 0 ? x : null);
  const last = tv ? ep(r.last_episode_to_air) : null;
  const next = tv ? ep(r.next_episode_to_air) : null;
  return {
    at: Date.now(), kind, id: r.id,
    title: (tv ? r.name : r.title) || "",
    poster: r.poster_path || "",
    backdrop: r.backdrop_path || "",
    date: (tv ? r.first_air_date : r.release_date) || "",
    vote: Math.round((r.vote_average || 0) * 10) / 10,
    votes: r.vote_count || 0,
    genres: (r.genres || []).map((g) => g.name).filter(Boolean).slice(0, 4),
    rt,
    overview: (r.overview || "").slice(0, 400),
    tagline: (r.tagline || "").slice(0, 160),
    status: r.status || "",
    network: tv ? r.networks?.[0]?.name || "" : "",
    seasons: tv ? seasons : null,
    last: last ? [last.season_number, last.episode_number] : null,
    next: next ? { s: next.season_number, e: next.episode_number, date: next.air_date || "" } : null,
  };
}

/* Fetch (or join the fetch already under way for) a title's details. */
function loadDetails(kind, id, key) {
  const k = detailsKey(kind, id);
  if (detailsInflight.has(k)) return detailsInflight.get(k);
  const p = tmdbGet(`/${kind}/${id}`, { language: TMDB_LANGUAGE, append_to_response: "recommendations" }, key)
    .then((r) => {
      const d = compactDetails(kind, r);
      detailsAll()[k] = d;
      recsMem.set(k, (r.recommendations?.results || []).map((x) => tmdbTile(x, kind)).filter(Boolean));
      saveDetailsSoon();
      return d;
    })
    .catch((e) => { detailsFailed.add(k); throw e; })
    .finally(() => { detailsInflight.delete(k); notifyDetails(); });
  detailsInflight.set(k, p);
  return p;
}

/* Re-render whenever any details arrive. */
function useDetailsVersion() {
  const [, setV] = useStateT(0);
  useEffectT(() => {
    const fn = () => setV((v) => v + 1);
    detailsSubs.add(fn);
    return () => { detailsSubs.delete(fn); };
  }, []);
}

/* useTitleDetails — one title's details (cached at once, refreshed when
   stale) and, once fetched this visit, titles like it. */
function useTitleDetails(kind, id, key) {
  useDetailsVersion();
  const [error, setError] = useStateT("");
  useEffectT(() => {
    setError("");
    if (!id || !key) return;
    const k = detailsKey(kind, id);
    if (recsMem.has(k) && !detailsStale(cachedDetails(kind, id))) return;
    loadDetails(kind, id, key).catch((e) => setError(e.message || "Couldn't load details"));
  }, [kind, id, key]);
  const k = id ? detailsKey(kind, id) : "";
  return { d: cachedDetails(kind, id), recs: recsMem.get(k) || null, error, loading: detailsInflight.has(k) };
}

/* usePrefetchDetails — fetch details for the titles in `list` that have
   none (or, with refreshStale, whose details are old), four at a time.
   Returns how many are still to come. */
function usePrefetchDetails(list, key, refreshStale = false) {
  useDetailsVersion();
  const want = key
    ? list.filter((i) => {
        if (!i.tmdbId || detailsFailed.has(detailsKey(i.kind, i.tmdbId))) return false;
        const d = cachedDetails(i.kind, i.tmdbId);
        return refreshStale ? detailsStale(d) : !d;
      })
    : [];
  const sig = want.map((i) => detailsKey(i.kind, i.tmdbId)).join(",");
  useEffectT(() => {
    if (!want.length) return;
    let live = true;
    const queue = [...want];
    const worker = async () => {
      while (live && queue.length) {
        const i = queue.shift();
        try { await loadDetails(i.kind, i.tmdbId, key); } catch (e) {
          // A bad key fails every request: stop rather than try them all.
          if (/key/i.test(e.message || "")) queue.length = 0;
        }
      }
    };
    for (let n = 0; n < 4; n++) worker();
    return () => { live = false; };
  }, [sig, key]);
  return want.length;
}

/* ============ Episode maths ============
   On a show's details (`d`, which may be null for a title typed in by
   hand). An item's progress is the last episode watched: season S,
   episode E (E = 0: not started). */
const EST_EPISODES_PER_SEASON = 10; // for shows without TMDB details

function episodesWatched(item, d) {
  if (item.kind !== "tv") return 0;
  let before = 0;
  for (let s = 1; s < item.season; s++) before += d?.seasons ? d.seasons[s] || 0 : EST_EPISODES_PER_SEASON;
  return before + item.episode;
}
/* Episodes out so far: everything up to the latest aired one. */
function airedEpisodes(d) {
  if (!d?.seasons) return 0;
  let n = 0;
  for (const [s, count] of Object.entries(d.seasons)) {
    if (!d.last || Number(s) < d.last[0]) n += count;
    else if (Number(s) === d.last[0]) n += Math.min(count, d.last[1]);
  }
  return n;
}
const isFinished = (d) => d?.status === "Ended" || d?.status === "Canceled";

/* The episode after the last one watched: on to the next season when this
   one is done. null when there's nothing after it (caught up). `aired` is
   false for one that's announced but not out (with its date, if known).
   Without details it's simply the next number. */
function nextEpisode(item, d) {
  if (!d?.seasons) return { season: item.season, episode: item.episode + 1, aired: true, date: "" };
  let season = item.season, episode = item.episode + 1;
  if (episode > (d.seasons[season] || 0)) {
    const later = Object.keys(d.seasons).map(Number).filter((s) => s > item.season).sort((a, b) => a - b)[0];
    if (!later) return null;
    season = later;
    episode = 1;
  }
  const aired = !d.last || season < d.last[0] || (season === d.last[0] && episode <= d.last[1]);
  const date = !aired && d.next && d.next.s === season && d.next.e === episode ? d.next.date : "";
  return { season, episode, aired, date };
}

/* ============ Lists (Explore) ============
   A TMDB list (trending, popular, …) as tiles. Kept in memory for half an
   hour, so moving between tabs doesn't refetch. */
const listMem = new Map();
function useTmdbList(path, kind, key) {
  const cached = listMem.get(path);
  const fresh = cached && Date.now() - cached.at < 30 * 60e3;
  const [state, setState] = useStateT(() => (cached ? { results: cached.results, error: "" } : { results: null, error: "" }));
  useEffectT(() => {
    if (!key || fresh) return;
    const ctl = new AbortController();
    tmdbGet(path, { language: TMDB_LANGUAGE, page: "1" }, key, ctl.signal)
      .then((data) => {
        const results = (data.results || []).map((r) => tmdbTile(r, kind)).filter(Boolean);
        listMem.set(path, { at: Date.now(), results });
        setState({ results, error: "" });
      })
      .catch((e) => { if (e.name !== "AbortError") setState((s) => ({ ...s, error: e.message || "Couldn't load" })); });
    return () => ctl.abort();
  }, [path, key]);
  return state;
}

/* useTmdbSearch — results for `query` while `enabled`, a beat after the
   typing stops; a newer query cancels the one in flight. */
function useTmdbSearch(query, key, enabled, limit = 8) {
  const [state, setState] = useStateT({ results: [], loading: false, error: "" });
  const q = query.trim();
  useEffectT(() => {
    if (!enabled || !key || q.length < 2) {
      setState({ results: [], loading: false, error: "" });
      return;
    }
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: "" }));
    const t = setTimeout(() => {
      searchTitles(q, key, ctl.signal, limit)
        .then((results) => setState({ results, loading: false, error: "" }))
        .catch((e) => {
          if (e.name !== "AbortError") setState({ results: [], loading: false, error: e.message || "Search failed" });
        });
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, key, enabled, limit]);
  return state;
}

/* Matches under the title field. Each one rises in as it arrives; tap
   one to fill in the title, type, year and poster. */
function SearchResults({ state, onPick }) {
  const note = (text) => <div style={{ fontSize: 12.5, color: "var(--ink-faint)", padding: "8px 2px 0" }}>{text}</div>;
  if (state.error) return note(state.error);
  if (!state.results.length) return note(state.loading ? "Searching TMDB…" : "No matches on TMDB. Keep typing, or add it as it is.");
  return (
    <div aria-label="Matches from TMDB" style={{ marginTop: 8 }}>
      {state.results.map((r, i) => (
        <AnimatedRow key={r.kind + r.tmdbId} index={i} gap={6}>
          <button type="button" className="tvt-wide-btn" onClick={() => onPick(r)} style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%", padding: 6, margin: 0,
            background: "var(--bg-2)", border: "none", borderRadius: 12,
            textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer",
          }}>
            <PosterThumb path={r.poster} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</span>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-dim)", marginTop: 2 }}>
                {r.kind === "tv" ? "Show" : "Movie"}{r.year && ` · ${r.year}`}
              </span>
            </span>
          </button>
        </AnimatedRow>
      ))}
    </div>
  );
}

/* A small poster for search results: fades in once loaded, a plain tile
   when TMDB has none. */
function PosterThumb({ path }) {
  return (
    <span aria-hidden style={{ width: 34, height: 51, borderRadius: 6, flexShrink: 0, overflow: "hidden", background: "var(--bg-3)", display: "inline-flex" }}>
      {path && (
        <img src={posterUrl(path, "w154")} alt="" loading="lazy" onLoad={(e) => { e.currentTarget.style.opacity = 1; }}
          style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0, transition: "opacity 0.3s ease" }} />
      )}
    </span>
  );
}

Object.assign(window, {
  posterUrl, backdropUrl, fmtDate, fmtRuntime, fmtCount, tmdbTile, searchTitles, testTmdbKey,
  cachedDetails, useTitleDetails, usePrefetchDetails, useTmdbList, useTmdbSearch,
  episodesWatched, airedEpisodes, isFinished, nextEpisode, SearchResults, PosterThumb,
});
