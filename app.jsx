/* app.jsx — data, routing, the list screens, the add/edit sheet, settings
   and the tab bar */
const { useState, useEffect, useMemo, useRef } = React;

const APP_VERSION = "1.2.0";

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
  { v: "profile", l: "Profile", icon: PersonIcon },
];
const KINDS = [
  { v: "tv", l: "Show" },
  { v: "movie", l: "Movie" },
];
const FILTERS = [
  { v: "all", l: "All" },
  { v: "tv", l: "Shows" },
  { v: "movie", l: "Movies" },
];
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
  return {
    id: typeof x.id === "string" && x.id ? x.id : newId(),
    kind: pick(x.kind, KINDS, "tv"),
    title,
    status: pick(x.status, STATUSES, "watchlist"),
    // TV progress: the last episode watched (episode 0 = season not started).
    season: clampInt(x.season ?? 1, 1, 999),
    episode: clampInt(x.episode ?? 0, 0, 9999),
    rating: clampInt(x.rating ?? 0, 0, 5),
    note: String(x.note ?? "").slice(0, 2000),
    // Filled in when the title is picked from TMDB search; empty otherwise.
    tmdbId: Number.isInteger(x.tmdbId) && x.tmdbId > 0 ? x.tmdbId : null,
    poster: typeof x.poster === "string" && /^\/[\w.-]+$/.test(x.poster) ? x.poster : "",
    year: /^\d{4}$/.test(String(x.year ?? "")) ? String(x.year) : "",
    added: typeof x.added === "string" ? x.added : now,
    updated: typeof x.updated === "string" ? x.updated : now,
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
  return { id: newId(), kind: "tv", title: "", status, season: 1, episode: 0, rating: 0, note: "", tmdbId: null, poster: "", year: "" };
}
// A fresh edit time, so this version wins when devices sync (undo uses it).
const touch = (item) => ({ ...item, updated: nowIso() });

function loadState() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch {}
  return {
    items: cleanList(s.items),
    theme: pick(s.theme, THEMES, "auto"),
    tab: pick(s.tab, TABS, "watching"),
    filter: pick(s.filter, FILTERS, "all"),
    explore: pick(s.explore, FILTERS, "all"),
    tmdbKey: typeof s.tmdbKey === "string" ? s.tmdbKey : "",
  };
}
function saveState(state) {
  // Full or blocked storage (private browsing): the app still works for
  // this visit, it just won't remember.
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, ...state })); } catch {}
}

