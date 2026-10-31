/* trakt.jsx — Trakt, two ways. On the title sheet, what its community
   makes of a title: rating, votes, and how many people have watched it
   and how often. In Settings, your own Trakt history brought into the
   library: each show at the last episode you watched (and when, so Up
   Next knows what's current), the movies you've watched, your watchlist
   and your ratings.
   Both need your own (free) Trakt API app: its Client ID for the sheet,
   and its Client Secret too for connecting your account, which uses
   Trakt's device sign-in (a code you type in at trakt.tv/activate). The
   app must list this site as a JavaScript (CORS) origin, or the browser
   is refused. The ID, secret and sign-in stay on this device. */
const { useState: useStateK, useEffect: useEffectK, useRef: useRefK } = React;

const TRAKT_API = "https://api.trakt.tv";
const TRAKT_STORE = "tvt:trakt:v1"; // { id, secret, token: { access, refresh, expires }, imported }
const TRAKT_STATS_STORE = "tvt:traktstats:v1";
const TRAKT_STATS_MAX = 300;
const TRAKT_FRESH_MS = 3 * DAY_MS;
// For apps without a web page to return to, as device sign-in is.
const TRAKT_REDIRECT = "urn:ietf:wg:oauth:2.0:oob";

/* ============ Settings and sign-in ============ */
let traktConf = null;
const traktSubs = new Set();
function traktSettings() {
  if (!traktConf) {
    try { traktConf = JSON.parse(localStorage.getItem(TRAKT_STORE) || "{}") || {}; } catch { traktConf = {}; }
  }
  return traktConf;
}
function setTraktSettings(patch) {
  traktConf = { ...traktSettings(), ...patch };
  try { localStorage.setItem(TRAKT_STORE, JSON.stringify(traktConf)); } catch {}
  traktSubs.forEach((fn) => fn());
}
/* useTraktSettings — the settings, re-rendering when they change. */
function useTraktSettings() {
  const [, setV] = useStateK(0);
  useEffectK(() => {
    const fn = () => setV((v) => v + 1);
    traktSubs.add(fn);
    return () => { traktSubs.delete(fn); };
  }, []);
  return traktSettings();
}

