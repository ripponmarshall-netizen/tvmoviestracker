/* app.jsx — data, routing, the list screens, the add/edit sheet, settings
   and the tab bar */
const { useState, useEffect, useMemo, useRef } = React;

const APP_NAME = "Nostalgiaa";
const APP_VERSION = "1.12.0";
// The maker's tag, in the footer of Profile and in Settings → About.
const MAKER_TAG = "Workflow Coaching and Optimization";

/* ============ Data ============
   Everything lives in localStorage under one key. If the item shape ever
   changes incompatibly, bump the key (tvt:v2) and migrate in loadState. */
const STORE_KEY = "tvt:v1";

// Where a title is in your library. A status gets a list screen (Profile →
// Library), status tiles on the title sheet and a place in the edit sheet.
const STATUSES = [
  { v: "watching", l: "Watching", icon: PlayIcon, empty: "Nothing on the go. Start something from your watchlist, or add a title." },
  { v: "watchlist", l: "Watchlist", icon: BookmarkIcon, empty: "Save the shows and movies you want to get to." },
  { v: "watched", l: "Watched", icon: CheckCircleIcon, empty: "Finished titles land here, with your rating." },
];
// The tab bar, in order.
const TABS = [
  { v: "watching", l: "Watching", icon: PlayIcon },
  { v: "explore", l: "Explore", icon: CompassIcon },
  { v: "books", l: "Books", icon: BookIcon },
  { v: "profile", l: "Profile", icon: PersonIcon },
];
// Shows and movies: the kinds the edit sheet offers. Books (books.jsx)
// are a third kind with their own tab and sheet.
const KINDS = [
  { v: "tv", l: "Show" },
  { v: "movie", l: "Movie" },
];
const ALL_KINDS = [...KINDS, { v: "book", l: "Book" }];
const FILTERS = [
  { v: "all", l: "All" },
  { v: "tv", l: "Shows" },
  { v: "movie", l: "Movies" },
];
// Explore has Anime too: AniList's shelves (anilist.jsx).
const EXPLORE_KINDS = [...FILTERS, { v: "anime", l: "Anime" }];
// Countries for Where to Watch (JustWatch's data, via TMDB), Jamaica and
// its neighbours first. Any two-letter code works; these are the picks.
const REGIONS = ["JM", "TT", "BB", "BS", "KY", "DO", "US", "CA", "GB", "IE", "AU", "NZ", "IN", "NG", "ZA", "DE", "FR", "ES", "MX", "BR"];

const THEMES = [
  { v: "auto", l: "Auto" },
  { v: "light", l: "Light" },
  { v: "dark", l: "Dark" },
];

const pick = (v, list, fallback) => (list.some((o) => o.v === v) ? v : fallback);
const clampInt = (n, min, max) => Math.min(max, Math.max(min, Math.round(Number(n)) || 0));
const nowIso = () => new Date().toISOString();
const statusLabel = (v) => STATUSES.find((s) => s.v === v)?.l || v;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/* Ratings run 0–5 in half stars; 0 is unrated. */
const clampRating = (n) => Math.min(5, Math.max(0, Math.round((Number(n) || 0) * 2) / 2));
const fmtRating = (r) => (r % 1 ? r.toFixed(1) : String(r));
/* 3.5 as "★★★½", the way Letterboxd writes it. */
const starText = (r) => "★".repeat(Math.floor(r)) + (r % 1 ? "½" : "");

function newId() {
  return window.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/* normaliseItem — the one place that decides what a valid item is.
   Loading, importing and saving all pass through it, so a new field only
   needs adding here (with its default) and to the edit sheet. */
function normaliseItem(x) {
  if (!x || typeof x !== "object") return null;
  const title = String(x.title ?? "").trim().slice(0, 200);
  if (!title) return null;
  const now = nowIso();
  const updated = typeof x.updated === "string" ? x.updated : now;
  const kind = pick(x.kind, ALL_KINDS, "tv");
  return {
    id: typeof x.id === "string" && x.id ? x.id : newId(),
    kind,
    title,
    status: pick(x.status, STATUSES, "watchlist"),
    // TV progress: the last episode watched (episode 0 = season not started).
    season: clampInt(x.season ?? 1, 1, 999),
    episode: clampInt(x.episode ?? 0, 0, 9999),
    rating: clampRating(x.rating),
    note: String(x.note ?? "").slice(0, 2000),
    // Filled in when the title is picked from TMDB search; empty otherwise.
    tmdbId: Number.isInteger(x.tmdbId) && x.tmdbId > 0 ? x.tmdbId : null,
    poster: typeof x.poster === "string" && /^\/[\w.-]+$/.test(x.poster) ? x.poster : "",
    year: /^\d{4}$/.test(String(x.year ?? "")) ? String(x.year) : "",
    added: typeof x.added === "string" ? x.added : now,
    updated,
    // When you last moved it on (an episode ticked, or put on the go): Up
    // Next keeps what you've watched lately and archives the rest. Titles
    // saved before this existed count their last edit.
    lastWatched: typeof x.lastWatched === "string" ? (Date.parse(x.lastWatched) ? x.lastWatched : "") : updated,
    // A show you're watching again: the last episode rewatched (episode 0 =
    // not started), apart from your progress, which a rewatch leaves alone.
    // null when not rewatching.
    rewatch: kind === "tv" && x.rewatch && typeof x.rewatch === "object"
      ? { season: clampInt(x.rewatch.season ?? 1, 1, 999), episode: clampInt(x.rewatch.episode ?? 0, 0, 9999) } : null,
    // Rewatches finished (a show watched through again, a movie watched again).
    rewatches: clampInt(x.rewatches ?? 0, 0, 999),
    // A book's author, pages, Open Library link and cover (books.jsx).
    ...(kind === "book" ? bookFields(x) : {}),
  };
}
/* A list from storage or a backup file: valid items only, unique ids
   (duplicate ids would confuse React's row keys). */
function cleanList(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(normaliseItem).filter(Boolean).map((it) => {
    if (seen.has(it.id)) it = { ...it, id: newId() };
    seen.add(it.id);
    return it;
  });
}
function blankItem(status) {
  return { id: newId(), kind: "tv", title: "", status, season: 1, episode: 0, rating: 0, note: "", tmdbId: null, poster: "", year: "", lastWatched: "" };
}
// A fresh edit time, so this version wins when devices sync (undo uses it).
const touch = (item) => ({ ...item, updated: nowIso() });
/* An edit that moves a title on (a later episode, or into Watching) counts
   as watching it, which keeps it in Up Next rather than the archive. A
   rating or a note doesn't. */
const progressRank = (i) => (i.kind === "tv" ? i.season * 10000 + i.episode : i.kind === "book" ? i.page : 0);
function stampWatch(before, after, { log = true } = {}) {
  if (!before) return after;
  // The episode or movie goes into the Activity history (watchlog.jsx).
  if (log) logWatchStep(before, after);
  const on = progressRank(after) > progressRank(before) || (after.status === "watching" && before.status !== "watching");
  return on ? { ...after, lastWatched: nowIso() } : after;
}

function loadState() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch {}
  return {
    items: cleanList(s.items),
    theme: pick(s.theme, THEMES, "auto"),
    tab: pick(s.tab, TABS, "watching"),
    filter: pick(s.filter, FILTERS, "all"),
    explore: pick(s.explore, EXPLORE_KINDS, "all"),
    tmdbKey: typeof s.tmdbKey === "string" ? s.tmdbKey : "",
    region: /^[A-Z]{2}$/.test(s.region || "") ? s.region : guessRegion(),
    avatar: cleanAvatar(s.avatar),
    username: cleanUsername(s.username),
  };
}
function saveState(state) {
  // Full or blocked storage (private browsing): the app still works for
  // this visit, it just won't remember.
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, ...state })); } catch {}
}

function progressLabel(item) {
  if (item.rewatch) return `Rewatching S${item.rewatch.season} · E${item.rewatch.episode}`;
  // A finished show's progress says nothing ("Not started" would mislead).
  if (item.kind !== "tv" || item.status === "watched") return null;
  if (item.season === 1 && item.episode === 0) return "Not started";
  return `S${item.season} · E${item.episode}`;
}

/* quickAction — the one-tap button on a row (or null for none). `patch`
   is merged into the item; when it moves the item to another list, the row
   folds away and a toast offers Undo. Add new one-tap actions here. With
   TMDB details, +1 rolls on to the next season and stops at what's aired. */
function quickAction(item) {
  if (item.status === "watchlist") return { label: "Start", patch: { status: "watching" } };
  if (item.status !== "watching") return null;
  if (item.kind !== "tv") return { label: "Done", patch: { status: "watched" } };
  const d = cachedDetails("tv", item.tmdbId);
  const n = nextEpisode(item, d);
  if (n) return n.aired ? { label: "+1 ep", accent: true, patch: { season: n.season, episode: n.episode } } : null;
  return isFinished(d) ? { label: "Done", patch: { status: "watched" } } : null;
}

