/* tmdb.jsx — title search and posters from The Movie Database (TMDB).
   Uses your own free TMDB key, entered in Settings (and kept in your
   profile when you're signed in). Searches go straight from the browser
   to TMDB; posters load from TMDB's image server. */
const { useState: useStateT, useEffect: useEffectT } = React;

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/";
// en-US has the most complete English titles and posters on TMDB.
const TMDB_LANGUAGE = "en-US";

/* A poster path ("/abc.jpg") as a URL at one of TMDB's widths: w92, w154,
   w185, w342, w500, w780 or original. */
function posterUrl(path, size = "w185") {
  return path ? TMDB_IMG + size + path : "";
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

/* Shows and movies matching `query`, in TMDB's order of relevance. */
async function searchTitles(query, key, signal) {
  const data = await tmdbGet("/search/multi", { query, include_adult: "false", language: TMDB_LANGUAGE, page: "1" }, key, signal);
  return (data.results || [])
    .filter((r) => r.media_type === "tv" || r.media_type === "movie")
    .map((r) => ({
      tmdbId: r.id,
      kind: r.media_type,
      title: (r.media_type === "tv" ? r.name : r.title) || "",
      year: String((r.media_type === "tv" ? r.first_air_date : r.release_date) || "").slice(0, 4),
      poster: r.poster_path || "",
    }))
    .filter((r) => r.title)
    .slice(0, 8);
}

/* Check a key with the cheapest call TMDB has. Resolves, or throws with
   a message to show. */
function testTmdbKey(key) {
  return tmdbGet("/configuration", {}, key);
}

/* useTmdbSearch — results for `query` while `enabled`, a beat after the
   typing stops; a newer query cancels the one in flight. */
function useTmdbSearch(query, key, enabled) {
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
      searchTitles(q, key, ctl.signal)
        .then((results) => setState({ results, loading: false, error: "" }))
        .catch((e) => {
          if (e.name !== "AbortError") setState({ results: [], loading: false, error: e.message || "Search failed" });
        });
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, key, enabled]);
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

Object.assign(window, { posterUrl, searchTitles, testTmdbKey, useTmdbSearch, SearchResults, PosterThumb });
