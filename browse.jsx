/* browse.jsx — the Watching and Explore screens, and the poster cards and
   shelves (rows that scroll sideways) they're built from. */
const { useState: useStateB, useMemo: useMemoB, useRef: useRefB } = React;

const titleKey = (kind, tmdbId) => `${kind}:${tmdbId}`;
const byRecent = (list) => [...list].sort((a, b) => b.updated.localeCompare(a.updated));
const PAGE_PAD = "8px 16px calc(120px + var(--safe-bottom))";

/* Library titles by TMDB id, to badge the cards for titles you have. */
function useLibraryIndex(items) {
  return useMemoB(() => new Map(items.filter((i) => i.tmdbId).map((i) => [titleKey(i.kind, i.tmdbId), i])), [items]);
}

/* A 16:9 still filling its (positioned) parent: the TMDB backdrop, else
   the poster, over a gradient in the title's colour. */
function Backdrop({ path, poster, title, size = "w780" }) {
  const [failed, setFailed] = useStateB("");
  const src = path ? backdropUrl(path, size) : poster ? posterUrl(poster, "w342") : "";
  const hue = titleHue(title || "");
  return (
    <span aria-hidden style={{
      position: "absolute", inset: 0, overflow: "hidden",
      background: `linear-gradient(160deg, oklch(52% 0.12 ${hue}), oklch(26% 0.08 ${hue + 40}))`,
    }}>
      {src && src !== failed && (
        <img key={src} src={src} alt="" loading="lazy" decoding="async" onLoad={(e) => { e.currentTarget.style.opacity = 1; }} onError={() => setFailed(src)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0, transition: "opacity 0.4s ease" }} />
      )}
    </span>
  );
}

/* A small round badge on a card: where the title is in your library. */
function StatusBadge({ status }) {
  const meta = STATUSES.find((s) => s.v === status);
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span title={meta.l} style={{
      position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: 999,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: "var(--accent)", color: "var(--accent-ink)", boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
    }}><Icon size={16} /></span>
  );
}

/* The line under a card: rating and year, or the date for one not out yet. */
function tileMeta(t) {
  if (t.date && Date.parse(t.date) > Date.now()) return fmtDate(t.date);
  return [t.votes ? `★ ${t.vote.toFixed(1)}` : "", t.year].filter(Boolean).join(" · ");
}

/* A poster card for a shelf: tap to open the title's sheet. */
function PosterCard({ tile, sub, status, onOpen, width = 116 }) {
  return (
    <button type="button" onClick={() => onOpen(tile)} style={{
      width, flexShrink: 0, scrollSnapAlign: "start", display: "block",
      background: "none", border: "none", padding: 0, margin: 0,
      textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer",
    }}>
      <span style={{ position: "relative", display: "block", borderRadius: 12, boxShadow: "0 10px 22px -14px rgba(0,0,0,0.6)" }}>
        <Poster item={tile} size={width} ratio={1.5} radius={12} stripe={false} />
        {status && <StatusBadge status={status} />}
      </span>
      <span className="tvt-clamp-2" style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.25, marginTop: 8, letterSpacing: "-0.005em" }}>{tile.title}</span>
      <span style={{ display: "block", fontSize: 12, color: "var(--ink-dim)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {sub ?? tileMeta(tile)}
      </span>
    </button>
  );
}

function SkeletonCards({ n = 4, width = 116 }) {
  return Array.from({ length: n }, (_, i) => (
    <span key={i} style={{ width, flexShrink: 0 }}>
      <span className="tvt-skel" style={{ display: "block", width, height: Math.round(width * 1.5), borderRadius: 12 }} />
      <span className="tvt-skel" style={{ display: "block", width: width * 0.8, height: 12, borderRadius: 6, marginTop: 10 }} />
    </span>
  ));
}

/* A titled row of cards that scrolls sideways, edge to edge. */
function Shelf({ title, eyebrow, action, children }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <SectionHeader title={title} eyebrow={eyebrow} action={action} />
      <div className="tvt-shelf">{children}</div>
    </section>
  );
}