/* ============ App ============ */
function App() {
  const initial = useMemo(loadState, []);
  const [items, setItems] = useState(initial.items);
  const [theme, setTheme] = useState(initial.theme);
  const [tab, setTab] = useState(initial.tab);
  const [list, setList] = useState(null); // a status whose list is open over the tab
  const [filter, setFilter] = useState(initial.filter);
  const [explore, setExplore] = useState(initial.explore);
  const [query, setQuery] = useState(""); // Explore's search
  const [tmdbKey, setTmdbKey] = useState(initial.tmdbKey);
  const [region, setRegion] = useState(initial.region); // for Where to Watch
  // Read when TMDB's details are fetched; setting it again is harmless.
  setWatchRegion(region);
  const [avatar, setAvatar] = useState(initial.avatar); // profile picture, as a data: URL
  const [username, setUsername] = useState(initial.username);
  const [profileOpen, setProfileOpen] = useState(false);
  const [detail, setDetail] = useState(null); // the title open in the title sheet
  const [editing, setEditing] = useState(null); // the item open in the edit sheet
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [book, setBook] = useState(null); // the book open in the book sheet
  const [bookImportOpen, setBookImportOpen] = useState(false);
  // The latest list, for timers (fold-away, Undo) and sync merges. Every
  // change goes through updateItems, which updates it at once rather than
  // on the next render, so a merge never works from a stale copy.
  const itemsRef = useRef(items);
  const updateItems = (fn) => {
    const next = fn(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  };

  const session = useSession();
  const userId = session?.user?.id;
  const sync = useCloudSync(userId, items, itemsRef, updateItems);
  useProfileField(userId, "tmdb_key", tmdbKey, setTmdbKey);
  useProfileField(userId, "avatar", avatar, setAvatar, cleanAvatar);
  useProfileField(userId, "username", username, setUsername, cleanUsername);
  // Books live in the same list (so they sync and back up), but the TV
  // and movie screens, TMDB lookups, imports and stats only see `media`.
  const media = useMemo(() => items.filter((i) => !isBook(i)), [items]);
  const books = useMemo(() => items.filter(isBook), [items]);
  usePosterBackfill(media, tmdbKey, updateItems);
  useBookBackfill(books, updateItems);

  // The app is on screen: hand the loading screen over to the header logo.
  useEffect(() => { window.tvtSplashDone?.(); }, []);

  useEffect(() => { saveState({ items, theme, tab, filter, explore, tmdbKey, region, avatar, username }); }, [items, theme, tab, filter, explore, tmdbKey, region, avatar, username]);

  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
    const apply = () => {
      const resolved = theme === "auto" ? (mq?.matches ? "light" : "dark") : theme;
      document.body.setAttribute("data-theme", resolved);
      // index.html sets it on <html> before first paint; keep them in step.
      document.documentElement.setAttribute("data-theme", resolved);
      document.getElementById("theme-color-meta")?.setAttribute("content", resolved === "light" ? "#f2f2f7" : "#000000");
    };
    apply();
    if (theme === "auto" && mq) {
      mq.addEventListener?.("change", apply);
      return () => mq.removeEventListener?.("change", apply);
    }
  }, [theme]);

  React.useLayoutEffect(() => { window.scrollTo(0, 0); }, [tab, list]);
  // Which way the new tab's screen slides in: from the side its tab is on.
  const tabIndex = TABS.findIndex((t) => t.v === tab);
  const lastTab = useRef(tabIndex);
  const enterFrom = useMemo(() => {
    const from = Math.sign(tabIndex - lastTab.current);
    lastTab.current = tabIndex;
    return from;
  }, [tabIndex]);
  // Tapping the current tab goes back from a list, then scrolls to the top.
  const go = (t) => {
    if (t === tab) {
      if (list) { setList(null); return; }
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
      return;
    }
    setList(null);
    setTab(t);
  };

  const replace = (item) => updateItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
  const findItem = (id) => itemsRef.current.find((i) => i.id === id);

  const openItem = (item) => setDetail({ itemId: item.id, kind: item.kind, tmdbId: item.tmdbId, title: item.title, poster: item.poster, year: item.year });
  const openTile = (tile) => setDetail(tile);

  const patchItem = (id, patch) => {
    const item = findItem(id);
    if (item) replace(touch(stampWatch(item, { ...item, ...patch })));
  };

  const moveTo = (id, status) => {
    const before = findItem(id);
    if (!before || before.status === status) return;
    const book = isBook(before);
    replace(touch(stampWatch(before, { ...before, ...(book ? bookStatusPatch(before, status) : { status }) })));
    showToast(`Moved to ${book ? bookStatusLabel(status) : statusLabel(status)}`, { action: { label: "Undo", onClick: () => replace(touch(before)) } });
  };

  /* ============ Books ============ */
  const openBook = (b, opts = {}) => setBook({ ...b, ...(b.id && findItem(b.id) ? { itemId: b.id } : {}), ...opts });
  // A book from Open Library's search into the library.
  const addBook = (tile, status) => {
    const now = nowIso();
    const item = normaliseItem(touch({
      ...blankItem(status), kind: "book", title: tile.title, author: tile.author, olKey: tile.olKey, cover: tile.cover,
      pages: tile.pages, isbn: tile.isbn, year: tile.year, lastWatched: status === "watching" ? now : "",
      ...(status === "watched" ? { finished: now, page: tile.pages } : {}),
    }));
    if (!item) return;
    updateItems((prev) => [item, ...prev]);
    showToast(`Added to ${bookStatusLabel(status)}`, { action: { label: "Undo", onClick: () => updateItems((prev) => prev.filter((i) => i.id !== item.id)) } });
  };
  // One Open Library hasn't got: added as typed, its sheet open to fill in.
  const addBookByHand = (title) => {
    const item = normaliseItem(touch({ ...blankItem("watchlist"), kind: "book", title }));
    if (!item) return;
    updateItems((prev) => [item, ...prev]);
    setBook({ itemId: item.id, editDetails: true });
  };
  const bookMenu = (b) => {
    const item = findItem(b.id) || b;
    showMenu({
      title: item.title,
      sub: [item.author, bookStatusLabel(item.status), bookProgressLabel(item)].filter(Boolean).join(" · "),
      actions: [
        item.status === "watching" && { label: "Update Page…", sub: "Log where you've got to", icon: <BookIcon size={18} />, run: () => openBook(item, { focusPage: true }) },
        item.status !== "watched" && { label: "Finished It", sub: "Move to Read", icon: <CheckCircleIcon size={18} />, run: () => moveTo(item.id, "watched") },
        item.status !== "watching" && { label: item.status === "watched" ? "Read It Again" : "Start Reading", sub: item.status === "watched" ? "Back to Reading, from page 1" : null, icon: <BookIcon size={18} />, run: () => moveTo(item.id, "watching") },
        item.status !== "watchlist" && { label: "Move to Want to Read", sub: "For later", icon: <BookmarkIcon size={18} />, run: () => moveTo(item.id, "watchlist") },
        { label: "Edit Details", icon: <PencilIcon size={18} />, run: () => openBook(item, { editDetails: true }) },
        { label: "Remove from Library", danger: true, icon: <TrashIcon size={18} />, run: () => deleteItem(item.id) },
      ],
    });
  };
  // A Goodreads or StoryGraph import: new books and updated ones, with Undo.
  const importBooks = (plan) => {
    const n = plan.added.length + plan.changed.size;
    replaceAll([...plan.added, ...itemsRef.current.map((i) => plan.changed.get(i.id) || i)], `Imported ${plural(n, "book")}`);
  };

  // A title from TMDB (Explore, "More like this") into the library.
  const addTitle = (tile, status) => {
    const item = normaliseItem(touch({ ...blankItem(status), title: tile.title, kind: tile.kind, tmdbId: tile.tmdbId ?? null, poster: tile.poster, year: tile.year }));
    if (!item) return;
    updateItems((prev) => [item, ...prev]);
    showToast(`Added to ${statusLabel(status)}`, { action: { label: "Undo", onClick: () => updateItems((prev) => prev.filter((i) => i.id !== item.id)) } });
  };

  // The tick on Up Next: the next episode watched, or a movie (or a show
  // with nothing left to watch) moved to Watched.
  const advance = (id) => {
    const item = findItem(id);
    if (!item) return;
    if (item.rewatch) { advanceRewatch(item); return; }
    const d = item.kind === "tv" ? cachedDetails("tv", item.tmdbId) : null;
    const n = item.kind === "tv" ? nextEpisode(item, d) : null;
    if (!n) { moveTo(id, "watched"); return; }
    const after = touch(stampWatch(item, { ...item, season: n.season, episode: n.episode, status: "watching" }));
    replace(after);
    if (isFinished(d) && !nextEpisode(after, d)) {
      showToast(`That was the last episode of “${item.title}”`, { action: { label: "Mark Watched", onClick: () => moveTo(id, "watched") } });
    }
  };

  /* ============ Rewatches ============
     A show rewatched from the start ticks through on its own counter
     (`rewatch`), each episode logged again for Activity, without moving
     your progress. It ends after the last episode out (a finished show) or
     the one you'd got to (one you're still watching). A movie watched
     again is logged at once. */
  // Where a rewatch ends; null when unknown (a show in Watched with no
  // progress and no TMDB details), so it runs until you stop it.
  const rewatchEnd = (item, d) => (item.status === "watched" && latestAired(d))
    || (progressRank(item) > 10000 ? { season: item.season, episode: item.episode } : null);
  const startRewatch = (id) => {
    const before = findItem(id);
    if (!before || before.kind !== "tv") return;
    replace(touch({ ...before, rewatch: { season: 1, episode: 0 }, lastWatched: nowIso() }));
    showToast(`Rewatching “${before.title}” from S1 · E1`, { action: { label: "Undo", onClick: () => replace(touch(before)) } });
  };
  const stopRewatch = (id) => {
    const before = findItem(id);
    if (!before?.rewatch) return;
    replace(touch({ ...before, rewatch: null }));
    showToast("Rewatch stopped", { action: { label: "Undo", onClick: () => replace(touch(before)) } });
  };
  const advanceRewatch = (item) => {
    const d = cachedDetails("tv", item.tmdbId);
    const at = { ...item, season: item.rewatch.season, episode: item.rewatch.episode };
    const n = nextEpisode(at, d);
    const end = rewatchEnd(item, d);
    const past = (e) => !e || !e.aired || (end && progressRank({ kind: "tv", ...e }) > progressRank({ kind: "tv", ...end }));
    if (past(n)) {
      replace(touch({ ...item, rewatch: null, rewatches: item.rewatches + 1 }));
      showToast(`Finished rewatching “${item.title}”`);
      return;
    }
    logWatches([{ key: watchKey(item, n.season, n.episode), at: nowIso() }], { live: true });
    const after = { ...item, rewatch: { season: n.season, episode: n.episode }, lastWatched: nowIso() };
    // That was the last one: the rewatch is done.
    if (past(nextEpisode({ ...after, season: n.season, episode: n.episode }, d))) {
      replace(touch({ ...after, rewatch: null, rewatches: item.rewatches + 1 }));
      showToast(`Finished rewatching “${item.title}”`);
      return;
    }
    replace(touch(after));
  };
  const watchedAgain = (id) => {
    const before = findItem(id);
    if (!before) return;
    const at = nowIso();
    logWatches([{ key: watchKey(before), at }]);
    replace(touch({ ...before, rewatches: before.rewatches + 1, lastWatched: at }));
    showToast(`Logged another watch of “${before.title}”`, { action: { label: "Undo", onClick: () => { unlogWatch(watchKey(before), at); replace(touch(before)); } } });
  };

  const saveItem = (draft) => {
    const before = findItem(draft.id);
    const item = normaliseItem(touch(stampWatch(before, draft)));
    if (!item) return;
    if (before) { replace(item); return; }
    updateItems((prev) => [item, ...prev]);
    showToast(`Added to ${statusLabel(item.status)}`);
  };

  // Undo puts things back with a fresh edit time, so on other devices the
  // restore wins over the change it undoes.
  const deleteItem = (id) => {
    const index = itemsRef.current.findIndex((i) => i.id === id);
    if (index === -1) return;
    const gone = itemsRef.current[index];
    updateItems((prev) => prev.filter((i) => i.id !== id));
    showToast(`Deleted “${gone.title}”`, {
      action: { label: "Undo", onClick: () => updateItems((prev) => { const n = [...prev]; n.splice(Math.min(index, n.length), 0, touch(gone)); return n; }) },
    });
  };

  const applyQuick = (id) => {
    const before = itemsRef.current.find((i) => i.id === id);
    const q = before && quickAction(before);
    if (!q) return;
    const after = touch(stampWatch(before, { ...before, ...q.patch }));
    replace(after);
    if (after.status !== before.status) {
      showToast(`Moved to ${statusLabel(after.status)}`, { action: { label: "Undo", onClick: () => replace(touch(before)) } });
    }
  };

  // Puts back the titles in `before` (a Map of id → item as it was), with
  // a fresh edit time so the restore wins on other devices too.
  const restore = (before) => updateItems((prev) => prev.map((i) => (before.has(i.id) ? touch(before.get(i.id)) : i)));

  // Several titles to one list at once (the "…" menu on a Watching
  // section), with Undo.
  const moveMany = (ids, status) => {
    const want = new Set(ids);
    const before = new Map();
    updateItems((prev) => prev.map((i) => {
      if (!want.has(i.id) || i.status === status) return i;
      before.set(i.id, i);
      // A bulk move isn't a watch for the Activity history.
      return touch(stampWatch(i, { ...i, status }, { log: false }));
    }));
    if (before.size) showToast(`Moved ${plural(before.size, "title")} to ${statusLabel(status)}`, { action: { label: "Undo", onClick: () => restore(before) } });
  };

  // "I'm caught up": each show's progress jumps to the latest episode out
  // (per TMDB); a show that has ended goes to Watched. Shows already there
  // or further along are left alone, as are ones TMDB hasn't details for.
  const catchUp = async (ids, { quiet = false } = {}) => {
    const shows = ids.map(findItem).filter((i) => i && i.kind === "tv");
    const linked = shows.filter((i) => i.tmdbId);
    if (!linked.length) {
      if (!quiet) showToast(!shows.length ? "Only shows can be caught up" : !tmdbKey ? "Add a TMDB key in Settings first" : "Link it to TMDB first: Edit Details, then pick it from the search");
      return;
    }
    if (!quiet && linked.length > 4) showToast(`Checking ${plural(linked.length, "show")} on TMDB…`);
    const details = await fetchDetailsFor(linked, tmdbKey);
    const wanted = new Set(linked.map((i) => i.id));
    const before = new Map();
    let finished = 0;
    const now = nowIso();
    updateItems((prev) => prev.map((i) => {
      const at = latestAired(details.get(i.id));
      if (!at || !wanted.has(i.id)) return i;
      const ended = isFinished(details.get(i.id));
      const ahead = progressRank(i) >= progressRank({ kind: "tv", ...at });
      // Nothing to do: already there, and either still running or already
      // in Watched.
      if (ahead && (!ended || i.status === "watched")) return i;
      before.set(i.id, i);
      if (ended) finished++;
      const p = ahead ? {} : { season: at.season, episode: at.episode };
      return normaliseItem(touch({ ...i, ...p, status: ended || i.status === "watched" ? "watched" : "watching", lastWatched: now })) || i;
    }));
    const n = before.size;
    if (!n) {
      if (!quiet) showToast(linked.length === 1 ? `Already caught up on “${linked[0].title}”` : details.size ? "Already caught up on all of them" : "Couldn't reach TMDB. Try again in a moment.");
      return;
    }
    const one = n === 1 && findItem([...before.keys()][0]);
    const msg = one
      ? (one.status === "watched" ? `“${one.title}” has ended: moved to Watched` : `Caught up on “${one.title}” · S${one.season} E${one.episode}`)
      : `Caught up on ${plural(n, "show")}${finished ? `; ${finished} that ended moved to Watched` : ""}`;
    showToast(msg, { action: { label: "Undo", onClick: () => restore(before) } });
  };

  // The "…" menu on a row or card: what you can do with that title.
  const itemMenu = (shown) => {
    // Up Next hands over a copy showing a rewatch's place; act on the title
    // as saved, so an edit never writes the rewatch over your progress.
    const item = findItem(shown.id) || shown;
    const tv = item.kind === "tv";
    const d = tv ? cachedDetails("tv", item.tmdbId) : null;
    const n = tv ? nextEpisode(item, d) : null;
    const latest = latestAired(d);
    const behind = !latest || progressRank(item) < progressRank({ kind: "tv", ...latest });
    showMenu({
      title: item.title,
      sub: [KINDS.find((k) => k.v === item.kind)?.l, statusLabel(item.status), progressLabel(item)].filter(Boolean).join(" · "),
      actions: [
        tv && item.rewatch && { label: "Stop Rewatching", sub: "Your progress stays where it is", icon: <XIcon size={14} />, run: () => stopRewatch(item.id) },
        tv && !item.rewatch && (item.status === "watched" || progressRank(item) > 10000) && {
          label: "Rewatch from the Start", sub: "Tick it through again in Up Next; your progress stays", icon: <PlayIcon size={18} />, run: () => startRewatch(item.id),
        },
        !tv && item.status === "watched" && {
          label: "Watched It Again", sub: item.rewatches ? `Watched ${item.rewatches + 1} times so far` : "Log another viewing, today", icon: <ForwardIcon size={18} />, run: () => watchedAgain(item.id),
        },
        tv && n?.aired && item.status !== "watched" && !item.rewatch && { label: `Mark S${n.season} · E${n.episode} watched`, icon: <CheckIcon size={18} />, run: () => advance(item.id) },
        tv && item.tmdbId && behind && { label: "I'm Caught Up", sub: latest ? `Jump to S${latest.season} · E${latest.episode}, the latest out` : "Jump to the latest episode out", icon: <ForwardIcon size={18} />, run: () => catchUp([item.id]) },
        // The title sheet's episode picker is under Your Progress, which only
        // a show on the go has; for the others, the edit sheet has it.
        tv && { label: "Choose Episode…", sub: "Pick the season and episode you're on", icon: <TvIcon size={18} />, run: () => (item.status === "watching" ? openItem(item) : setEditing(item)) },
        item.status !== "watched" && { label: tv ? "Finished It" : "Mark as Watched", sub: "Move to Watched", icon: <CheckCircleIcon size={18} />, run: () => moveTo(item.id, "watched") },
        item.status !== "watching" && { label: "Move to Watching", icon: <PlayIcon size={18} />, run: () => moveTo(item.id, "watching") },
        item.status !== "watchlist" && { label: "Move to Watchlist", sub: "For later", icon: <BookmarkIcon size={18} />, run: () => moveTo(item.id, "watchlist") },
        { label: "Edit Details", icon: <PencilIcon size={18} />, run: () => setEditing(item) },
        { label: "Remove from Library", danger: true, icon: <TrashIcon size={18} />, run: () => deleteItem(item.id) },
      ],
    });
  };

  // The "…" menu on a Watching section: the same for all its titles.
  const bulkMenu = (group, ids) => {
    const shows = ids.map(findItem).filter((i) => i?.kind === "tv" && i.tmdbId).length;
    const n = plural(ids.length, "title");
    const confirmThen = (title, body, fn) => async () => {
      if (await askConfirm({ title, body: `${body} You can undo straight after.`, confirmLabel: "Go Ahead" })) fn();
    };
    showMenu({
      title: GROUP_NAMES[group],
      sub: n,
      actions: [
        group !== "caughtup" && shows > 0 && {
          label: "Mark All Caught Up", sub: "Each show to its latest episode out; ones that have ended go to Watched", icon: <ForwardIcon size={18} />,
          run: confirmThen(`Mark ${plural(shows, "show")} caught up?`, "Each one jumps to the latest episode out, and shows that have ended move to Watched.", () => catchUp(ids)),
        },
        { label: "Move All to Watched", icon: <CheckCircleIcon size={18} />, run: confirmThen(`Move ${n} to Watched?`, "They'll leave Watching.", () => moveMany(ids, "watched")) },
        { label: "Move All to Watchlist", icon: <BookmarkIcon size={18} />, run: confirmThen(`Move ${n} to your Watchlist?`, "They'll leave Watching.", () => moveMany(ids, "watchlist")) },
      ],
    });
  };

  const replaceAll = (list, message) => {
    const prev = itemsRef.current;
    updateItems(() => list);
    showToast(message, { action: { label: "Undo", onClick: () => updateItems(() => prev.map(touch)) } });
  };

  // CSV and Trakt imports: merged in with Undo, then titles without TMDB details are
  // matched there in the background. A match for a title already in the
  // library under another name is left out rather than make a duplicate.
  // Shows the file said you're up to date with are caught up once they're
  // linked (catchUp needs TMDB's episode list), after the other toasts.
  const importPlan = (plan) => {
    const n = plan.added + plan.updated;
    const logged = plan.watchLog?.length ? logWatches(plan.watchLog) : 0;
    // A file read again may change nothing itself, only start matching or
    // fill in the Activity history.
    // Plans are made from shows and movies only: keep the books as they are now.
    if (n) replaceAll([...plan.items.filter((i) => !isBook(i)), ...itemsRef.current.filter(isBook)], `Imported ${plural(n, "title")}`);
    else if (plan.toLink.length && tmdbKey) showToast(`Matching ${plural(plan.toLink.length, "title")} on TMDB…`);
    else if (plan.caughtUp.length && tmdbKey) showToast("Catching up shows…");
    else if (logged) showToast(`Added ${logged.toLocaleString("en-GB")} watch${logged === 1 ? "" : "es"} to Activity`);
    const started = Date.now();
    const later = (fn) => setTimeout(fn, Math.max(0, 6500 - (Date.now() - started)));
    const thenCatchUp = () => { if (tmdbKey && plan.caughtUp.length) later(() => catchUp(plan.caughtUp, { quiet: true })); };
    if (!tmdbKey || !plan.toLink.length) { thenCatchUp(); return; }
    linkWithTmdb(plan.toLink, tmdbKey, (batch) => updateItems((prev) => {
      const have = new Set(prev.filter((i) => i.tmdbId).map((i) => `${i.kind}:${i.tmdbId}`));
      return prev.map((i) => {
        const p = batch.get(i.id);
        if (!p || (!i.tmdbId && have.has(`${p.kind}:${p.tmdbId}`))) return i;
        return normaliseItem(touch({ ...i, ...p })) || i;
      });
    })).then((n) => {
      // After the Undo toast has had its time.
      later(() => showToast(`Matched ${n} of ${plural(plan.toLink.length, "title")} on TMDB`));
      if (plan.caughtUp.length) setTimeout(thenCatchUp, 2400);
    });
  };

  // Pull to refresh: sync with your account, and fetch afresh from TMDB
  // what's on screen and what you're watching.
  const refresh = async () => {
    const watchingNow = itemsRef.current.filter((i) => i.status === "watching" && !isBook(i));
    const [tmdb, ani] = await Promise.allSettled([refreshTmdb(tmdbKey, watchingNow), refreshAnilist(), userId ? sync.syncNow() : null]);
    const failed = [tmdb, ani].find((r) => r.status === "rejected");
    if (failed) showToast(failed.reason?.message || "Couldn't refresh");
  };

  const counts = useMemo(() => ({
    watching: media.filter((i) => i.status === "watching").length,
    books: books.filter((i) => i.status === "watching").length,
  }), [media, books]);

  const isNew = editing && !items.some((i) => i.id === editing.id);
  const openSettings = () => setSettingsOpen(true);

  // Each screen is keyed, so it rises in afresh when you switch.
  let screen;
  if (list) {
    screen = (
      <ListView key={`list-${list}`} status={list} items={media} filter={filter} setFilter={setFilter}
        onOpen={openItem} onQuick={applyQuick} onMore={itemMenu} onAdd={() => setEditing(blankItem(list))}
        back={{ label: TABS.find((t) => t.v === tab)?.l, onClick: () => setList(null) }} />
    );
  } else if (tab === "explore") {
    screen = (
      <ExploreView key="explore" items={media} tmdbKey={tmdbKey} kind={explore} setKind={setExplore}
        query={query} setQuery={setQuery} onOpen={openTile} onAdd={(t) => addTitle(t, "watchlist")} onSettings={openSettings} />
    );
  } else if (tab === "books") {
    screen = (
      <BooksView key="books" books={books} onOpen={openBook} onAdd={addBook} onAddByHand={addBookByHand}
        onMove={moveTo} onMore={bookMenu} onImport={() => setBookImportOpen(true)} />
    );
  } else if (tab === "profile") {
    screen = (
      <ProfileView key="profile" items={media} tmdbKey={tmdbKey} session={session} sync={sync} avatar={avatar} setAvatar={setAvatar}
        username={username} onEditProfile={() => setProfileOpen(true)} onOpenList={setList} onSettings={openSettings} onImportCsv={() => setCsvOpen(true)} onOpenItem={openItem} />
    );
  } else {
    screen = (
      <WatchingView key="watching" items={media} tmdbKey={tmdbKey} onOpenItem={openItem} onOpenTile={openTile}
        onAdvance={advance} onSeeAll={setList} onExplore={() => go("explore")} onMore={itemMenu} onBulk={bulkMenu} onSettings={openSettings} />
    );
  }

  return (
    <div>
      {/* Profile has its own way into Settings, and nothing to add to. */}
      <Header />

      <PullToRefresh onRefresh={refresh}>
        <div className="tvt-screen" style={{ "--enter-x": `${enterFrom * 28}px` }}>{screen}</div>
      </PullToRefresh>

      <Taskbar tab={tab} onTab={go} counts={counts} />

      {detail && (
        <TitleSheet
          target={detail}
          items={media}
          tmdbKey={tmdbKey}
          region={region}
          onStatus={(t, status) => {
            const item = findInLibrary(itemsRef.current, t);
            if (item) moveTo(item.id, status);
            else addTitle(t, status);
          }}
          onAdvance={advance}
          onPatch={patchItem}
          onCatchUp={(id) => catchUp([id])}
          onEdit={setEditing}
          onDelete={deleteItem}
          onClose={() => setDetail(null)}
        />
      )}
      {editing && (
        <ItemSheet
          item={editing}
          isNew={isNew}
          tmdbKey={tmdbKey}
          onSave={saveItem}
          onDelete={deleteItem}
          onClose={() => setEditing(null)}
        />
      )}
      {settingsOpen && (
        <SettingsSheet
          theme={theme}
          setTheme={setTheme}
          tmdbKey={tmdbKey}
          setTmdbKey={setTmdbKey}
          region={region}
          setRegion={setRegion}
          avatar={avatar}
          username={username}
          onEditProfile={() => setProfileOpen(true)}
          session={session}
          sync={sync}
          items={items}
          media={media}
          getItems={() => itemsRef.current.filter((i) => !isBook(i))}
          // Restored titles count as edited now, so they win over newer
          // versions elsewhere: the backup is what you asked for.
          onImport={(list) => replaceAll(list.map(touch), `Imported ${plural(list.length, "title")}`)}
          onImportCsv={() => setCsvOpen(true)}
          onImportPlan={importPlan}
          onErase={() => replaceAll([], "Everything erased")}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {book && (
        <BookSheet target={book} books={books} onAdd={addBook} onStatus={moveTo} onPatch={patchItem} onDelete={deleteItem} onClose={() => setBook(null)} />
      )}
      {bookImportOpen && <BookImportSheet books={books} onImport={importBooks} onClose={() => setBookImportOpen(false)} />}
      {csvOpen && <CsvImportSheet items={media} tmdbKey={tmdbKey} onImport={importPlan} onClose={() => setCsvOpen(false)} />}
      {profileOpen && (
        <ProfileSheet username={username} setUsername={setUsername} avatar={avatar} setAvatar={setAvatar}
          email={session?.user?.email} signedIn={!!session} onClose={() => setProfileOpen(false)} />
      )}

      <MenuHost />
      <ToastHost />
      <ConfirmHost />
    </div>
  );
}

/* ============ Header ============
   The app's name and logo, the same on every tab. No buttons: titles are
   added from Explore's search, and Settings lives on Profile. */
function Header() {
  // The hairline under the header only shows once the page has scrolled.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={"tvt-header" + (scrolled ? " is-scrolled" : "")}>
      <div className="tvt-header-inner">
        <img src="icon.svg" alt="" width="30" height="30" style={{ display: "block", borderRadius: 8, flexShrink: 0 }} />
        <h1 className="tvt-wordmark">{APP_NAME}</h1>
      </div>
    </header>
  );
}

