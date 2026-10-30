/* importcsv.jsx — bring titles in from CSV files: your own backups, or
   another tracker's exports of ratings, library, watched and lists. Each
   file is read by its column names, so most layouts work (Letterboxd,
   IMDb, Trakt- and TV Time-style exports, or a sheet with a Title
   column). Imports merge into the library, matched by TMDB id, else by
   title and year; nothing is removed. Titles that come in without a TMDB
   id are matched on TMDB afterwards, for posters, runtimes and Up Next. */
const { useState: useStateI, useEffect: useEffectI, useMemo: useMemoI, useRef: useRefI } = React;

/* What a file holds, which decides the list its titles go to when it has
   no status column of its own. */
const CSV_ROLES = [
  { v: "ratings", l: "Ratings", hint: "Sets your ratings. New titles go to Watched." },
  { v: "library", l: "Library", hint: "Uses the file's Status column; otherwise Watchlist, or Watching with progress." },
  { v: "watched", l: "Watched", hint: "Into Watched. Shows with episode progress go to Watching." },
  { v: "list", l: "List", hint: "Into your Watchlist. Shows with episode progress go to Watching." },
];
const STATUS_RANK = { watchlist: 0, watching: 1, watched: 2 };
// How the import sheet names the columns it found.
const CSV_FIELD_NAMES = {
  title: "title", kind: "type", year: "year", date: "release date", tmdb: "TMDB id", imdb: "IMDb id", url: "link",
  rating: "rating", status: "status", season: "season", episode: "episode", note: "note", added: "date",
};

/* Header names, lower-case with only letters and digits, in order of
   preference: a show's name beats "title", which an episode export uses
   for the episode. */
const SHOW_TITLE_HEADS = ["showtitle", "showname", "tvshowname", "seriesname", "seriestitle", "series", "show"];
const CSV_HEADS = {
  title: [...SHOW_TITLE_HEADS, "title", "name", "movietitle", "moviename", "movie", "film", "primarytitle", "originaltitle"],
  kind: ["type", "titletype", "mediatype", "kind", "category", "contenttype", "format", "entitytype", "itemtype", "objecttype"],
  year: ["year", "releaseyear", "startyear", "firstairyear"],
  date: ["releasedate", "firstairdate", "released", "premiered", "releasedon"],
  tmdb: ["tmdbid", "tmdb", "themoviedbid", "tmdbshowid", "tmdbmovieid", "idtmdb"],
  imdb: ["imdbid", "imdb", "const", "tconst", "imdbconst"],
  url: ["url", "link", "uri", "letterboxduri", "tmdburl", "imdburl"],
  rating: ["yourrating", "myrating", "userrating", "rating", "rating10", "score", "myscore", "stars"],
  // "watchlist" last: some trackers name their status column after it.
  status: ["status", "watchstatus", "mystatus", "userstatus", "liststatus", "trackingstatus", "state", "list", "shelf", "watchlist"],
  season: ["season", "seasonnumber", "seasonno", "seasonnum", "seasonnr", "episodeseasonnumber", "lastseason", "lastseasonwatched", "currentseason"],
  // The last episode watched, as a number or "S02E05".
  episode: ["episode", "episodenumber", "episodeno", "episodenum", "episodenr", "lastepwatched", "lastepisodewatched", "lastwatchedepisode", "lastepisode", "currentepisode", "progress"],
  note: ["note", "notes", "mynotes", "review", "comment", "comments"],
  added: ["dateadded", "added", "addedat", "createdat", "created", "daterated", "ratedat", "watchedat", "watcheddate", "lastwatched", "lastwatchedat", "date"],
};

const normHead = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/* A title for matching: no accents, case, punctuation or leading "The". */
const normTitle = (s) => splitYear(String(s || "")).title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/&/g, "and").replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]/g, "");
/* "Matlock (2024)", as some trackers tell remakes apart, is the title
   "Matlock" and the year 2024. */
function splitYear(t) {
  const m = t.match(/^(.*\S)\s*\(((?:18|19|20)\d\d)\)$/);
  return m ? { title: m[1], year: m[2] } : { title: t, year: "" };
}
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