function traktHeaders(id, access) {
  const h = { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": id };
  if (access) h.Authorization = `Bearer ${access}`;
  return h;
}
const TRAKT_UNREACHABLE = "Couldn't reach Trakt. Check your connection, and that your Trakt app lists this site as a JavaScript (CORS) origin.";

async function traktPost(path, body) {
  try {
    return await fetch(TRAKT_API + path, { method: "POST", headers: traktHeaders(traktSettings().id), body: JSON.stringify(body) });
  } catch {
    throw new Error(TRAKT_UNREACHABLE);
  }
}

const tokenFrom = (r) => ({
  access: r.access_token, refresh: r.refresh_token,
  // created_at is in seconds. Trakt's tokens now last a day.
  expires: ((r.created_at || Date.now() / 1000) + (r.expires_in || 86400)) * 1000,
});

/* The access token, refreshed first if it's (nearly) run out. Several
   requests at once share one refresh. */
let traktRefreshing = null;
async function traktAccessToken() {
  const { token, id, secret } = traktSettings();
  if (!token?.access) throw new Error("Connect your Trakt account in Settings first.");
  if (token.expires - 5 * 60e3 > Date.now()) return token.access;
  if (!traktRefreshing) {
    traktRefreshing = (async () => {
      const res = await traktPost("/oauth/token", { refresh_token: token.refresh, client_id: id, client_secret: secret, redirect_uri: TRAKT_REDIRECT, grant_type: "refresh_token" });
      if (!res.ok) {
        setTraktSettings({ token: null });
        throw new Error("Your Trakt sign-in has run out. Connect again in Settings.");
      }
      const t = tokenFrom(await res.json());
      setTraktSettings({ token: t });
      return t.access;
    })().finally(() => { traktRefreshing = null; });
  }
  return traktRefreshing;
}

/* GET from Trakt. Resolves with null for a 404; rejects with a message to
   show for anything else that goes wrong. */
async function traktGet(path, { auth = false } = {}) {
  const { id } = traktSettings();
  if (!id) throw new Error("Add a Trakt Client ID in Settings first.");
  let res;
  try {
    res = await fetch(TRAKT_API + path, { headers: traktHeaders(id, auth ? await traktAccessToken() : "") });
  } catch (e) {
    throw /Trakt/.test(e?.message || "") ? e : new Error(TRAKT_UNREACHABLE);
  }
  if (res.status === 404) return null;
  if (res.status === 401) {
    if (auth) setTraktSettings({ token: null });
    throw new Error(auth ? "Trakt signed you out. Connect again in Settings." : "Trakt didn't accept the Client ID. Check it in Settings.");
  }
  if (res.status === 403) throw new Error("Trakt didn't accept the Client ID. Check it in Settings.");
  if (res.status === 429) throw new Error("Trakt is busy. Try again in a minute.");
  if (!res.ok) throw new Error(`Trakt error ${res.status}`);
  return res.json();
}

/* Device sign-in, step one: a code for you to type in at Trakt.
   Resolves with { device_code, user_code, verification_url, expires_in,
   interval }. */
async function traktDeviceCode() {
  const { id, secret } = traktSettings();
  if (!id || !secret) throw new Error("Connecting needs both the Client ID and the Client Secret.");
  const res = await traktPost("/oauth/device/code", { client_id: id });
  if (!res.ok) throw new Error(res.status === 403 || res.status === 401 ? "Trakt didn't accept the Client ID." : `Trakt error ${res.status}`);
  return res.json();
}
/* Step two: ask, every `interval` seconds, whether the code has been
   entered, until it has (the sign-in is saved), it's refused or it runs
   out. `live()` false stops it quietly. */
async function traktWaitForSignIn(dc, live) {
  const { id, secret } = traktSettings();
  let wait = (dc.interval || 5) * 1000;
  const until = Date.now() + (dc.expires_in || 600) * 1000;
  while (live() && Date.now() < until) {
    await new Promise((r) => setTimeout(r, wait));
    if (!live()) return false;
    const res = await traktPost("/oauth/device/token", { code: dc.device_code, client_id: id, client_secret: secret });
    if (res.status === 200) {
      setTraktSettings({ token: tokenFrom(await res.json()) });
      return true;
    }
    if (res.status === 400) continue; // not entered yet
    if (res.status === 429) { wait += 1000; continue; }
    if (res.status === 418) throw new Error("You turned down the sign-in on Trakt.");
    if (res.status === 410) break;
    if (res.status === 401 || res.status === 403) throw new Error("Trakt didn't accept the Client Secret. Check it and try again.");
    throw new Error(`Trakt error ${res.status}`);
  }
  if (!live()) return false;
  throw new Error("The code ran out. Try again.");
}

/* ============ Community stats, for the title sheet ============ */
let traktStatsMem = null;
const traktStatsInflight = new Map();
function traktStatsAll() {
  if (!traktStatsMem) {
    try { traktStatsMem = JSON.parse(localStorage.getItem(TRAKT_STATS_STORE) || "{}") || {}; } catch { traktStatsMem = {}; }
  }
  return traktStatsMem;
}
let traktStatsSaveTimer = 0;
function saveTraktStatsSoon() {
  clearTimeout(traktStatsSaveTimer);
  traktStatsSaveTimer = setTimeout(() => {
    const all = traktStatsAll();
    const out = {};
    for (const k of Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, TRAKT_STATS_MAX)) out[k] = all[k];
    try { localStorage.setItem(TRAKT_STATS_STORE, JSON.stringify(out)); } catch { try { localStorage.removeItem(TRAKT_STATS_STORE); } catch {} }
  }, 500);
}

/* A title on Trakt, found by its TMDB id: its slug (for the link), its
   rating (out of 10) and votes, and how many people have watched it, how
   many plays, and how many lists it's on. slug "" when Trakt hasn't it. */