/* ============ List screen ============
   One status's titles (Profile → Library, or See All), pushed over the
   tab with a back button: filter by kind, search, and a dropdown to sort. */
const SORTS = [
  { v: "recent", l: "Recently Changed", short: "Recent" },
  { v: "title", l: "Title A–Z", short: "A–Z" },
  { v: "rating", l: "Your Rating", short: "Rating" },
  { v: "year", l: "Year, Newest First", short: "Year" },
];
const foldText = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function ListView({ status, items, filter, setFilter, onOpen, onQuick, onMore, onAdd, back }) {
  const meta = STATUSES.find((s) => s.v === status);
  const inStatus = items.filter((i) => i.status === status);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  // Most recently touched first, but the order is fixed while you're on
  // the screen, so a row you tap +1 on doesn't jump to the top under your
  // finger. Titles added meanwhile go on top.
  const orderRef = useRef(null);
  const recent = (list) => [...list].sort((a, b) => b.updated.localeCompare(a.updated)).map((i) => i.id);
  // A sync or an import that lands a batch while you're here (the first
  // sign-in on a device, say) sets the order afresh rather than leave the
  // new ones in no order at the top.
  if (!orderRef.current || inStatus.filter((i) => !orderRef.current.includes(i.id)).length > 3) orderRef.current = recent(inStatus);
  const rank = (id) => orderRef.current.indexOf(id);
  const by = {
    recent: (a, b) => rank(a.id) - rank(b.id),
    title: (a, b) => a.title.localeCompare(b.title, "en-GB", { sensitivity: "base" }),
    rating: (a, b) => b.rating - a.rating || rank(a.id) - rank(b.id),
    year: (a, b) => (b.year || "0").localeCompare(a.year || "0") || rank(a.id) - rank(b.id),
  }[sort];
  const q = foldText(query.trim());
  const ofKind = inStatus.filter((i) => filter === "all" || i.kind === filter);
  const shown = ofKind.filter((i) => !q || foldText(i.title).includes(q)).sort(by);

  // A one-tap move to another tab folds the row shut first.
  const [isLeaving, foldAway] = useFoldAway(onQuick);
  const quick = (item, qa) => (qa.patch.status && qa.patch.status !== item.status ? foldAway(item.id) : onQuick(item.id));

  return (
    <main className="tvt-view tvt-push tvt-page" style={{ padding: "8px var(--pad-r) calc(120px + var(--safe-bottom)) var(--pad-l)" }}>
      <ScreenTitle title={meta.l} detail={plural(shown.length, "title")} back={back} />
      {inStatus.length > 6 && <SearchField value={query} onChange={setQuery} placeholder={`Search ${meta.l}`} />}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SegToggle full options={FILTERS} value={filter} onChange={setFilter} label="Filter" />
        </div>
        <SortPicker value={sort} onChange={setSort} />
      </div>
      {shown.length ? (
        // The rows rise in one by one, so the list itself doesn't; keyed
        // by filter and sort, so they cascade in again when either changes.
        <div key={filter + sort} style={{ animation: "none" }}>
          <LongList items={shown} leaving={isLeaving} step={30} render={(item) => <ItemRow item={item} onOpen={onOpen} onQuick={quick} onMore={onMore} />} />
        </div>
      ) : q && ofKind.length ? (
        <div style={{ fontSize: 13.5, color: "var(--ink-dim)", padding: "6px 4px 20px" }}>Nothing in {meta.l} matches “{query.trim()}”.</div>
      ) : (
        <EmptyState meta={meta} filter={filter} onAdd={onAdd} />
      )}
    </main>
  );
}