/* parseCsv — rows of fields. Handles quoted fields (with commas, line
   breaks and doubled quotes), CRLF, a byte-order mark, and comma,
   semicolon or tab separators (whichever the first lines use most). */
function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const head = text.split(/\r?\n/, 5).join("\n");
  const delim = [",", ";", "\t"].map((d) => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

/* Which column holds each field, from a header row. */
function csvColumns(row) {
  const heads = row.map(normHead);
  const cols = {};
  for (const [f, names] of Object.entries(CSV_HEADS)) {
    for (const n of names) {
      const i = heads.indexOf(n);
      if (i !== -1 && !Object.values(cols).includes(i)) { cols[f] = i; break; }
    }
  }
  return { cols, heads };
}

function csvKind(v) {
  v = normHead(v);
  if (/movie|film|feature|short|video|documentary/.test(v)) return "movie"; // "TV Movie" too
  if (/tv|show|series|episode|season|mini|anime|^ova$|^ona$/.test(v)) return "tv";
  return null;
}
/* Your status for a title. Not "Continuing" or "Ended": those are a show's
   airing status, which some exports put in a Status column. */
function csvStatus(v) {
  v = normHead(v);
  if (/^(watching|inprogress|currentlywatching|started|onhold|hold|paused|rewatching|stopped|stoppedwatching)$/.test(v) || csvCaughtUp(v)) return "watching";
  if (/^(watchlist|plantowatch|wanttowatch|wanttosee|planned|towatch|notstarted|notstartedyet|later|forlater|queue|backlog|ptw|saved|wishlist|unwatched|notwatched)$/.test(v)) return "watchlist";
  if (/^(watched|completed|complete|finished|seen|done)$/.test(v)) return "watched";
  return null;
}
/* A status saying you've seen everything out so far (TV Time's "Up to
   date"). With no episode in the file, the show is caught up to its
   latest episode once it's linked to TMDB. */
const csvCaughtUp = (v) => /^(uptodate|caughtup|allcaughtup|uptodatewatching)$/.test(normHead(v));
/* A date as ISO, or "" (Safari won't read "2024-01-31 20:15:00"). */
function csvDate(v) {
  const t = Date.parse(String(v || "").trim().replace(/^(\d{4}-\d\d-\d\d) (\d)/, "$1T$2"));
  return t ? new Date(t).toISOString() : "";
}

/* csvRecords — a file's rows as titles: { title, kind (or null when the
   file doesn't say), tmdbId, imdbId, year, rating (0–5 in halves), status, season,
   episode, note, added, last (the latest date, for a watch history) }. Rows for the same title (a watch history has one
   per episode) are combined. Returns null when no row looks like a
   header. */
function csvRecords(rows) {
  // The header is whichever of the first rows names the most known columns,
  // the later one on a tie: a Letterboxd list opens with a row about the
  // list itself.
  let best = null;
  rows.slice(0, 10).forEach((r, i) => {
    const { cols, heads } = csvColumns(r);
    const n = Object.keys(cols).length;
    if (cols.title != null && (!best || n >= best.n)) best = { i, n, cols, heads };
  });
  if (!best) return null;
  const { cols, heads } = best;
  const at = (r, f) => (cols[f] == null ? "" : String(r[cols[f]] ?? "").trim());
  const showTitles = SHOW_TITLE_HEADS.includes(heads[cols.title]);
  const letterboxd = heads.includes("letterboxduri");

  const recs = [];
  let skipped = 0;
  for (const r of rows.slice(best.i + 1)) {
    const named = splitYear(at(r, "title").slice(0, 200));
    const title = named.title;
    const kindText = normHead(at(r, "kind"));
    // Games and podcasts aren't tracked; an episode row whose title is the
    // episode's (IMDb rates episodes one by one) can't be tied to its show.
    if (!title || /game|podcast/.test(kindText) || (kindText.includes("episode") && !showTitles)) { skipped++; continue; }
    const url = at(r, "url");
    const tmdbUrl = url.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
    const sxe = (at(r, "episode") + " " + at(r, "season")).match(/s(\d+)\s*e(\d+)|\b(\d+)x(\d+)\b/i);
    const season = sxe ? toInt(sxe[1] || sxe[3]) : toInt(at(r, "season"));
    const episode = sxe ? toInt(sxe[2] || sxe[4]) : toInt(at(r, "episode"));
    let kind = csvKind(kindText) || (tmdbUrl && tmdbUrl[1]) || null;
    const caughtUp = csvCaughtUp(at(r, "status"));
    if (!kind && (showTitles || episode > 0 || caughtUp)) kind = "tv";
    if (!kind && (letterboxd || /letterboxd\.com|boxd\.it/.test(url))) kind = "movie";
    const date = csvDate(at(r, "added"));
    const year = (at(r, "year").match(/\b(18|19|20)\d\d\b/) || at(r, "date").match(/\b(18|19|20)\d\d\b/) || [named.year])[0];
    recs.push({
      title, kind, year,
      tmdbId: toInt(at(r, "tmdb")) || (tmdbUrl ? toInt(tmdbUrl[2]) : 0) || null,
      imdbId: ((at(r, "imdb") + " " + url).match(/tt\d{5,}/) || [""])[0],
      raw: parseFloat(at(r, "rating").replace(",", ".")) || 0,
      status: csvStatus(at(r, "status")),
      caughtUp,
      season: season > 0 ? season : 0,
      episode: season > 0 && episode > 0 ? episode : 0,
      note: at(r, "note").slice(0, 2000),
      added: date,
      last: date,
    });
  }

  // Ratings out of 10 (IMDb) or 100 become stars, to the nearest half;
  // Letterboxd's half stars stay as they are.
  const top = Math.max(0, ...recs.map((x) => x.raw));
  const tenScale = heads[cols.rating] === "rating10" || (heads[cols.rating] === "yourrating" && cols.imdb != null);
  const scale = top > 10 ? 20 : tenScale || top > 5 ? 2 : 1;
  for (const x of recs) {
    x.rating = x.raw > 0 ? clampRating(Math.max(0.5, x.raw / scale)) : 0;
    delete x.raw;
  }
  return { recs: combineRecs(recs), skipped, fields: Object.keys(cols) };
}

const laterEp = (a, b) => (b.season > a.season || (b.season === a.season && b.episode > a.episode) ? b : a);
/* Two records of one title as one: the furthest progress, the earliest
   and latest dates, the later non-zero rating, a set status over a guessed (`weak`) one and, between
   equals, the furthest along. */
function mergeRecs(a, b) {
  const ep = laterEp(a, b);
  let status = a.status, weak = a.weak;
  if (b.status && (!status || (weak && !b.weak) || (weak === b.weak && STATUS_RANK[b.status] > STATUS_RANK[status]))) {
    status = b.status; weak = b.weak;
  }
  return {
    ...a,
    kind: a.kind || b.kind, tmdbId: a.tmdbId || b.tmdbId, imdbId: a.imdbId || b.imdbId, year: a.year || b.year,
    rating: b.rating || a.rating, status, weak, caughtUp: a.caughtUp || b.caughtUp,
    season: ep.season, episode: ep.episode,
    note: a.note || b.note,
    added: [a.added, b.added].filter(Boolean).sort()[0] || "",
    last: [a.last, b.last].filter(Boolean).sort().pop() || "",
  };
}
/* combineRecs — one record per title. The same title is matched by TMDB
   id, else IMDb id, else by name, where the years and types don't
   disagree (one file may have the id, another only the name). */
function combineRecs(recs) {
  const out = [];
  const byId = new Map(), byName = new Map();
  const fits = (a, b) => (!a.year || !b.year || a.year === b.year) && (!a.kind || !b.kind || a.kind === b.kind)
    && !(a.tmdbId && b.tmdbId && a.tmdbId !== b.tmdbId) && !(a.imdbId && b.imdbId && a.imdbId !== b.imdbId);
  for (const x of recs) {
    const ids = [x.tmdbId && x.kind && `${x.kind}:${x.tmdbId}`, x.imdbId && `imdb:${x.imdbId}`].filter(Boolean);
    const name = normTitle(x.title);
    let n = ids.map((k) => byId.get(k)).find((i) => i != null);
    if (n == null) n = (byName.get(name) || []).find((i) => fits(out[i], x));
    if (n == null) {
      n = out.push(x) - 1;
      byName.set(name, [...(byName.get(name) || []), n]);
    } else out[n] = mergeRecs(out[n], x);
    const r = out[n];
    for (const k of [r.tmdbId && r.kind && `${r.kind}:${r.tmdbId}`, r.imdbId && `imdb:${r.imdbId}`]) if (k) byId.set(k, n);
  }
  return out;
}

/* readCsvFile — a picked file, ready for the import sheet. */
async function readCsvFile(file) {
  const f = { id: newId(), name: file.name, role: "library", recs: [], skipped: 0, error: "" };
  if (file.size > 20e6) return { ...f, error: "Too big to import (over 20 MB)" };
  try {
    const parsed = csvRecords(parseCsv(await file.text()));
    if (!parsed) return { ...f, error: "No Title or Name column found" };
    return { ...f, ...parsed, role: guessRole(file.name) };
  } catch {
    return { ...f, error: "Couldn't read this file" };
  }
}
function guessRole(name) {
  const n = name.toLowerCase();
  if (/rating|rated|score/.test(n)) return "ratings";
  if (/watchlist|list|queue|plan/.test(n)) return "list";
  if (/watched|history|diary|seen|completed|views/.test(n)) return "watched";
  return "library";
}

/* A record's status from its file's role, when the file doesn't set one.
   A guessed status is `weak`: it never moves a title already in the
   library, and a set one from another file beats it. A show with
   episodes watched is at least on the go, whatever the file holds. */
function withRole(x, role) {
  if (x.status) return { ...x, weak: false };
  const progress = x.kind !== "movie" && (x.episode > 0 || x.season > 1);
  if (role === "watched") return { ...x, status: progress ? "watching" : "watched", weak: false };
  if (role === "ratings") return { ...x, status: "watched", weak: true };
  return { ...x, status: progress ? "watching" : "watchlist", weak: true };
}
const hasProgress = (i) => i.kind === "tv" && (i.episode > 0 || i.season > 1);

/* planImport — the library after importing `files`: matched titles updated
   (a set status only moves a title further along, never back; ratings and
   progress fill in), the rest added. `toLink` lists titles that still need
   TMDB (no id, or an id but no poster); `caughtUp` the shows to move on to
   their latest episode once they're linked. */
function planImport(files, items) {
  const recs = combineRecs(files.filter((f) => !f.error).flatMap((f) => f.recs.map((x) => withRole(x, f.role))));
  const byTmdb = new Map(items.filter((i) => i.tmdbId).map((i) => [`${i.kind}:${i.tmdbId}`, i]));
  const byTitle = new Map();
  for (const i of items) {
    const k = normTitle(i.title);
    byTitle.set(k, [...(byTitle.get(k) || []), i]);
  }
  const find = (x) => {
    if (x.tmdbId && x.kind && byTmdb.has(`${x.kind}:${x.tmdbId}`)) return byTmdb.get(`${x.kind}:${x.tmdbId}`);
    const same = (byTitle.get(normTitle(x.title)) || []).filter((i) => !x.kind || i.kind === x.kind);
    return same.find((i) => i.year && i.year === x.year) || same.find((i) => !i.year || !x.year) || null;
  };

  const changes = new Map();
  const fresh = [];
  const caughtUp = new Set(); // ids of shows the file says you're up to date with
  for (const x of recs) {
    const found = find(x);
    if (found && x.caughtUp && found.kind === "tv") caughtUp.add(found.id);
    const base = found && (changes.get(found.id) || found);
    if (!base) {
      fresh.push(x);
      continue;
    }
    const next = { ...base };
    if (x.status && !x.weak && STATUS_RANK[x.status] > STATUS_RANK[next.status]) next.status = x.status;
    if (x.rating) next.rating = x.rating;
    if (next.kind === "tv" && x.season && laterEp(next, x) === x) {
      next.season = x.season;
      next.episode = x.episode;
      if (x.last > (next.lastWatched || "")) next.lastWatched = x.last;
    }
    // Episodes watched mean it's started, even if a guessed status said
    // Watchlist (this is how a re-import puts shows back on the go).
    if (next.status === "watchlist" && hasProgress(next)) next.status = "watching";
    if (!next.tmdbId && x.tmdbId && x.kind === next.kind) next.tmdbId = x.tmdbId;
    if (!next.year && x.year) next.year = x.year;
    if (!next.note && x.note) next.note = x.note;
    const changed = ["status", "rating", "season", "episode", "tmdbId", "year", "note"].some((k) => next[k] !== base[k]);
    if (changed) changes.set(base.id, normaliseItem(touch(next)));
  }

  // Newest first, so the lists show them in the order they were added.
  fresh.sort((a, b) => (b.added || "").localeCompare(a.added || ""));
  // A title whose type the file didn't say is saved as a movie until TMDB
  // says otherwise.
  const source = new Map();
  const added = [];
  for (const x of fresh) {
    const item = normaliseItem(touch({
      ...blankItem(x.status), title: x.title, kind: x.kind || "movie", tmdbId: x.tmdbId, year: x.year,
      rating: x.rating, season: x.season || 1, episode: x.episode, note: x.note, added: x.added || undefined, lastWatched: x.last || "",
    }));
    if (item) {
      added.push(item);
      source.set(item.id, x);
      if (x.caughtUp && item.kind === "tv") caughtUp.add(item.id);
    }
  }

  const toLink = [...added, ...changes.values()].filter((i) => !i.tmdbId || !i.poster).map((i) => {
    const x = source.get(i.id);
    return { id: i.id, title: i.title, year: i.year, tmdbId: i.tmdbId, kind: x && !x.kind ? null : i.kind, imdbId: x?.imdbId || "" };
  });
  // Where titles land: new ones, and ones moving to another list.
  const before = new Map(items.map((i) => [i.id, i.status]));
  const into = { watching: 0, watched: 0, watchlist: 0 };
  for (const i of [...added, ...changes.values()]) if (before.get(i.id) !== i.status) into[i.status]++;
  return {
    items: [...added, ...items.map((i) => changes.get(i.id) || i)],
    added: added.length, updated: changes.size, same: recs.length - added.length - changes.size, toLink, into, caughtUp: [...caughtUp],
  };
}

/* ============ Matching on TMDB ============ */
const tilePatch = (tile, t) => ({ tmdbId: tile.tmdbId, kind: tile.kind, poster: tile.poster, year: tile.year || t.year });

/* The best search result for a title: its name and year matching, in
   TMDB's order of relevance. With a year, a result must match one or the
   other, so a wrong guess is left unlinked rather than given the wrong
   poster. */
async function searchBest(t, key) {
  const params = { query: t.title, include_adult: "false", language: TMDB_LANGUAGE, page: "1" };
  const yearParam = t.kind === "movie" ? "primary_release_year" : t.kind === "tv" ? "first_air_date_year" : "";
  const search = async (p) => ((await tmdbGet(t.kind ? `/search/${t.kind}` : "/search/multi", p, key)).results || [])
    .map((r) => tmdbTile(r, t.kind)).filter(Boolean);
  let tiles = t.year && yearParam ? await search({ ...params, [yearParam]: t.year }) : [];
  if (!tiles.length) tiles = await search(params);
  const want = normTitle(t.title);
  const score = (x) => (normTitle(x.title) === want ? 2 : 0) + (t.year && x.year === t.year ? 2 : t.year && Math.abs(x.year - t.year) === 1 ? 1 : 0);
  let best = null, bestScore = -1;
  for (const x of tiles) if (score(x) > bestScore) { best = x; bestScore = score(x); }
  return best && (!t.year || bestScore >= 2) ? best : null;
}

async function matchOnTmdb(t, key) {
  if (t.tmdbId && t.kind) {
    const d = await loadDetails(t.kind, t.tmdbId, key);
    return { poster: d.poster, year: d.date.slice(0, 4) || t.year };
  }
  if (t.imdbId) {
    const r = await tmdbGet(`/find/${t.imdbId}`, { external_source: "imdb_id", language: TMDB_LANGUAGE }, key);
    const tv = t.kind !== "movie" && r.tv_results?.[0] ? tmdbTile(r.tv_results[0], "tv") : null;
    const movie = t.kind !== "tv" && r.movie_results?.[0] ? tmdbTile(r.movie_results[0], "movie") : null;
    if (tv || movie) return tilePatch(tv || movie, t);
  }
  const best = await searchBest(t, key);
  return best ? tilePatch(best, t) : null;
}

/* A dropped connection or TMDB's rate limit is worth another go, after a
   pause; a bad key isn't. */
async function tmdbRetry(fn, tries = 3) {
  for (let n = 1; ; n++) {
    try { return await fn(); } catch (e) {
      if (n >= tries || !/connection|error (429|5\d\d)/i.test(e?.message || "")) throw e;
      await new Promise((r) => setTimeout(r, 1500 * n));
    }
  }
}

// Titles matched (or being matched) this visit, so the poster backfill
// doesn't fetch them twice. Ones cut off by a lost connection or a bad
// key wait in linkFailed until the app wakes or the key changes.
const linkTried = new Set();
const linkFailed = new Set();
function releaseFailedLinks() {
  linkFailed.forEach((id) => linkTried.delete(id));
  linkFailed.clear();
}

/* linkWithTmdb — match imported titles on TMDB, four at a time. Matches
   reach onBatch (a Map of id → patch) every moment rather than one by one,
   so a big import doesn't re-render and save per title. Resolves with how
   many matched. */
async function linkWithTmdb(targets, key, onBatch) {
  const queue = [...targets];
  targets.forEach((t) => linkTried.add(t.id));
  let matched = 0, pending = new Map(), timer = 0;
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!pending.size) return;
    const batch = pending;
    pending = new Map();
    onBatch(batch);
  };
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      try {
        const patch = await tmdbRetry(() => matchOnTmdb(t, key));
        if (!patch) continue;
        matched++;
        pending.set(t.id, patch);
        if (!timer) timer = setTimeout(flush, 800);
      } catch (e) {
        // A bad key, or no connection even after retrying, fails every
        // request: stop rather than try them all.
        if (/key|connection/i.test(e.message || "")) [t, ...queue.splice(0)].forEach((q) => linkFailed.add(q.id));
      }
    }
  };
  await Promise.all([0, 1, 2, 3].map(worker));
  flush();
  return matched;
}