function progressLabel(item) {
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
  const [detail, setDetail] = useState(null); // the title open in the title sheet
  const [editing, setEditing] = useState(null); // the item open in the edit sheet
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  useProfileKey(userId, tmdbKey, setTmdbKey);

  // The app is on screen: hand the loading screen over to the header logo.
  useEffect(() => { window.tvtSplashDone?.(); }, []);

  useEffect(() => { saveState({ items, theme, tab, filter, explore, tmdbKey }); }, [items, theme, tab, filter, explore, tmdbKey]);

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
    if (item) replace(touch({ ...item, ...patch }));
  };

  const moveTo = (id, status) => {
    const before = findItem(id);
    if (!before || before.status === status) return;
    replace(touch({ ...before, status }));
    showToast(`Moved to ${statusLabel(status)}`, { action: { label: "Undo", onClick: () => replace(touch(before)) } });
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
    const d = item.kind === "tv" ? cachedDetails("tv", item.tmdbId) : null;
    const n = item.kind === "tv" ? nextEpisode(item, d) : null;
    if (!n) { moveTo(id, "watched"); return; }
    const after = touch({ ...item, season: n.season, episode: n.episode, status: "watching" });
    replace(after);
    if (isFinished(d) && !nextEpisode(after, d)) {
      showToast(`That was the last episode of “${item.title}”`, { action: { label: "Mark Watched", onClick: () => moveTo(id, "watched") } });
    }
  };

  const saveItem = (draft) => {
    const exists = itemsRef.current.some((i) => i.id === draft.id);
    const item = normaliseItem(touch(draft));
    if (!item) return;
    if (exists) { replace(item); return; }
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
    const after = touch({ ...before, ...q.patch });
    replace(after);
    if (after.status !== before.status) {
      showToast(`Moved to ${statusLabel(after.status)}`, { action: { label: "Undo", onClick: () => replace(touch(before)) } });
    }
  };

  const replaceAll = (list, message) => {
    const prev = itemsRef.current;
    updateItems(() => list);
    showToast(message, { action: { label: "Undo", onClick: () => updateItems(() => prev.map(touch)) } });
  };

  const counts = useMemo(() => ({ watching: items.filter((i) => i.status === "watching").length }), [items]);

  const isNew = editing && !items.some((i) => i.id === editing.id);
  // The + button adds to the list on screen; on Watching, to Watching.
  const addStatus = list || (tab === "watching" ? "watching" : "watchlist");
  const openSettings = () => setSettingsOpen(true);

  // Each screen is keyed, so it rises in afresh when you switch.
  let screen;
  if (list) {
    screen = (
      <ListView key={`list-${list}`} status={list} items={items} filter={filter} setFilter={setFilter}
        onOpen={openItem} onQuick={applyQuick} onAdd={() => setEditing(blankItem(list))}
        back={{ label: TABS.find((t) => t.v === tab)?.l, onClick: () => setList(null) }} />
    );
  } else if (tab === "explore") {
    screen = (
      <ExploreView key="explore" items={items} tmdbKey={tmdbKey} kind={explore} setKind={setExplore}
        query={query} setQuery={setQuery} onOpen={openTile} onSettings={openSettings} />
    );
  } else if (tab === "profile") {
    screen = <ProfileView key="profile" items={items} tmdbKey={tmdbKey} session={session} sync={sync} onOpenList={setList} onSettings={openSettings} />;
  } else {
    screen = (
      <WatchingView key="watching" items={items} tmdbKey={tmdbKey} onOpenItem={openItem} onOpenTile={openTile}
        onAdvance={advance} onSeeAll={setList} onExplore={() => go("explore")} />
    );
  }

  return (
    <div>
      <Header onAdd={() => setEditing(blankItem(addStatus))} onSettings={openSettings} />

      {screen}

      <Taskbar tab={tab} onTab={go} counts={counts} />

      {detail && (
        <TitleSheet
          target={detail}
          items={items}
          tmdbKey={tmdbKey}
          onStatus={(t, status) => {
            const item = findInLibrary(itemsRef.current, t);
            if (item) moveTo(item.id, status);
            else addTitle(t, status);
          }}
          onAdvance={advance}
          onPatch={patchItem}
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
          session={session}
          sync={sync}
          items={items}
          // Restored titles count as edited now, so they win over newer
          // versions elsewhere: the backup is what you asked for.
          onImport={(list) => replaceAll(list.map(touch), `Imported ${plural(list.length, "title")}`)}
          onErase={() => replaceAll([], "Everything erased")}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <ToastHost />
      <ConfirmHost />
    </div>
  );
}

/* ============ Header ============ */
function Header({ onAdd, onSettings }) {
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
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "calc(var(--safe-top) + 12px) 16px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        {/* The splash logo and title fly onto these two (index.html). */}
        <img data-splash-target="logo" src="icon.svg" alt="" width="28" height="28" style={{ borderRadius: 8, flexShrink: 0 }} />
        <h1 data-splash-target="title" style={{ flex: 1, minWidth: 0, margin: 0, fontSize: "clamp(15px, 4.6vw, 17px)", fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>TV &amp; Movie Tracker</h1>
        <button type="button" onClick={onAdd} aria-label="Add a title" title="Add a title" style={{ ...iconBtn(), background: "var(--accent)", color: "var(--accent-ink)" }}><PlusIcon /></button>
        <button type="button" onClick={onSettings} aria-label="Settings" title="Settings" style={iconBtn()}><GearIcon /></button>
      </div>
    </header>
  );
}

/* ============ List screen ============
   One status's titles (Profile → Library, or See All), pushed over the
   tab with a back button. */
function ListView({ status, items, filter, setFilter, onOpen, onQuick, onAdd, back }) {
  const meta = STATUSES.find((s) => s.v === status);
  const inStatus = items.filter((i) => i.status === status);
  // Most recently touched first, but the order is fixed while you're on
  // the screen, so a row you tap +1 on doesn't jump to the top under your
  // finger. Titles added meanwhile go on top.
  const orderRef = useRef(null);
  if (!orderRef.current) orderRef.current = [...inStatus].sort((a, b) => b.updated.localeCompare(a.updated)).map((i) => i.id);
  const rank = (id) => orderRef.current.indexOf(id);
  const shown = inStatus
    .filter((i) => filter === "all" || i.kind === filter)
    .sort((a, b) => rank(a.id) - rank(b.id));

  // A one-tap move to another tab folds the row shut first.
  const [isLeaving, foldAway] = useFoldAway(onQuick);
  const quick = (item, q) => (q.patch.status && q.patch.status !== item.status ? foldAway(item.id) : onQuick(item.id));

  return (
    <main className="tvt-view tvt-push tvt-page" style={{ padding: "8px 16px calc(120px + var(--safe-bottom))" }}>
      <ScreenTitle title={meta.l} detail={plural(shown.length, "title")} back={back} />
      <div style={{ marginBottom: 14 }}>
        <SegToggle full options={FILTERS} value={filter} onChange={setFilter} label="Filter" />
      </div>
      {shown.length ? (
        // The rows rise in one by one, so the list itself doesn't; keyed
        // by filter, so they cascade in again when it changes.
        <div key={filter} style={{ animation: "none" }}>
          {shown.map((item, i) => (
            <AnimatedRow key={item.id} index={i} leaving={isLeaving(item.id)}>
              <ItemRow item={item} onOpen={onOpen} onQuick={quick} />
            </AnimatedRow>
          ))}
        </div>
      ) : (
        <EmptyState meta={meta} filter={filter} onAdd={onAdd} />
      )}
    </main>
  );
}

function ItemRow({ item, onOpen, onQuick }) {
  const q = quickAction(item);
  const progress = progressLabel(item);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 18,
      padding: "10px 12px 10px 10px",
    }}>
      <button type="button" className="tvt-wide-btn" onClick={() => onOpen(item)} style={{
        flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12,
        background: "transparent", border: "none", padding: 0, margin: 0,
        textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit",
      }}>
        <Poster item={item} />
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "var(--ink-dim)" }}>
            <KindChip kind={item.kind} />
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
  const src = posterUrl(item.poster, size > 150 ? "w500" : size > 60 ? "w342" : "w185");
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