async function fetchTraktStats(kind, tmdbId) {
  const type = kind === "tv" ? "show" : "movie";
  const hits = await traktGet(`/search/tmdb/${Number(tmdbId)}?type=${type}&extended=full`);
  const t = (hits || []).find((h) => h.type === type)?.[type];
  if (!t?.ids?.slug) return { at: Date.now(), slug: "" };
  const s = await traktGet(`/${type}s/${encodeURIComponent(t.ids.slug)}/stats`).catch(() => null);
  return {
    at: Date.now(), type, slug: String(t.ids.slug),
    rating: Number(t.rating) || 0, votes: Number(t.votes) || 0,
    watchers: Number(s?.watchers) || 0, plays: Number(s?.plays) || 0, lists: Number(s?.lists) || 0,
  };
}

/* useTraktStats — Trakt's numbers for a title, null until they're in (or
   without a Client ID). */
function useTraktStats(kind, tmdbId) {
  const { id } = useTraktSettings();
  const [, setV] = useStateK(0);
  const k = id && tmdbId ? `${kind}:${tmdbId}` : "";
  useEffectK(() => {
    if (!k) return;
    const all = traktStatsAll();
    if (all[k] && Date.now() - all[k].at < TRAKT_FRESH_MS) return;
    let live = true;
    if (!traktStatsInflight.has(k)) {
      traktStatsInflight.set(k, fetchTraktStats(kind, tmdbId)
        .then((x) => { all[k] = x; saveTraktStatsSoon(); })
        .finally(() => traktStatsInflight.delete(k)));
    }
    traktStatsInflight.get(k).catch(() => {}).finally(() => { if (live) setV((v) => v + 1); });
    return () => { live = false; };
  }, [k]);
  return k ? traktStatsAll()[k] || null : null;
}

/* The On Trakt section: the community's rating and how many have watched
   it, in the same strip as the facts at the top. */
function TraktSection({ s }) {
  if (!s?.slug || !(s.votes || s.watchers)) return null;
  const cells = [
    s.votes > 0 && { label: "Rating", value: `${Math.round(s.rating * 10)}%`, sub: `${fmtCount(s.votes)} votes` },
    s.watchers > 0 && { label: "Watchers", value: fmtCount(s.watchers), sub: "have watched" },
    s.plays > 0 && { label: "Plays", value: fmtCount(s.plays), sub: s.lists ? `on ${fmtCount(s.lists)} lists` : "in all" },
  ].filter(Boolean);
  return (
    <DetailSection title="On Trakt">
      <div style={{ background: "var(--bg-2)", borderRadius: 16, overflow: "hidden" }}>
        <InfoStrip cells={cells} flat />
      </div>
      <a href={`https://trakt.tv/${s.type}s/${encodeURIComponent(s.slug)}`} target="_blank" rel="noopener noreferrer"
        style={{ display: "inline-block", marginTop: 10, color: "var(--accent)", textDecoration: "none", fontSize: 13.5, fontWeight: 600 }}>Open on Trakt</a>
    </DetailSection>
  );
}

/* ============ Your history, into the library ============ */
/* The last episode watched in a show's seasons from /sync/watched/shows
   (specials left out). Episodes watched before a progress reset (a
   rewatch started on Trakt) don't count. null when there's none. */
function traktLastEpisode(seasons, resetAt) {
  let best = null;
  for (const s of seasons || []) {
    if (!(s.number > 0)) continue;
    for (const e of s.episodes || []) {
      if (!(e.number > 0) || (resetAt && (e.last_watched_at || "") < resetAt)) continue;
      if (!best || s.number > best.season || (s.number === best.season && e.number > best.episode)) best = { season: s.number, episode: e.number };
    }
  }
  return best;
}

/* A Trakt show or movie as an import record (the shape csvRecords makes,
   so planImport can merge it). */