/* usePosterBackfill — library titles with a TMDB id but no poster get it
   (and their details), in the background. That finishes a match an import
   started but didn't get through (the app was closed, or the phone slept),
   and fills in titles added offline. Runs a moment after the app opens,
   and again when it comes back to the foreground or online. The edit time
   is left alone, so the titles don't jump to the top of the recent lists;
   each device fills in its own. */
function usePosterBackfill(items, key, updateItems) {
  const [wake, setWake] = useStateI(0);
  useEffectI(() => {
    const on = () => {
      if (document.visibilityState !== "visible") return;
      releaseFailedLinks();
      setWake((w) => w + 1);
    };
    document.addEventListener("visibilitychange", on);
    window.addEventListener("online", on);
    return () => {
      document.removeEventListener("visibilitychange", on);
      window.removeEventListener("online", on);
    };
  }, []);
  useEffectI(() => {
    if (!linkFailed.size) return;
    releaseFailedLinks();
    setWake((w) => w + 1);
  }, [key]);
  const want = key ? items.filter((i) => i.tmdbId && !i.poster && !linkTried.has(i.id)) : [];
  const sig = want.map((i) => i.id).join(",");
  useEffectI(() => {
    if (!want.length || navigator.onLine === false) return;
    const t = setTimeout(() => {
      const targets = want.map((i) => ({ id: i.id, title: i.title, year: i.year, tmdbId: i.tmdbId, kind: i.kind, imdbId: "" }));
      linkWithTmdb(targets, key, (batch) => updateItems((prev) => prev.map((i) => {
        const p = batch.get(i.id);
        return p?.poster && !i.poster ? normaliseItem({ ...i, poster: p.poster, year: i.year || p.year }) || i : i;
      })));
    }, 2500);
    return () => clearTimeout(t);
  }, [sig, key, wake]);
}