function KindChip({ kind }) {
  const c = kind === "tv" ? "var(--tv)" : "var(--movie)";
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 999, color: c, background: `color-mix(in oklab, ${c} 16%, transparent)` }}>
      {KINDS.find((k) => k.v === kind)?.l}
    </span>
  );
}

function Stars({ value, size = 12 }) {
  if (!value) return null;
  return (
    <span role="img" aria-label={`${value} of 5 stars`} style={{ display: "inline-flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ display: "inline-flex", color: n <= value ? "var(--star)" : "var(--ink-faint)", opacity: n <= value ? 1 : 0.4 }}>
          <StarIcon size={size} filled={n <= value} />
        </span>
      ))}
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {/* Moving on to a new season starts it at episode 0. */}
              <Stepper label="Season" value={draft.season} min={1} max={999}
                onChange={(v) => setDraft((d) => ({ ...d, season: v, episode: v > d.season ? 0 : d.episode }))} />
              <Stepper label="Episode" value={draft.episode} min={0} max={9999} onChange={(v) => set("episode", v)} />
            </div>
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

function Stepper({ label, value, min, max, onChange }) {
  const l = label.toLowerCase();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, background: "var(--bg-2)", borderRadius: 14, padding: 6 }}>
      <button type="button" aria-label={`Previous ${l}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}
        style={{ ...iconBtn(36), opacity: value <= min ? 0.35 : 1 }}><MinusIcon size={16} /></button>
      <div style={{ textAlign: "center", minWidth: 0 }} aria-live="polite">
        <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{label}</div>
        {/* Keyed by value, so the number pops as it changes. */}
        <div key={value} className="mono tvt-pop" style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      </div>
      <button type="button" aria-label={`Next ${l}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}
        style={iconBtn(36)}><PlusIcon size={16} /></button>
    </div>
  );
}