/* What's next for a title you're watching: the line to show (S2 · E6),
   a note under it, progress through what's aired, and whether the tick
   button applies (it marks the next episode, or a movie, watched). */
function upNextInfo(item, d) {
  if (item.kind !== "tv") {
    return { line: "Movie", sub: [fmtRuntime(d?.rt), item.year].filter(Boolean).join(" · "), progress: null, canTick: true, tick: "Watched" };
  }
  const n = nextEpisode(item, d);
  const aired = airedEpisodes(d);
  const watched = episodesWatched(item, d);
  const progress = aired ? Math.min(1, watched / aired) : null;
  if (!n) {
    const done = isFinished(d);
    const sub = done ? "That was the final episode" : d?.next?.date ? `Next episode ${fmtDate(d.next.date, DATE_SHORT)}` : "Waiting for new episodes";
    return { line: "All caught up", sub, progress, canTick: done, tick: "Finish" };
  }
  const line = `S${n.season} · E${n.episode}`;
  if (!n.aired) return { line, sub: n.date ? `Airs ${fmtDate(n.date, DATE_SHORT)}` : "Not out yet", progress, canTick: false };
  const left = aired - watched;
  const sub = aired
    ? (left <= 1 ? "Latest episode" : `${left} episodes to go`)
    : item.episode ? `Last watched S${item.season} · E${item.episode}` : "Not started";
  return { line, sub, progress, canTick: true, tick: "Watched" };
}

/* ============ Watching ============
   Up next from what you've been watching, most recent first: the latest
   as a big card, the rest as rows. Then your watchlist, titles like your
   recent ones, and what you've finished lately. */
function WatchingView({ items, tmdbKey, onOpenItem, onOpenTile, onAdvance, onSeeAll, onExplore }) {
  const watching = items.filter((i) => i.status === "watching");
  usePrefetchDetails(watching, tmdbKey, true);
  // Order fixed while you're here (as on the list screens), so a card you
  // tick doesn't jump under your finger. New ones go on top.
  const orderRef = useRefB(null);
  if (!orderRef.current) orderRef.current = byRecent(watching).map((i) => i.id);
  const upNext = [...watching].sort((a, b) => orderRef.current.indexOf(a.id) - orderRef.current.indexOf(b.id));
  const [hero, ...rest] = upNext;
  const watchlist = byRecent(items.filter((i) => i.status === "watchlist"));
  const watched = byRecent(items.filter((i) => i.status === "watched"));
  const seeds = byRecent(items.filter((i) => i.tmdbId && i.status !== "watchlist")).slice(0, 2);
  const lib = useLibraryIndex(items);
  // Ticking a movie (or a finished show) moves it to Watched: fold it away.
  const [isLeaving, foldAway] = useFoldAway(onAdvance);
  const tick = (item) => (item.kind === "tv" && nextEpisode(item, cachedDetails("tv", item.tmdbId)) ? onAdvance(item.id) : foldAway(item.id));

  return (
    <main className="tvt-view tvt-page" style={{ padding: PAGE_PAD }}>
      <ScreenTitle title="Watching" />
      {hero ? (
        <section style={{ marginBottom: 26 }}>
          <UpNextHero item={hero} d={cachedDetails(hero.kind, hero.tmdbId)} onOpen={onOpenItem} onTick={() => onAdvance(hero.id)} />
          {rest.map((item, i) => (
            <AnimatedRow key={item.id} index={i} leaving={isLeaving(item.id)}>
              <UpNextRow item={item} d={cachedDetails(item.kind, item.tmdbId)} onOpen={onOpenItem} onTick={() => tick(item)} />
            </AnimatedRow>
          ))}
        </section>
      ) : (
        <Card style={{ textAlign: "center", padding: "30px 20px", marginBottom: 26 }}>
          <span className="tvt-pop" style={{ width: 56, height: 56, borderRadius: 999, background: "var(--fill)", color: "var(--ink-dim)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12, animationDelay: "0.2s" }}>
            <PlayIcon size={26} />
          </span>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Nothing on the go</div>
          <div style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.5, margin: "6px auto 16px", maxWidth: 300 }}>
            {watchlist.length ? "Start something from your watchlist, or find something new." : "Find a show or movie to start, and your next episode will be waiting here."}
          </div>
          <button type="button" onClick={onExplore} style={accentBtn()}>Explore</button>
        </Card>
      )}

      {watchlist.length > 0 && (
        <Shelf title="Watchlist" action={{ label: "See All", onClick: () => onSeeAll("watchlist") }}>
          {watchlist.slice(0, 15).map((item) => (
            <PosterCard key={item.id} tile={item} onOpen={onOpenItem} sub={[item.kind === "tv" ? "Show" : "Movie", item.year].filter(Boolean).join(" · ")} />
          ))}
        </Shelf>
      )}

      {tmdbKey && seeds.map((seed) => <BecauseShelf key={seed.id} seed={seed} tmdbKey={tmdbKey} lib={lib} onOpen={onOpenTile} />)}

      {watched.length > 0 && (
        <Shelf title="Recently Watched" action={{ label: "See All", onClick: () => onSeeAll("watched") }}>
          {watched.slice(0, 15).map((item) => (
            <PosterCard key={item.id} tile={item} onOpen={onOpenItem} sub={item.rating ? starText(item.rating) : item.year || (item.kind === "tv" ? "Show" : "Movie")} />
          ))}
        </Shelf>
      )}
    </main>
  );
}