/* A small pill with the sort order and a chevron; the real <select> lies
   invisibly on top, so a tap opens the iPhone's picker. */
function SortPicker({ value, onChange }) {
  const cur = SORTS.find((o) => o.v === value) || SORTS[0];
  return (
    <div className="tvt-picker" style={{
      position: "relative", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 11px 0 12px",
      borderRadius: 10, background: "var(--fill)", color: "var(--ink)", fontSize: 13, fontWeight: 600,
    }}>
      <span key={cur.v} className="tvt-pop">{cur.short}</span>
      <span aria-hidden style={{ display: "inline-flex", color: "var(--ink-dim)" }}><ChevronIcon dir="down" size={12} /></span>
      <select aria-label="Sort by" value={value} onChange={(e) => onChange(e.target.value)} style={{
        position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, fontSize: 16, cursor: "pointer", appearance: "none", WebkitAppearance: "none",
      }}>
        {SORTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

function ItemRow({ item, onOpen, onQuick, onMore }) {
  const q = quickAction(item);
  const progress = progressLabel(item);
  const press = useLongPress(onMore ? () => onMore(item) : null);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 18,
      padding: "10px 8px 10px 10px",
    }}>
      <button type="button" className="tvt-wide-btn tvt-hold" ref={press.ref} onClick={press.guard(() => onOpen(item))} style={{
        flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12,
        background: "transparent", border: "none", padding: 0, margin: 0,
        textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit",
      }}>
        <Poster item={item} />
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "var(--ink-dim)" }}>
            <KindChip kind={item.kind} anime={item.tmdbId && cachedDetails(item.kind, item.tmdbId)?.anime} />
            {item.year && !progress && <span className="mono">{item.year}</span>}
            {/* Keyed by its text, so it pops each time an episode is ticked. */}
            {progress && <span key={progress} className="mono tvt-pop">{progress}</span>}
            <Stars value={item.rating} />
          </span>
        </span>
      </button>
      {q && (
        <button type="button" onClick={() => onQuick(item, q)} style={{
          ...(q.accent ? accentBtn() : ghostBtn()),
          padding: "8px 13px", minHeight: 36, borderRadius: 999, fontSize: 13, fontWeight: 600, flexShrink: 0,
        }}>{q.label}</button>
      )}
      {onMore && <MoreButton onClick={() => onMore(item)} label={`${item.title} options`} size={34} style={{ background: "transparent", marginRight: -4 }} />}
    </div>
  );
}