function traktRec(t, kind, extra) {
  const title = String(t?.title || "").trim().slice(0, 200);
  if (!title) return null;
  return {
    title, kind, year: t.year ? String(t.year) : "",
    tmdbId: Number.isInteger(t.ids?.tmdb) && t.ids.tmdb > 0 ? t.ids.tmdb : null,
    imdbId: /^tt\d+$/.test(t.ids?.imdb || "") ? t.ids.imdb : "",
    rating: 0, status: null, caughtUp: false, season: 0, episode: 0, note: "", added: "", last: "",
    ...extra,
  };
}
const traktDate = (iso) => (Date.parse(iso || "") ? new Date(iso).toISOString() : "");

/* fetchTraktLibrary — your history as import "files" for planImport:
   what you've watched (shows with progress go to Watching, the rest to
   Watched), your watchlist and your ratings (out of 10 on Trakt, so
   halved into stars). */
async function fetchTraktLibrary() {
  const get = (path) => traktGet(path, { auth: true }).then((r) => (Array.isArray(r) ? r : []));
  const [shows, movies, list, ratings] = await Promise.all([
    get("/sync/watched/shows"), get("/sync/watched/movies"), get("/sync/watchlist"), get("/sync/ratings"),
  ]);
  const watched = [
    ...shows.map((x) => {
      const ep = traktLastEpisode(x.seasons, x.reset_at);
      const at = traktDate(x.last_watched_at);
      return traktRec(x.show, "tv", { season: ep?.season || 0, episode: ep?.episode || 0, added: at, last: at });
    }),
    ...movies.map((x) => traktRec(x.movie, "movie", { added: traktDate(x.last_watched_at), last: traktDate(x.last_watched_at) })),
  ];
  const kindOf = (x) => (x.type === "show" ? "tv" : x.type === "movie" ? "movie" : null);
  const listed = list.filter(kindOf).map((x) => traktRec(x[x.type], kindOf(x), { added: traktDate(x.listed_at) }));
  const rated = ratings.filter(kindOf).map((x) => traktRec(x[x.type], kindOf(x), {
    rating: x.rating > 0 ? clampRating(Math.max(0.5, x.rating / 2)) : 0, added: traktDate(x.rated_at),
  }));
  return [
    { role: "watched", recs: watched.filter(Boolean) },
    { role: "list", recs: listed.filter(Boolean) },
    { role: "ratings", recs: rated.filter(Boolean) },
  ];
}

/* ============ In Settings ============
   The Client ID and secret, connecting your account (device sign-in) and
   the import, which goes through the same merge as a CSV import: titles
   only move further along, nothing is removed, and Undo puts it back. */