/* Five stars: tap one to rate, tap the current rating again to clear.
   The lit stars pop in a ripple each time the rating changes. */
function RatingInput({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Rating" style={{ display: "flex", gap: 2, marginLeft: -8 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value;
        return (
          <button key={n} type="button" role="radio" aria-checked={n === value} aria-label={plural(n, "star")}
            className="tvt-star-btn" onClick={() => onChange(n === value ? 0 : n)} style={{
              width: 44, height: 44, padding: 0, border: "none", background: "transparent", cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              color: on ? "var(--star)" : "var(--ink-faint)",
            }}>
            <span key={on ? `on${value}` : "off"} className={on ? "tvt-check-pop" : undefined}
              style={{ display: "inline-flex", animationDelay: `${(n - 1) * 40}ms`, animationFillMode: "backwards", opacity: on ? 1 : 0.5 }}>
              <StarIcon size={26} filled={on} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ============ Settings ============ */
function SettingsSheet({ theme, setTheme, tmdbKey, setTmdbKey, session, sync, items, onImport, onErase, onClose }) {
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
    const name = `tv-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    const data = JSON.stringify({ app: "tv-movie-tracker", v: 1, exported: nowIso(), items }, null, 2);
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
      showToast("That file isn't a tracker backup");
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

  return (
    <ModalFrame sheet dismiss={{ ref, closing, close }} label="Settings">
      <ModalHead title="Settings" onClose={close} />
      <Field label="Appearance">
        <SegToggle full options={THEMES} value={theme} onChange={setTheme} label="Appearance" />
      </Field>
      {cloud && (
        <Field label="Account">
          <AccountSection session={session} sync={sync} />
        </Field>
      )}
      <Field label="Title search" htmlFor="tvt-tmdb">
        <div style={note}>
          Paste your free TMDB API key to search titles and get posters. Get one at{" "}
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>themoviedb.org → Settings → API</a>.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="tvt-tmdb" value={tmdbKey} onChange={(e) => setTmdbKey(e.target.value.trim())} placeholder="API key or read access token"
            autoComplete="off" autoCapitalize="off" spellCheck={false} style={{ ...fieldStyle(), flex: 1, minWidth: 0 }} />
          <button type="button" onClick={testKey} disabled={!tmdbKey || testing} style={{ ...ghostBtn(), opacity: tmdbKey ? 1 : 0.4 }}>{testing ? "Testing…" : "Test"}</button>
        </div>
      </Field>
      <Field label="Backup">
        <div style={note}>
          {signedIn
            ? "Your list syncs to your account. A backup file is still worth keeping now and then."
            : "Your list is saved on this device only. Export a copy now and then: Safari can clear a site's data."}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={exportJson} style={ghostBtn()}>Export</button>
          <button type="button" onClick={() => fileRef.current?.click()} style={ghostBtn()}>Import</button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={importJson} hidden />
        </div>
      </Field>
      <Field label="Reset">
        <button type="button" onClick={erase} disabled={!items.length} style={{ ...ghostBtn(), color: "var(--danger)", opacity: items.length ? 1 : 0.4 }}>Erase everything</button>
      </Field>
      <div className="mono" style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 4 }}>
        {plural(items.length, "title")} · v{APP_VERSION}
      </div>
      {/* TMDB's terms ask apps using its API to say this. */}
      <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 6, lineHeight: 1.4 }}>
        Search and posters from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
      </div>
    </ModalFrame>
  );
}

/* ============ Tab bar ============ */
function Taskbar({ tab, onTab, counts }) {
  const activeIndex = TABS.findIndex((s) => s.v === tab);
  const n = TABS.length;
  return (
    <nav aria-label="Main" className="tvt-tabbar">
      <div className="tvt-dock" style={{ maxWidth: 360, margin: "0 auto", padding: "0 16px 12px", pointerEvents: "auto" }}>
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