/* The title you watched most recently, big: its artwork, what's next and a
   button to tick it off. The tick sits beside the card's own button
   (buttons can't nest), over its corner. */
function UpNextHero({ item, d, onOpen, onTick }) {
  const info = upNextInfo(item, d);
  return (
    <div style={{ position: "relative", marginBottom: 10 }}>
      <button type="button" className="tvt-wide-btn" onClick={() => onOpen(item)} style={{
        position: "relative", display: "block", width: "100%", aspectRatio: "16 / 10", borderRadius: 22, overflow: "hidden",
        border: "none", padding: 0, margin: 0, background: "var(--bg-2)", color: "#fff", textAlign: "left", font: "inherit", cursor: "pointer",
        boxShadow: "var(--shadow)",
      }}>
        <Backdrop path={d?.backdrop} poster={item.poster} title={item.title} size="w1280" />
        <span aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.85) 100%)" }} />
        <span style={{ position: "absolute", left: 16, right: info.canTick ? 132 : 16, bottom: 14 }}>
          <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.72)" }}>Up Next</span>
          <span style={{ display: "block", fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
          <span key={info.line} className="tvt-pop" style={{ fontSize: 13.5, color: "rgba(255,255,255,0.86)", marginTop: 3 }}>
            <span className="mono" style={{ fontWeight: 600 }}>{info.line}</span>{info.sub && ` · ${info.sub}`}
          </span>
          {info.progress != null && <ProgressBar value={info.progress} color="#fff" height={3} style={{ marginTop: 10, background: "rgba(255,255,255,0.25)" }} />}
        </span>
      </button>
      {info.canTick && (
        <button type="button" onClick={onTick} aria-label={info.tick === "Watched" ? `Mark ${info.line} watched` : `Finish ${item.title}`} style={{
          position: "absolute", right: 14, bottom: 14, display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 15px", minHeight: 40, borderRadius: 999, border: "none",
          background: "#fff", color: "#000", fontWeight: 600, fontSize: 14, cursor: "pointer",
          boxShadow: "0 6px 18px -8px rgba(0,0,0,0.6)",
        }}><CheckIcon size={16} />{info.tick}</button>
      )}
    </div>
  );
}