/* A hue (0–359) from a title, so its stand-in artwork keeps its colour. */
function titleHue(title) {
  let h = 0;
  for (const ch of title.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

/* The TMDB poster, fading in over a stand-in (initials on a gradient whose
   hue comes from the title), which is all that shows when there's no
   poster or it can't load (offline). The stripe is the kind's colour.
   `item` is anything with a title, kind and poster (an item or a tile). */
function Poster({ item, size = 46, ratio = 1.4, radius = 10, stripe = true }) {
  const hue = useMemo(() => titleHue(item.title), [item.title]);
  const [failed, setFailed] = useState("");
  // A TMDB poster, else a cover by URL (a card from AniList).
  const src = item.poster ? posterUrl(item.poster, size > 150 ? "w500" : size > 60 ? "w342" : "w185") : item.img || "";
  const words = item.title.replace(/^(the|a|an)\s+/i, "").split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((w) => Array.from(w)[0]).join("").toUpperCase();
  return (
    <span aria-hidden style={{
      width: size, height: Math.round(size * ratio), borderRadius: radius, flexShrink: 0,
      position: "relative", overflow: "hidden",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: `linear-gradient(160deg, oklch(64% 0.13 ${hue}), oklch(36% 0.09 ${hue + 40}))`,
      color: "rgba(255,255,255,0.94)", fontWeight: 700, fontSize: Math.round(size * 0.36), letterSpacing: "-0.02em",
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
    }}>
      {initials || "?"}
      {src && src !== failed && (
        <img key={src} src={src} alt="" loading="lazy" onLoad={(e) => { e.currentTarget.style.opacity = 1; }} onError={() => setFailed(src)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0, transition: "opacity 0.35s ease" }} />
      )}
      {stripe && <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: item.kind === "tv" ? "var(--tv)" : "var(--movie)" }} />}
    </span>
  );
}

/* Show or Movie, or Anime for one TMDB or AniList says is anime (with
   "Movie" beside it for an anime film). */