function TraktSettings({ items, onImport }) {
  const conf = useTraktSettings();
  const [code, setCode] = useStateK(null); // the device code while you're entering it
  const [busy, setBusy] = useStateK("");
  const liveRef = useRefK(true);
  useEffectK(() => () => { liveRef.current = false; }, []);
  const note = { fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5, marginBottom: 10 };
  const small = { ...note, fontSize: 12.5, color: "var(--ink-faint)" };
  const connected = !!conf.token?.access;

  // Cancel (or closing Settings) stops the wait for this code.
  const codeRef = useRefK(null);
  codeRef.current = code;

  const connect = async () => {
    setBusy("connect");
    try {
      const dc = await traktDeviceCode();
      setCode(dc);
      const ok = await traktWaitForSignIn(dc, () => liveRef.current && codeRef.current === dc);
      if (ok) showToast("Trakt connected");
    } catch (e) {
      if (liveRef.current) showToast(e.message || "Couldn't connect to Trakt");
    } finally {
      if (liveRef.current) { setCode(null); setBusy(""); }
    }
  };
  const importNow = async () => {
    setBusy("import");
    try {
      const files = await fetchTraktLibrary();
      const n = files.reduce((a, f) => a + f.recs.length, 0);
      if (!n) { showToast("Nothing on Trakt to bring in yet"); return; }
      const plan = planImport(files, items);
      if (!plan.added && !plan.updated) { showToast(`Already up to date with Trakt (${plural(n, "title")})`); return; }
      const where = [["watching", "Watching"], ["watched", "Watched"], ["watchlist", "Watchlist"]]
        .filter(([k]) => plan.into[k]).map(([k, l]) => `${plan.into[k]} to ${l}`).join(", ");
      const ok = await askConfirm({
        title: `Bring in ${plural(plan.added + plan.updated, "title")} from Trakt?`,
        body: `${plan.added} new, ${plan.updated} updated${where ? ` (${where})` : ""}. Shows move to the last episode you watched on Trakt, and nothing goes back a step. You can undo straight after.`,
        confirmLabel: "Import",
      });
      if (!ok) return;
      onImport(plan);
      setTraktSettings({ imported: Date.now() });
    } catch (e) {
      showToast(e.message || "Couldn't import from Trakt");
    } finally {
      if (liveRef.current) setBusy("");
    }
  };

  const copyCode = () => navigator.clipboard?.writeText(code.user_code).then(() => showToast("Code copied"), () => {});
  const field = { ...fieldStyle(), width: "100%", marginBottom: 8 };
  return (
    <div>
      <div style={note}>
        Adds Trakt's rating and watch counts to each title and, once your account is connected, brings in your Trakt history: each show at the last episode you watched, so Up Next knows where you are.
      </div>
      <input aria-label="Trakt Client ID" value={conf.id || ""} onChange={(e) => setTraktSettings({ id: e.target.value.trim(), token: null })}
        placeholder="Client ID" autoComplete="off" autoCapitalize="off" spellCheck={false} style={field} />
      <input aria-label="Trakt Client Secret" type="password" value={conf.secret || ""} onChange={(e) => setTraktSettings({ secret: e.target.value.trim(), token: null })}
        placeholder="Client Secret (to connect your account)" autoComplete="off" autoCapitalize="off" spellCheck={false} style={field} />
      <div style={small}>
        Make a free app at{" "}
        <a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>trakt.tv → Your API Apps</a>: any name,
        Redirect URI <span className="mono">{TRAKT_REDIRECT}</span>, and this site,{" "}
        <span className="mono">{location.origin}</span>, as its JavaScript (CORS) origin. Both stay on this device.
      </div>

      {code ? (
        <div className="tvt-pop" style={{ background: "var(--bg-3)", borderRadius: 14, padding: "12px 14px", textAlign: "center", marginTop: 4 }}>
          <div style={{ fontSize: 13, color: "var(--ink-dim)" }}>Go to Trakt and enter</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "0.12em", margin: "6px 0 10px" }}>{code.user_code}</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <a href={code.verification_url || "https://trakt.tv/activate"} target="_blank" rel="noopener noreferrer" style={{ ...accentBtn(), textDecoration: "none" }}>Open Trakt</a>
            <button type="button" onClick={copyCode} style={ghostBtn()}>Copy Code</button>
            <button type="button" onClick={() => setCode(null)} style={ghostBtn()}>Cancel</button>
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 8 }}>Waiting for you to approve it…</div>
        </div>
      ) : connected ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          <button type="button" onClick={importNow} disabled={!!busy} style={accentBtn()}>{busy === "import" ? "Fetching…" : "Import from Trakt"}</button>
          <button type="button" onClick={() => setTraktSettings({ token: null })} style={{ ...ghostBtn(), color: "var(--danger)" }}>Disconnect</button>
        </div>
      ) : (
        <button type="button" onClick={connect} disabled={!conf.id || !conf.secret || !!busy} style={{ ...ghostBtn(), marginTop: 4, opacity: conf.id && conf.secret ? 1 : 0.4 }}>
          {busy === "connect" ? "Asking Trakt…" : "Connect Trakt Account"}
        </button>
      )}
      {connected && conf.imported > 0 && !code && <div style={{ ...small, margin: "8px 0 0" }}>Last imported {fmtAgo(conf.imported)}.</div>}
    </div>
  );
}

Object.assign(window, { useTraktSettings, useTraktStats, TraktSection, fetchTraktLibrary, TraktSettings });