function UpNextRow({ item, d, onOpen, onTick }) {
  const info = upNextInfo(item, d);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 18, padding: 10 }}>
      <button type="button" className="tvt-wide-btn" onClick={() => onOpen(item)} style={{
        flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12,
        background: "transparent", border: "none", padding: 0, margin: 0,
        textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit",
      }}>
        <span style={{ position: "relative", display: "block", width: 112, aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden", flexShrink: 0 }}>
          <Backdrop path={d?.backdrop} poster={item.poster} title={item.title} size="w300" />
        </span>
        <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
          <span key={info.line} className="mono tvt-pop" style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{info.line}</span>
          <span style={{ fontSize: 12.5, color: "var(--ink-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{info.sub}</span>
          {info.progress != null && <ProgressBar value={info.progress} height={3} style={{ marginTop: 3 }} />}
        </span>
      </button>
      {info.canTick && (
        <button type="button" onClick={onTick} aria-label={info.tick === "Watched" ? `Mark ${item.title} ${info.line} watched` : `Finish ${item.title}`} style={{
          ...iconBtn(40), background: "color-mix(in oklab, var(--accent) 18%, transparent)", color: "var(--accent)",
        }}><CheckIcon size={18} /></button>
      )}
    </div>
  );
}

/* "Because you watched X": TMDB's recommendations for one of your recent
   titles, minus the ones you already have. */
function BecauseShelf({ seed, tmdbKey, lib, onOpen }) {
  const { recs, error } = useTitleDetails(seed.kind, seed.tmdbId, tmdbKey);
  const shown = (recs || []).filter((t) => !lib.has(titleKey(t.kind, t.tmdbId))).slice(0, 15);
  if (error || (recs && !shown.length)) return null;
  return (
    <Shelf eyebrow="Because you watched" title={seed.title}>
      {recs ? shown.map((t) => <PosterCard key={titleKey(t.kind, t.tmdbId)} tile={t} onOpen={onOpen} />) : <SkeletonCards />}
    </Shelf>
  );
}

/* ============ Explore ============
   What's popular, from TMDB: a carousel of today's trending titles, then
   shelves (what's hot this week, popular, new, top rated), for shows,
   movies or both. Searching swaps the shelves for results. */
const EXPLORE = {
  all: {
    hero: { path: "/trending/all/day" },
    rows: [
      { title: "What's Hot This Week", path: "/trending/all/week" },
      { title: "Popular Shows", path: "/tv/popular", kind: "tv" },
      { title: "Popular Movies", path: "/movie/popular", kind: "movie" },
      { title: "In Cinemas", path: "/movie/now_playing", kind: "movie" },
      { title: "Airing Today", path: "/tv/airing_today", kind: "tv" },
      { title: "Top Rated Shows", path: "/tv/top_rated", kind: "tv" },
      { title: "Top Rated Movies", path: "/movie/top_rated", kind: "movie" },
    ],
  },
  tv: {
    hero: { path: "/trending/tv/day", kind: "tv" },
    rows: [
      { title: "What's Hot This Week", path: "/trending/tv/week", kind: "tv" },
      { title: "Popular", path: "/tv/popular", kind: "tv" },
      { title: "Airing Today", path: "/tv/airing_today", kind: "tv" },
      { title: "On the Air", path: "/tv/on_the_air", kind: "tv" },
      { title: "Top Rated", path: "/tv/top_rated", kind: "tv" },
    ],
  },
  movie: {
    hero: { path: "/trending/movie/day", kind: "movie" },
    rows: [
      { title: "What's Hot This Week", path: "/trending/movie/week", kind: "movie" },
      { title: "Popular", path: "/movie/popular", kind: "movie" },
      { title: "In Cinemas", path: "/movie/now_playing", kind: "movie" },
      { title: "Coming Soon", path: "/movie/upcoming", kind: "movie" },
      { title: "Top Rated", path: "/movie/top_rated", kind: "movie" },
    ],
  },
};

function ExploreView({ items, tmdbKey, kind, setKind, query, setQuery, onOpen, onSettings }) {
  const lib = useLibraryIndex(items);
  const [attempt, setAttempt] = useStateB(0);
  const searching = query.trim().length >= 2;
  const search = useTmdbSearch(query, tmdbKey, searching, 20);
  const plan = EXPLORE[kind] || EXPLORE.all;
  const statusOf = (t) => lib.get(titleKey(t.kind, t.tmdbId))?.status;

  if (!tmdbKey) {
    return (
      <main className="tvt-view tvt-page" style={{ padding: PAGE_PAD }}>
        <ScreenTitle title="Explore" />
        <Card style={{ textAlign: "center", padding: "30px 20px" }}>
          <span className="tvt-pop" style={{ width: 56, height: 56, borderRadius: 999, background: "var(--fill)", color: "var(--ink-dim)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12, animationDelay: "0.2s" }}>
            <CompassIcon size={28} />
          </span>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Explore needs a TMDB key</div>
          <div style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.5, margin: "6px auto 16px", maxWidth: 300 }}>
            It's free: make an account at themoviedb.org, then paste your API key in Settings to see what's trending.
          </div>
          <button type="button" onClick={onSettings} style={accentBtn()}>Open Settings</button>
        </Card>
      </main>
    );
  }

  return (
    <main className="tvt-view tvt-page" style={{ padding: PAGE_PAD }}>
      <ScreenTitle title="Explore" />
      <SearchField value={query} onChange={setQuery} />
      <div style={{ marginBottom: 20 }}>
        <SegToggle full options={FILTERS} value={kind} onChange={setKind} label="Show" />
      </div>
      {searching ? (
        <SearchList state={search} kind={kind} statusOf={statusOf} onOpen={onOpen} />
      ) : (
        // Keyed, so the shelves rise in afresh for a new filter or a retry.
        <ExploreShelves key={kind + attempt} plan={plan} tmdbKey={tmdbKey} statusOf={statusOf} onOpen={onOpen} onRetry={() => setAttempt((a) => a + 1)} />
      )}
      {/* TMDB's terms ask apps using its API to say this. */}
      <div style={{ fontSize: 11.5, color: "var(--ink-faint)", textAlign: "center", lineHeight: 1.4, margin: "4px 12px 0" }}>
        Data and images from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
      </div>
    </main>
  );
}

function ExploreShelves({ plan, tmdbKey, statusOf, onOpen, onRetry }) {
  const hero = useTmdbList(plan.hero.path, plan.hero.kind, tmdbKey);
  // The carousel failing means TMDB can't be reached (or the key's bad):
  // say so once, rather than under every shelf.
  if (hero.error && !hero.results) {
    return (
      <Card style={{ textAlign: "center", padding: "26px 20px" }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Couldn't load Explore</div>
        <div style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.5, margin: "6px auto 14px", maxWidth: 300 }}>{hero.error}</div>
        <button type="button" onClick={onRetry} style={ghostBtn()}>Try Again</button>
      </Card>
    );
  }
  return (
    <div className="tvt-view">
      <section style={{ marginBottom: 26 }}>
        <SectionHeader title="Trending Today" />
        <div className="tvt-shelf">
          {hero.results
            ? hero.results.slice(0, 10).map((t, i) => <HeroCard key={titleKey(t.kind, t.tmdbId)} tile={t} rank={i + 1} status={statusOf(t)} onOpen={onOpen} />)
            : [0, 1].map((i) => <span key={i} className="tvt-skel" style={{ flex: "0 0 86%", maxWidth: 460, aspectRatio: "16 / 10", borderRadius: 20 }} />)}
        </div>
      </section>
      {plan.rows.map((row) => <TmdbShelf key={row.path} row={row} tmdbKey={tmdbKey} statusOf={statusOf} onOpen={onOpen} />)}
    </div>
  );
}

/* A wide card for the trending carousel, as the TV app draws its hero row. */
function HeroCard({ tile, rank, status, onOpen }) {
  return (
    <button type="button" className="tvt-wide-btn" onClick={() => onOpen(tile)} style={{
      position: "relative", flex: "0 0 86%", maxWidth: 460, aspectRatio: "16 / 10", scrollSnapAlign: "start",
      borderRadius: 20, overflow: "hidden", border: "none", padding: 0, margin: 0,
      background: "var(--bg-2)", color: "#fff", textAlign: "left", font: "inherit", cursor: "pointer",
    }}>
      <Backdrop path={tile.backdrop} poster={tile.poster} title={tile.title} />
      <span aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.82) 100%)" }} />
      <span style={{ position: "absolute", left: 16, right: 16, bottom: 14 }}>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.75)" }}>
          #{rank} · {tile.kind === "tv" ? "Show" : "Movie"}
        </span>
        <span style={{ display: "block", fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tile.title}</span>
        <span style={{ display: "block", fontSize: 13, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>{tileMeta(tile)}</span>
      </span>
      {status && <StatusBadge status={status} />}
    </button>
  );
}

function TmdbShelf({ row, tmdbKey, statusOf, onOpen }) {
  const st = useTmdbList(row.path, row.kind, tmdbKey);
  if (st.error && !st.results) return null;
  if (st.results && !st.results.length) return null;
  return (
    <Shelf title={row.title}>
      {st.results
        ? st.results.map((t) => <PosterCard key={titleKey(t.kind, t.tmdbId)} tile={t} status={statusOf(t)} onOpen={onOpen} />)
        : <SkeletonCards />}
    </Shelf>
  );
}

/* An iOS search field. Return closes the keyboard. */
function SearchField({ value, onChange }) {
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); e.currentTarget.querySelector("input")?.blur(); }} style={{ position: "relative", marginBottom: 12 }}>
      <span aria-hidden style={{ position: "absolute", left: 10, top: 0, bottom: 0, display: "flex", alignItems: "center", color: "var(--ink-faint)", pointerEvents: "none" }}>
        <SearchIcon />
      </span>
      <input type="search" className="tvt-search" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="Shows, Movies and More" aria-label="Search shows and movies" enterKeyHint="search"
        autoComplete="off" autoCorrect="off" spellCheck={false}
        style={{ width: "100%", background: "var(--fill)", border: "none", borderRadius: 12, padding: "10px 38px 10px 35px", fontSize: 16, color: "var(--ink)" }} />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" style={{
          position: "absolute", right: 4, top: 0, bottom: 0, width: 34, display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--bg)",
        }}>
          <span style={{ width: 18, height: 18, borderRadius: 999, background: "var(--ink-faint)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><XIcon size={8} /></span>
        </button>
      )}
    </form>
  );
}