function KindChip({ kind, anime }) {
  const c = anime ? "var(--anime)" : kind === "tv" ? "var(--tv)" : "var(--movie)";
  const label = anime ? (kind === "movie" ? "Anime Movie" : "Anime") : KINDS.find((k) => k.v === kind)?.l;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 999, color: c, background: `color-mix(in oklab, ${c} 16%, transparent)`, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function Stars({ value, size = 12 }) {
  if (!value) return null;
  return (
    <span role="img" aria-label={`${fmtRating(value)} of 5 stars`} style={{ display: "inline-flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const lit = n <= value, half = !lit && n - 0.5 <= value;
        return (
          <span key={n} style={{ display: "inline-flex", color: lit || half ? "var(--star)" : "var(--ink-faint)", opacity: lit || half ? 1 : 0.4 }}>
            <StarIcon size={size} filled={lit} half={half} />
          </span>
        );
      })}
    </span>
  );
}

function EmptyState({ meta, filter, onAdd }) {
  const Icon = meta.icon;
  const what = filter === "tv" ? "shows" : filter === "movie" ? "movies" : "titles";
  return (
    <Card style={{ textAlign: "center", padding: "32px 20px" }}>
      <span className="tvt-pop" style={{ width: 56, height: 56, borderRadius: 999, background: "var(--fill)", color: "var(--ink-dim)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12, animationDelay: "0.2s" }}>
        <Icon size={26} />
      </span>
      <div style={{ fontSize: 16, fontWeight: 600 }}>No {what} here yet</div>
      <div style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.5, margin: "6px auto 16px", maxWidth: 300 }}>{meta.empty}</div>
      <button type="button" onClick={onAdd} style={accentBtn()}>Add a title</button>
    </Card>
  );
}