/* ============ The import sheet ============ */
function CsvImportSheet({ items, tmdbKey, onImport, onClose }) {
  const { ref, closing, close } = useModalDismiss(onClose);
  const fileRef = useRefI(null);
  const [files, setFiles] = useStateI([]);
  const [reading, setReading] = useStateI(false);
  const plan = useMemoI(() => (files.some((f) => !f.error) ? planImport(files, items) : null), [files, items]);
  const note = { fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5 };

  const pick = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // so choosing the same file again still fires
    if (!picked.length) return;
    setReading(true);
    const read = await Promise.all(picked.map(readCsvFile));
    setReading(false);
    setFiles((fs) => [...fs, ...read]);
  };
  const setRole = (id, role) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, role } : f)));
  const drop = (id) => setFiles((fs) => fs.filter((f) => f.id !== id));
  const go = () => {
    if (!plan || closing) return;
    onImport(plan);
    close();
  };
  const count = plan ? plan.added + plan.updated : 0;
  const unlinked = plan ? plan.toLink.length : 0;
  const into = plan && Object.entries(plan.into).filter(([, n]) => n).map(([s, n]) => `${statusLabel(s)} ${n}`).join(", ");

  return (
    <ModalFrame sheet dismiss={{ ref, closing, close }} label="Import CSV files">
      <ModalHead eyebrow="Backup" title="Import CSV files" onClose={close} />
      <div style={{ ...note, marginBottom: 14 }}>
        Pick one or more CSV exports: ratings, library, watched or lists. They're merged into your library. Titles you
        already have are updated, and nothing is removed.
      </div>
      {files.map((f, i) => (
        <AnimatedRow key={f.id} index={i} gap={10}>
          <div style={{ background: "var(--bg-2)", borderRadius: 16, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                <div style={{ fontSize: 12.5, color: f.error ? "var(--danger)" : "var(--ink-dim)", marginTop: 2 }}>
                  {f.error || [plural(f.recs.length, "title"), f.skipped && `${f.skipped} row${f.skipped === 1 ? "" : "s"} skipped`].filter(Boolean).join(" · ")}
                </div>
                {/* So a file whose status or episode column wasn't
                    recognised shows it before anything is imported. */}
                {!f.error && f.fields && (
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 2, lineHeight: 1.35 }}>
                    Reads {f.fields.map((k) => CSV_FIELD_NAMES[k]).join(", ")}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => drop(f.id)} aria-label={`Remove ${f.name}`} style={{ ...iconBtn(36), color: "var(--ink-dim)" }}><XIcon size={11} /></button>
            </div>
            {!f.error && (
              <div style={{ marginTop: 10 }}>
                <SegToggle full small options={CSV_ROLES} value={f.role} onChange={(v) => setRole(f.id, v)} label={`What ${f.name} holds`} />
                <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 6, lineHeight: 1.4 }}>{CSV_ROLES.find((r) => r.v === f.role)?.hint}</div>
              </div>
            )}
          </div>
        </AnimatedRow>
      ))}
      <button type="button" onClick={() => fileRef.current?.click()} disabled={reading} style={{ ...ghostBtn(), width: "100%" }}>
        {reading ? "Reading…" : files.length ? "Add Another File" : "Choose CSV Files"}
      </button>
      <input ref={fileRef} type="file" accept=".csv,text/csv,text/comma-separated-values,text/plain" multiple onChange={pick} hidden />
      {plan && (
        <div className="tvt-pop" style={{ ...note, marginTop: 14 }}>
          <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{plan.added}</span> new ·{" "}
          <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{plan.updated}</span> updated ·{" "}
          <span className="mono">{plan.same}</span> already up to date.
          {into && <> Into {into}.</>}
          {plan.caughtUp.length > 0 && ` ${plural(plan.caughtUp.length, "show")} marked up to date will jump to the latest episode out${tmdbKey ? "" : " once you add a TMDB key"}.`}
          {unlinked > 0 && (tmdbKey
            ? ` ${plural(unlinked, "title")} will then be matched on TMDB for posters and episode details.`
            : ` Add a TMDB key in Settings first if you want posters for the ${plural(unlinked, "title")} without one.`)}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
        <button type="button" onClick={close} style={ghostBtn()}>Cancel</button>
        <button type="button" onClick={go} disabled={!count} style={{ ...accentBtn(), opacity: count ? 1 : 0.4, cursor: count ? "pointer" : "default" }}>
          {count ? `Import ${plural(count, "title")}` : "Import"}
        </button>
      </div>
    </ModalFrame>
  );
}

Object.assign(window, { parseCsv, csvRecords, planImport, linkWithTmdb, usePosterBackfill, CsvImportSheet });