function SearchList({ state, kind, statusOf, onOpen }) {
  const note = (text) => <div style={{ fontSize: 13.5, color: "var(--ink-dim)", padding: "6px 4px 20px" }}>{text}</div>;
  if (state.error) return note(state.error);
  const results = state.results.filter((t) => kind === "all" || t.kind === kind);
  if (!results.length) return note(state.loading ? "Searching…" : "No matches on TMDB.");
  return (
    <div style={{ marginBottom: 18 }}>
      {results.map((t, i) => {
        const status = statusOf(t);
        return (
          <AnimatedRow key={titleKey(t.kind, t.tmdbId)} index={i}>
            <button type="button" className="tvt-wide-btn" onClick={() => onOpen(t)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 10, margin: 0,
              background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 18,
              textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer",
            }}>
              <Poster item={t} />
              <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "var(--ink-dim)" }}>
                  <KindChip kind={t.kind} />
                  {tileMeta(t) && <span className="mono">{tileMeta(t)}</span>}
                  {status && <span style={{ color: "var(--accent)", fontWeight: 600 }}>{statusLabel(status)}</span>}
                </span>
              </span>
              <span style={{ color: "var(--ink-faint)", display: "inline-flex" }}><ChevronIcon /></span>
            </button>
          </AnimatedRow>
        );
      })}
    </div>
  );
}

Object.assign(window, { titleKey, useLibraryIndex, Backdrop, PosterCard, Shelf, upNextInfo, WatchingView, ExploreView });