/* ============ Add / edit sheet ============ */
function ItemSheet({ item, isNew: isNewProp, tmdbKey, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(item);
  // Fixed at open: once added the item exists, but the sheet shouldn't
  // turn into "Edit" while it slides away.
  const [isNew] = useState(isNewProp);
  const { ref, closing, close } = useModalDismiss(onClose);
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  // Typing in the title searches TMDB; picking a match stops it.
  const [searching, setSearching] = useState(false);
  const search = useTmdbSearch(draft.title, tmdbKey, searching);
  const pickMatch = (m) => {
    setDraft((d) => ({ ...d, title: m.title, kind: m.kind, tmdbId: m.tmdbId, poster: m.poster, year: m.year }));
    setSearching(false);
  };
  const unlink = () => setDraft((d) => ({ ...d, tmdbId: null, poster: "", year: "" }));
  const hint = { fontSize: 12.5, color: "var(--ink-faint)", marginTop: 8, lineHeight: 1.4 };
  const canSave = draft.title.trim().length > 0;
  const save = (e) => {
    e.preventDefault();
    if (!canSave || closing) return;
    onSave(draft);
    close();
  };
  return (
    <ModalFrame sheet dismiss={{ ref, closing, close }} label={isNew ? "Add a title" : `Edit ${item.title}`}>
      <form onSubmit={save}>
        <ModalHead eyebrow={isNew ? "New" : "Edit"} title={draft.title.trim() || "Add a title"} onClose={close}
          lead={draft.poster ? <Poster key={draft.poster} item={draft} size={40} /> : null} />
        <Field label="Title" htmlFor="tvt-title">
          <input id="tvt-title" value={draft.title} onChange={(e) => { set("title", e.target.value); setSearching(true); }}
            placeholder={tmdbKey ? "Search shows and movies" : "e.g. Severance"} autoComplete="off" autoCapitalize="words"
            enterKeyHint="done" maxLength={200} style={fieldStyle()} />
          {searching && tmdbKey && draft.title.trim().length >= 2 && <SearchResults state={search} onPick={pickMatch} />}
          {!searching && draft.tmdbId && (
            <div className="tvt-pop" style={{ ...hint, display: "flex", gap: 8 }}>
              <span>From TMDB{draft.year && ` · ${draft.year}`}</span>
              <button type="button" onClick={unlink} style={{ background: "none", border: "none", padding: 0, color: "var(--ink-dim)", fontSize: 12.5, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>Unlink</button>
            </div>
          )}
          {!tmdbKey && isNew && <div style={hint}>Add a TMDB key in Settings to search titles and get posters.</div>}
        </Field>
        <Field label="Type">
          <SegToggle full options={KINDS} value={draft.kind} onChange={(v) => set("kind", v)} label="Type" />
        </Field>
        <Field label="Status">
          <SegToggle full options={STATUSES} value={draft.status} onChange={(v) => set("status", v)} label="Status" />
        </Field>
        <Collapse open={draft.kind === "tv"}>
          <Field label="Last episode watched">
            <EpisodePicker season={draft.season} episode={draft.episode} d={draft.tmdbId ? cachedDetails("tv", draft.tmdbId) : null}
              onChange={(p) => setDraft((d) => ({ ...d, ...p }))} />
          </Field>
        </Collapse>
        <Field label="Rating">
          <RatingInput value={draft.rating} onChange={(v) => set("rating", v)} />
        </Field>
        <Field label="Note" htmlFor="tvt-note">
          <textarea id="tvt-note" rows={2} value={draft.note} onChange={(e) => set("note", e.target.value)}
            placeholder="Where it's streaming, who recommended it…" maxLength={2000}
            style={{ ...fieldStyle(), resize: "vertical", lineHeight: 1.4, display: "block" }} />
        </Field>
        <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center" }}>
          {!isNew && (
            <button type="button" onClick={() => { onDelete(item.id); close(); }} style={{ ...ghostBtn(), color: "var(--danger)" }}>Delete</button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={close} style={ghostBtn()}>Cancel</button>
          <button type="submit" disabled={!canSave} style={{ ...accentBtn(), opacity: canSave ? 1 : 0.4, cursor: canSave ? "pointer" : "default" }}>{isNew ? "Add" : "Save"}</button>
        </div>
      </form>
    </ModalFrame>
  );
}

/* A caption over a control. Pass htmlFor only for a text field: a <label>
   wrapping buttons would forward every tap to the first one. */
function Field({ label, htmlFor, children }) {
  const Tag = htmlFor ? "label" : "div";
  return (
    <div style={{ marginBottom: 14 }}>
      <Tag htmlFor={htmlFor} className="label" style={{ display: "block", marginBottom: 6 }}>{label}</Tag>
      {children}
    </div>
  );
}

/* Five big stars across the width, in half steps: tap a star's left half
   for a half star, its right half for a whole one, or slide along the
   row. Tapping the rating you have clears it. A slider to assistive tech
   (arrow keys step by a half). The lit stars pop in a ripple once the
   rating is set. */
function RatingInput({ value, onChange }) {
  const rowRef = useRef(null);
  const press = useRef(null);
  const [preview, setPreview] = useState(null); // under the finger, until it lifts
  const shown = preview ?? value;
  // The half star a point along the row is over: 0.5 to 5.
  const at = (clientX) => {
    const r = rowRef.current.getBoundingClientRect();
    const f = Math.min(0.9999, Math.max(0, (clientX - r.left) / r.width));
    return (Math.floor(f * 10) + 1) / 2;
  };
  // A slide along the stars mustn't also pull the sheet down.
  useEffect(() => {
    const el = rowRef.current;
    const stop = (e) => e.stopPropagation();
    el.addEventListener("touchstart", stop, { passive: true });
    return () => el.removeEventListener("touchstart", stop);
  }, []);
  const down = (e) => {
    if (e.button > 0) return;
    press.current = { id: e.pointerId, x: e.clientX, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setPreview(at(e.clientX));
  };
  const move = (e) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (Math.abs(e.clientX - p.x) > 6) p.moved = true;
    setPreview(at(e.clientX));
  };
  const up = (e) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    setPreview(null);
    const v = at(e.clientX);
    onChange(!p.moved && v === value ? 0 : v);
  };
  // A vertical swipe that starts on the stars scrolls the page instead.
  const cancel = () => { press.current = null; setPreview(null); };
  const key = (e) => {
    const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[e.key];
    const v = step ? clampRating(value + step) : e.key === "End" ? 5 : ["Home", "Delete", "Backspace"].includes(e.key) ? 0 : null;
    if (v == null) return;
    e.preventDefault();
    if (v !== value) onChange(v);
  };
  return (
    <div>
      <div ref={rowRef} role="slider" tabIndex={0} aria-label="Rating" aria-valuemin={0} aria-valuemax={5} aria-valuenow={value}
        aria-valuetext={value ? `${fmtRating(value)} of 5 stars` : "Not rated"}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onKeyDown={key}
        className="tvt-rating">
        {[1, 2, 3, 4, 5].map((n) => {
          const lit = n <= shown, half = !lit && n - 0.5 <= shown, on = lit || half;
          return (
            <span key={n} style={{ display: "flex", justifyContent: "center", color: on ? "var(--star)" : "var(--ink-faint)" }}>
              <span key={on ? `on${shown}` : "off"} className={on && preview == null ? "tvt-check-pop" : undefined}
                style={{ display: "inline-flex", animationDelay: `${(n - 1) * 40}ms`, animationFillMode: "backwards", opacity: on ? 1 : 0.45 }}>
                <StarIcon size={42} filled={lit} half={half} />
              </span>
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36, marginTop: 8 }}>
        {shown ? (
          <span style={{ flex: 1, display: "flex", alignItems: "baseline", gap: 6 }}>
            <span key={shown} className="mono tvt-pop" style={{ fontSize: 20, fontWeight: 700 }}>{fmtRating(shown)}</span>
            <span style={{ fontSize: 13.5, color: "var(--ink-dim)" }}>out of 5</span>
          </span>
        ) : (
          <span style={{ flex: 1, fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.4 }}>Tap or slide to rate. A star's left side gives a half.</span>
        )}
        {value > 0 && <button type="button" onClick={() => onChange(0)} style={{ ...ghostBtn(), padding: "7px 14px", borderRadius: 999 }}>Clear</button>}
      </div>
    </div>
  );
}

/* ============ Settings ============ */
function SettingsSheet({ theme, setTheme, tmdbKey, setTmdbKey, region, setRegion, avatar, username, onEditProfile, session, sync, items, media, getItems, onImport, onImportCsv, onImportPlan, onErase, onClose }) {
  const { ref, closing, close } = useModalDismiss(onClose);
  const fileRef = useRef(null);
  const [testing, setTesting] = useState(false);
  const signedIn = !!session;
  const note = { fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5, marginBottom: 10 };

  const testKey = () => {
    setTesting(true);
    testTmdbKey(tmdbKey)
      .then(() => showToast("TMDB key works"))
      .catch((e) => showToast(e.message))
      .finally(() => setTesting(false));
  };

  const exportJson = async () => {
    const name = `nostalgiaa-${new Date().toISOString().slice(0, 10)}.json`;
    const data = JSON.stringify({ app: "nostalgiaa", v: 1, exported: nowIso(), items }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    // On iPhone the share sheet (Save to Files, AirDrop, Mail) is the
    // reliable way to get a file out of a Home Screen app.
    try {
      const file = new File([blob], name, { type: "application/json" });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (err) {
      if (err?.name === "AbortError") return; // closed the share sheet
    }
    downloadBlob(blob, name);
    showToast("Backup downloaded");
  };

  const importJson = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still fires
    if (!file) return;
    let list;
    try {
      const parsed = JSON.parse(await file.text());
      const raw = Array.isArray(parsed) ? parsed : parsed?.items;
      if (!Array.isArray(raw)) throw new Error("no items");
      list = cleanList(raw);
    } catch {
      showToast("That file isn't a Nostalgiaa backup");
      return;
    }
    const ok = await askConfirm({
      title: `Replace your list with ${plural(list.length, "title")}?`,
      body: `Your current ${plural(items.length, "title")} will be swapped for the backup's. You can undo straight after.`,
      confirmLabel: "Replace",
      danger: true,
    });
    if (ok) { onImport(list); close(); }
  };

  const erase = async () => {
    const ok = await askConfirm({
      title: "Erase everything?",
      body: `All ${plural(items.length, "title")} will be removed from this device${signedIn ? " and your account" : ""}. You can undo straight after.`,
      confirmLabel: "Erase",
      danger: true,
    });
    if (ok) { onErase(); close(); }
  };

  const email = session?.user?.email || "";
  const trakt = useTraktSettings();
  const ani = useAnilistConf();
  const regionOpts = [...new Set([region, ...REGIONS])].map((c) => ({ v: c, l: `${regionName(c)} (${c})`, short: regionName(c) }));
  return (
    <ModalFrame sheet dismiss={{ ref, closing, close }} label="Settings">
      <ModalHead title="Settings" onClose={close} />

      <SettingsSection title="Appearance">
        <div style={{ padding: 10 }}>
          <SegToggle full options={THEMES} value={theme} onChange={setTheme} label="Appearance" />
        </div>
      </SettingsSection>

      <SettingsSection title="You">
        <SettingsGroup id="profile" icon={<PersonIcon size={16} />} tint="var(--accent)" title="Profile" summary={username || "No username"}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar src={avatar} name={username} email={email} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{username || "No username yet"}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 2 }}>{avatar ? "Profile picture set" : "No profile picture"}</div>
            </div>
            <button type="button" onClick={onEditProfile} style={ghostBtn()}>Edit</button>
          </div>
        </SettingsGroup>
        {cloud && (
          <SettingsGroup id="account" icon={<CloudIcon size={16} />} tint="var(--tv)" title="Account & Sync"
            summary={session === undefined ? "…" : session ? syncLabel(sync.status).split(":")[0] : "Not signed in"} defaultOpen={!session}>
            <AccountSection session={session} sync={sync} avatar={avatar} username={username} />
          </SettingsGroup>
        )}
      </SettingsSection>

      <SettingsSection title="Services">
        <SettingsGroup id="tmdb" icon={<KeyIcon size={16} />} tint="var(--ok)" title="Title Search" summary={tmdbKey ? "TMDB key added" : "No key"} defaultOpen={!tmdbKey}>
          <div style={note}>
            Paste your free TMDB API key to search titles and get posters, episode lists and Explore. Get one at{" "}
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>themoviedb.org → Settings → API</a>.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="tvt-tmdb" aria-label="TMDB API key" value={tmdbKey} onChange={(e) => setTmdbKey(e.target.value.trim())} placeholder="API key or read access token"
              autoComplete="off" autoCapitalize="off" spellCheck={false} style={{ ...fieldStyle(), flex: 1, minWidth: 0 }} />
            <button type="button" onClick={testKey} disabled={!tmdbKey || testing} style={{ ...ghostBtn(), opacity: tmdbKey ? 1 : 0.4 }}>{testing ? "Testing…" : "Test"}</button>
          </div>
        </SettingsGroup>
        <SettingsGroup id="region" icon={<PlayIcon size={15} />} tint="#ff9f0a" title="Where to Watch" summary={regionName(region)}>
          <div style={note}>
            The country whose streaming services the title sheet lists, from JustWatch (through TMDB, so it needs the TMDB key). Where JustWatch has nothing for it, the sheet shows the US.
          </div>
          <Picker label="Country" value={region} options={regionOpts} onChange={(v) => setRegion(String(v))} />
        </SettingsGroup>
        <SettingsGroup id="trakt" icon={<ActivityIcon size={16} />} tint="#ed1c24" title="Trakt" summary={trakt.token?.access ? "Connected" : trakt.id ? "Client ID added" : "Not set up"}>
          <TraktSettings items={media} onImport={(plan) => { onImportPlan(plan); close(); }} />
        </SettingsGroup>
        <SettingsGroup id="anilist" icon={<AnimeIcon size={16} />} tint="#02a9ff" title="AniList" summary={ani.user ? `@${String(ani.user).trim().replace(/^@/, "")}` : "Anime"}>
          <AnilistSettings getItems={getItems} tmdbKey={tmdbKey} onImport={(plan) => { onImportPlan(plan); close(); }} />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="Your Data">
        <SettingsGroup id="backup" icon={<ArchiveIcon size={16} />} tint="#8e8e93" title="Backup & Import" summary={plural(items.length, "title")}>
          <div style={note}>
            {signedIn
              ? "Your list syncs to your account. A backup file is still worth keeping now and then."
              : "Your list is saved on this device only. Export a copy now and then: Safari can clear a site's data."}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={exportJson} style={ghostBtn()}>Export Backup</button>
            <button type="button" onClick={() => fileRef.current?.click()} style={ghostBtn()}>Restore Backup</button>
            <button type="button" onClick={onImportCsv} style={ghostBtn()}>Import CSV</button>
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={importJson} hidden />
          </div>
          <div style={{ ...note, fontSize: 12.5, color: "var(--ink-faint)", margin: "8px 0 0" }}>
            Import CSV merges ratings, library, watched, list and episode-history exports, such as another tracker's, into your list.
          </div>
        </SettingsGroup>
        <SettingsGroup id="reset" icon={<TrashIcon size={16} />} tint="var(--danger)" title="Erase Everything">
          <div style={note}>Removes every title{signedIn ? ", here and in your account" : ""}. Your settings stay. You can undo straight after.</div>
          <button type="button" onClick={erase} disabled={!items.length} style={{ ...ghostBtn(), color: "var(--danger)", opacity: items.length ? 1 : 0.4 }}>Erase {plural(items.length, "title")}</button>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection title="About">
        <SettingsGroup id="about" icon={<img src="icon.svg" alt="" width="18" height="18" style={{ borderRadius: 5 }} />} tint="var(--accent)" title={`About ${APP_NAME}`} summary={`v${APP_VERSION}`}>
          <div style={note}>
            Track the shows and movies you're watching, want to watch and have watched, with Up Next, your watch time and activity,
            and the books you're reading, synced across your iPhone and iPad.
          </div>
          <MakerTag align="left" />
        </SettingsGroup>
        <SettingsGroup id="credits" icon={<InfoIcon size={16} />} tint="#5e5ce6" title="Credits" summary="TMDB · AniList · Open Library">
          <Credits />
        </SettingsGroup>
      </SettingsSection>

      <div style={{ textAlign: "center", marginTop: 22 }}>
        <img src="icon.svg" alt="" width="36" height="36" style={{ display: "block", margin: "0 auto 8px", borderRadius: 9 }} />
        <div className="tvt-wordmark" style={{ fontSize: 15 }}>{APP_NAME}</div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 3 }}>v{APP_VERSION} · {plural(items.length, "title")}</div>
        <div style={{ marginTop: 12 }}><MakerTag /></div>
      </div>
      {/* TMDB's terms ask apps using its API to say this where it can be seen. */}
      <div style={{ fontSize: 11, color: "var(--ink-faint)", margin: "12px auto 0", lineHeight: 1.45, textAlign: "center", maxWidth: 340 }}>
        This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming data from JustWatch. Schedules from TVmaze, under CC BY-SA 4.0. Facts from Wikidata (CC0). Anime data from AniList. Book data from Open Library.
      </div>
    </ModalFrame>
  );
}

/* The maker's tag: a small caption over a quiet pill with the name.
   `align` left sits it in a settings row; centred otherwise. */
function MakerTag({ align = "center" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "left" ? "flex-start" : "center", gap: 5 }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-faint)" }}>Crafted by</span>
      <span className="tvt-maker">
        <span aria-hidden className="tvt-maker-dot" />
        {MAKER_TAG}
      </span>
    </div>
  );
}

/* Where the app's data, services and code come from, with the notices
   and licences each one asks for. Add a row to CREDITS for anything new. */
const CREDITS = [
  {
    name: "TMDB", href: "https://www.themoviedb.org",
    what: "Titles, posters, artwork, ratings, runtimes, episode counts, recommendations and Explore.",
    terms: "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    links: [["API terms", "https://www.themoviedb.org/api-terms-of-use"]],
  },
  {
    name: "AniList", href: "https://anilist.co",
    what: "Anime: scores, ranks, studios, seasons, exact airing times, related titles, Explore's Anime shelves and search, and importing your AniList list.",
    terms: "Uses the free AniList API. Not affiliated with or endorsed by AniList.",
    links: [["API", "https://docs.anilist.co"], ["Terms", "https://anilist.co/terms"]],
  },
  {
    name: "TVmaze", href: "https://www.tvmaze.com",
    what: "Air times, episode names and synopses, and schedules on the title sheet.",
    terms: "TVmaze data is licensed under CC BY-SA 4.0.",
    links: [["Licence", "https://creativecommons.org/licenses/by-sa/4.0/"], ["API", "https://www.tvmaze.com/api"]],
  },
  {
    name: "JustWatch", href: "https://www.justwatch.com",
    what: "Where to watch each title in your country, through TMDB's streaming data.",
    terms: "Streaming data from JustWatch. JustWatch has no public API; TMDB licenses its data.",
  },
  {
    name: "Wikidata", href: "https://www.wikidata.org",
    what: "Did You Know: awards, box office and budget, what it's based on, who made it, where it was filmed and set, and its series.",
    terms: "Wikidata's data is in the public domain (CC0).",
    links: [["Licence", "https://creativecommons.org/publicdomain/zero/1.0/"], ["Query service", "https://query.wikidata.org"]],
  },
  {
    name: "Trakt", href: "https://trakt.tv",
    what: "Community ratings and watch counts, and importing your Trakt history, watchlist and ratings.",
    terms: "Uses the Trakt API with your own API app. Not endorsed by Trakt.",
    links: [["API", "https://trakt.docs.apiary.io"], ["Terms", "https://trakt.tv/terms"]],
  },
  {
    name: "Open Library", href: "https://openlibrary.org",
    what: "Books: search by title, author or ISBN, covers, page counts and descriptions.",
    terms: "Uses Open Library's free API, from the Internet Archive. Not endorsed by Open Library.",
    links: [["API", "https://openlibrary.org/developers/api"], ["Licensing", "https://openlibrary.org/developers/licensing"]],
  },
  {
    name: "Supabase", href: "https://supabase.com",
    what: "Sign-in, and syncing your list and profile between devices.",
  },
];
const OPEN_SOURCE = [
  ["React and React DOM", "MIT", "https://github.com/facebook/react"],
  ["Babel Standalone", "MIT", "https://github.com/babel/babel"],
  ["Supabase JS", "MIT", "https://github.com/supabase/supabase-js"],
  ["Geist font, by Vercel", "SIL Open Font Licence 1.1", "https://github.com/vercel/geist-font"],
];
function Credits() {
  const link = (label, href, style) => (
    <a key={href} href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none", ...style }}>{label}</a>
  );
  const rule = { borderTop: "1px solid var(--line-soft)", paddingTop: 10, marginTop: 10 };
  return (
    <div style={{ fontSize: 13, lineHeight: 1.45 }}>
      {CREDITS.map((c, i) => (
        <div key={c.name} style={i ? rule : undefined}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{link(c.name, c.href, { color: "var(--ink)" })}</div>
          <div style={{ color: "var(--ink-dim)", marginTop: 2 }}>{c.what}</div>
          {c.terms && <div style={{ color: "var(--ink-faint)", fontSize: 12.5, marginTop: 4 }}>{c.terms}</div>}
          {c.links && <div style={{ display: "flex", gap: 14, fontSize: 12.5, marginTop: 4 }}>{c.links.map(([l, h]) => link(l, h))}</div>}
        </div>
      ))}
      <div style={rule}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Open source</div>
        {OPEN_SOURCE.map(([name, licence, href]) => (
          <div key={name} style={{ display: "flex", gap: 10, alignItems: "baseline", marginTop: 4 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{link(name, href, { color: "var(--ink-dim)" })}</span>
            <span style={{ fontSize: 12, color: "var(--ink-faint)", flexShrink: 0 }}>{licence}</span>
          </div>
        ))}
        <div style={{ color: "var(--ink-faint)", fontSize: 12.5, marginTop: 6 }}>Scripts load from unpkg and the font from Google Fonts. Icons are drawn for {APP_NAME}.</div>
      </div>
    </div>
  );
}

/* Settings is laid out as iOS draws it: small headed sections, each one
   card of rows split by hairlines. */
function SettingsSection({ title, children }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <div className="tvt-settings-label">{title}</div>
      <div className="tvt-settings-card">{children}</div>
    </section>
  );
}

/* One row of Settings: a small tinted icon, its name and a summary, that
   opens (chevron down) onto its controls. Remembered. */
function SettingsGroup({ id, icon, tint, title, summary, defaultOpen = false, children }) {
  const [open, toggle] = useFold(`settings:${id}`, defaultOpen);
  return (
    <div className="tvt-settings-row">
      <button type="button" onClick={toggle} aria-expanded={open} className="tvt-wide-btn" style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", minHeight: 48, margin: 0,
        background: "none", border: "none", textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer",
      }}>
        <span aria-hidden className="tvt-settings-icon" style={{ "--tint": tint }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 500, letterSpacing: "-0.01em" }}>{title}</span>
        {summary && <span style={{ fontSize: 13.5, color: "var(--ink-faint)", maxWidth: "45%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>}
        <span aria-hidden style={{ display: "inline-flex", color: "var(--ink-faint)", opacity: 0.7, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.3s var(--ease-snappy)" }}>
          <ChevronIcon dir="down" size={13} />
        </span>
      </button>
      <Collapse open={open}>
        <div style={{ padding: "0 14px 14px 54px" }}>{children}</div>
      </Collapse>
    </div>
  );
}

/* ============ Tab bar ============ */
function Taskbar({ tab, onTab, counts }) {
  const activeIndex = TABS.findIndex((s) => s.v === tab);
  const n = TABS.length;
  return (
    <nav aria-label="Main" className="tvt-tabbar">
      <div className="tvt-dock" style={{ maxWidth: 360, margin: "0 auto", padding: "0 var(--pad-r) 12px var(--pad-l)", pointerEvents: "auto" }}>
        <div role="tablist" style={{
          // A floating capsule of frosted glass, like the iOS tab bar.
          background: "var(--surface-translucent)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid var(--glass-edge)",
          borderRadius: 30, padding: 5,
          display: "grid", gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 4,
          boxShadow: "0 16px 40px -16px rgba(0,0,0,0.6)",
          position: "relative", isolation: "isolate",
        }}>
          {/* One highlight that glides to the active tab: each column is
              (100% − padding − gaps) / n wide, so moving by its own width
              plus one gap lands it on the next tab. */}
          {activeIndex >= 0 && (
            <span aria-hidden className="tvt-tab-pill" style={{
              position: "absolute", top: 5, bottom: 5, left: 5, zIndex: -1,
              width: `calc((100% - 10px - ${(n - 1) * 4}px) / ${n})`,
              transform: `translateX(calc(${activeIndex} * (100% + 4px)))`,
              borderRadius: 25, background: "var(--fill)",
            }} />
          )}
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.v;
            const count = counts[t.v];
            return (
              <button key={t.v} type="button" role="tab" aria-selected={active} onClick={() => onTab(t.v)} style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                padding: "9px 6px 7px", border: "none", borderRadius: 25, background: "transparent",
                color: active ? "var(--accent)" : "var(--ink-dim)", cursor: "pointer", position: "relative",
                transition: "color 0.18s, var(--press)",
              }}>
                {/* Keyed by state, so the icon squashes and springs back
                    each time its tab is picked. */}
                <span key={active ? "on" : "off"} className={active ? "tvt-tab-pop" : undefined} style={{ display: "inline-flex" }}><Icon /></span>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.005em" }}>{t.l}</span>
                {count > 0 && !active && (
                  // Keyed by the count, so it pops when a title moves here.
                  <span key={count} className="mono tvt-pop" style={{
                    position: "absolute", top: 5, right: "calc(50% - 22px)",
                    fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 999,
                    background: "var(--accent)", color: "var(--accent-ink)",
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

/* mount */
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
