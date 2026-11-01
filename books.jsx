/* books.jsx — books: Open Library search and lookups, the Books tab
   (Reading, Want to Read, Read), the book sheet (your page, rating and
   note), and importing a Goodreads or StoryGraph CSV export.

   A book is an item like a show or movie (kind "book"), so it syncs, backs
   up and undoes the same way. It keeps the same three statuses (watching,
   watchlist, watched), shown as Reading, Want to Read and Read. App hands
   the TV and movie screens only shows and movies, so no book reaches TMDB,
   Up Next, watch time or Activity. */
const { useState: useStateBk, useEffect: useEffectBk, useRef: useRefBk, useMemo: useMemoBk } = React;

const isBook = (i) => i?.kind === "book";
const BOOK_STATUSES = [
  { v: "watching", l: "Reading", icon: BookIcon },
  { v: "watchlist", l: "Want to Read", icon: BookmarkIcon },
  { v: "watched", l: "Read", icon: CheckCircleIcon },
];
const bookStatusLabel = (v) => BOOK_STATUSES.find((s) => s.v === v)?.l || v;

/* ============ Fields ============ */
const cleanIsbn = (s) => {
  const d = String(s ?? "").toUpperCase().replace(/[^0-9X]/g, "");
  return /^(\d{9}[\dX]|\d{13})$/.test(d) ? d : "";
};
const cleanOlKey = (s) => (/^\/works\/OL\d+W$/.test(String(s ?? "")) ? String(s) : "");
const cleanCover = (n) => (Number.isInteger(n) && n > 0 ? n : null);

/* bookFields — a book's own fields, for normaliseItem (app.jsx). `page`
   is the last page read (0 = not started); `pages` the total (0 = not
   known). `finished` is when it moved to Read, for "read this year". */
function bookFields(x) {
  const pages = clampInt(x.pages ?? 0, 0, 99999);
  return {
    author: String(x.author ?? "").trim().slice(0, 200),
    pages,
    page: clampInt(x.page ?? 0, 0, pages || 99999),
    olKey: cleanOlKey(x.olKey),
    cover: cleanCover(x.cover),
    isbn: cleanIsbn(x.isbn),
    finished: typeof x.finished === "string" && Date.parse(x.finished) ? x.finished : "",
  };
}

/* What a move to another status changes: finishing sets the date and the
   page to the last; starting a book you've read again starts it at page 0. */
function bookStatusPatch(book, status) {
  if (status === "watched") return { status, finished: nowIso(), page: book.pages || book.page };
  if (status === "watching" && book.status === "watched") return { status, page: 0 };
  return { status };
}

// 0–1, or null when the total isn't known.
const bookProgress = (b) => (b.pages ? Math.min(1, b.page / b.pages) : null);
const monthYear = (iso) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
function bookProgressLabel(b) {
  if (b.status === "watched") return b.finished ? `Read ${monthYear(b.finished)}` : "Read";
  if (b.status === "watchlist") return b.pages ? `${b.pages} pages` : "";
  if (!b.page) return "Not started";
  return b.pages ? `p. ${b.page} of ${b.pages} · ${Math.round((b.page / b.pages) * 100)}%` : `Page ${b.page}`;
}

/* ============ Open Library ============
   Free, no key. Search by title, author or ISBN; a work's description;
   covers by cover id (those aren't rate-limited, unlike covers by ISBN). */
const OL = "https://openlibrary.org";
const coverUrl = (id, size = "M") => (id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : "");
// What Poster (app.jsx) draws for a book: its cover, else a stand-in.
const bookArt = (b, size = "M") => ({ title: b.title || "?", kind: "book", poster: "", img: coverUrl(b.cover, size) });

async function olGet(path, params, signal) {
  const url = new URL(OL + path);
  for (const [k, v] of Object.entries(params || {})) if (v != null && v !== "") url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    throw new Error("Couldn't reach Open Library. Check your connection.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(res.status === 429 ? "Open Library is busy. Try again in a minute." : `Open Library didn't answer (${res.status})`);
  return res.json();
}

const OL_FIELDS = "key,title,author_name,first_publish_year,cover_i,number_of_pages_median,edition_count";
function olTile(d) {
  const title = String(d?.title || "").trim().slice(0, 200);
  if (!title) return null;
  return {
    kind: "book", title, olKey: cleanOlKey(d.key),
    author: (Array.isArray(d.author_name) ? d.author_name : []).slice(0, 3).join(", "),
    year: d.first_publish_year ? String(d.first_publish_year) : "",
    cover: cleanCover(d.cover_i), pages: clampInt(d.number_of_pages_median || 0, 0, 99999),
    isbn: "", editions: d.edition_count || 0,
  };
}

/* An edition by ISBN, for one the search doesn't index. It names its
   author by key only, so that's one more request. */
async function olIsbn(isbn, signal) {
  const ed = await olGet(`/isbn/${isbn}.json`, null, signal);
  if (!ed?.title) return null;
  let author = "";
  const ak = ed.authors?.[0]?.key;
  if (/^\/authors\/OL\d+A$/.test(ak || "")) {
    try { author = (await olGet(`${ak}.json`, null, signal))?.name || ""; } catch (e) { if (e?.name === "AbortError") throw e; }
  }
  return {
    kind: "book", title: String(ed.title).slice(0, 200), olKey: cleanOlKey(ed.works?.[0]?.key), author,
    year: (String(ed.publish_date || "").match(/\d{4}/) || [""])[0],
    cover: cleanCover((ed.covers || []).find((c) => c > 0)), pages: clampInt(ed.number_of_pages || 0, 0, 99999), isbn, editions: 0,
  };
}

/* olSearch — up to 20 books for a title, author or ISBN. */
async function olSearch(query, signal) {
  const q = query.trim();
  const isbn = cleanIsbn(q);
  const data = await olGet("/search.json", { q, fields: OL_FIELDS, limit: 20 }, signal);
  let tiles = (data?.docs || []).map(olTile).filter(Boolean);
  if (isbn) {
    tiles = tiles.slice(0, 1).map((t) => ({ ...t, isbn }));
    if (!tiles.length) {
      const t = await olIsbn(isbn, signal);
      if (t) tiles = [t];
    }
  }
  return tiles;
}

/* Open Library descriptions often end in a list of sources and carry
   Markdown links; keep the text. */
function cleanOlText(s) {
  return String(s || "")
    .split(/\n-{3,}/)[0]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\[\d+\]:.*$/gm, "")
    .replace(/\(\[source\]\[\d+\]\)/gi, "")
    .replace(/\r/g, "").replace(/\n{3,}/g, "\n\n")
    .trim().slice(0, 3000);
}

/* useOlWork — a work's description and subjects, when its sheet opens.
   Kept for this visit only. */
const olWorkCache = new Map();
function useOlWork(olKey) {
  const [w, setW] = useStateBk(() => olWorkCache.get(olKey) || null);
  useEffectBk(() => {
    if (!olKey) { setW(null); return; }
    if (olWorkCache.has(olKey)) { setW(olWorkCache.get(olKey)); return; }
    setW(null);
    const ac = new AbortController();
    olGet(`${olKey}.json`, null, ac.signal).then((d) => {
      const raw = typeof d?.description === "string" ? d.description : d?.description?.value || "";
      const got = { about: cleanOlText(raw), subjects: (d?.subjects || []).filter((s) => typeof s === "string" && s.length < 40).slice(0, 6) };
      olWorkCache.set(olKey, got);
      setW(got);
    }).catch(() => {});
    return () => ac.abort();
  }, [olKey]);
  return w;
}

/* useBookSearch — Open Library's matches for what's typed, a moment after
   the typing stops. */
function useBookSearch(query) {
  const [state, setState] = useStateBk({ results: [], loading: false, error: "" });
  useEffectBk(() => {
    const q = query.trim();
    if (q.length < 2) { setState({ results: [], loading: false, error: "" }); return; }
    setState((s) => ({ ...s, loading: true, error: "" }));
    const ac = new AbortController();
    const t = setTimeout(() => {
      olSearch(q, ac.signal)
        .then((results) => setState({ results, loading: false, error: "" }))
        .catch((e) => { if (e?.name !== "AbortError") setState({ results: [], loading: false, error: e.message }); });
    }, 400);
    return () => { clearTimeout(t); ac.abort(); };
  }, [query]);
  return state;
}

/* ============ Matching ============ */
const bookNorm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\s*\([^)]*\)\s*$/, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
// The first author's surname, so "Andy Weir" and "Weir, Andy" agree.
const authorKey = (a) => {
  const first = String(a || "").split(/;|,(?=\s*\S+\s+\S)| & | and /i)[0];
  const parts = bookNorm(first.includes(",") ? first.split(",")[0] : first).split(" ").filter(Boolean);
  return first.includes(",") ? parts[0] || "" : parts[parts.length - 1] || "";
};
// Goodreads titles carry the series: "Dune (Dune, #1)".
const bareTitle = (t) => String(t || "").replace(/\s*\([^)]*#\s*[\d.]+\)\s*$/, "").trim();

/* findBook — the library book a search result, a CSV row or a sheet is
   about: by id, Open Library work, ISBN, else title and author. */
function findBook(books, t) {
  if (!t) return null;
  const title = bookNorm(bareTitle(t.title));
  const author = authorKey(t.author);
  return (t.itemId && books.find((b) => b.id === t.itemId))
    || (t.olKey && books.find((b) => b.olKey === t.olKey))
    || (t.isbn && books.find((b) => b.isbn === t.isbn))
    || (title && books.find((b) => bookNorm(bareTitle(b.title)) === title && (!author || !b.author || authorKey(b.author) === author)))
    || null;
}

/* useBookBackfill — books without an Open Library link (imported from a
   CSV, or typed in) are looked up there one at a time, in the background,
   for a cover and page count. A miss isn't tried again (tvt:olmiss:v1). */
const OL_MISS_KEY = "tvt:olmiss:v1";
const olTried = new Set();
function useBookBackfill(books, updateItems) {
  const busy = useRefBk(false);
  const alive = useRefBk(true);
  useEffectBk(() => () => { alive.current = false; }, []);
  const want = books.filter((b) => !b.olKey && !olTried.has(b.id));
  const sig = want.map((b) => b.id).join(",");
  useEffectBk(() => {
    // One pass at a time; a pass's own matches change `sig`, and the books
    // it hasn't reached yet are already in its list.
    if (!want.length || busy.current || navigator.onLine === false) return;
    let miss = [];
    try { miss = JSON.parse(localStorage.getItem(OL_MISS_KEY) || "[]") || []; } catch {}
    const missed = new Set(miss);
    want.forEach((b) => missed.has(b.id) && olTried.add(b.id));
    const todo = want.filter((b) => !missed.has(b.id)).slice(0, 150);
    if (!todo.length) return;
    busy.current = true;
    (async () => {
      try {
        for (const b of todo) {
          if (!alive.current) break;
          olTried.add(b.id);
          let hit = null;
          try {
            if (b.isbn) hit = (await olSearch(b.isbn))[0] || null;
            if (!hit) {
              const data = await olGet("/search.json", { title: bareTitle(b.title), author: b.author.split(/,| & /)[0], fields: OL_FIELDS, limit: 5 });
              const sought = bookNorm(bareTitle(b.title));
              hit = (data?.docs || []).map(olTile).filter(Boolean).find((t) => {
                const got = bookNorm(t.title);
                return got === sought || got.startsWith(sought + " ") || sought.startsWith(got + " ");
              }) || null;
            }
          } catch {
            // Offline or busy: what's left is tried next time the app opens.
            todo.slice(todo.indexOf(b)).forEach((x) => olTried.delete(x.id));
            break;
          }
          if (hit?.olKey) {
            updateItems((prev) => prev.map((i) => (i.id !== b.id ? i : normaliseItem(touch({
              ...i, olKey: hit.olKey, cover: i.cover || hit.cover, pages: i.pages || hit.pages, year: i.year || hit.year, author: i.author || hit.author,
            })) || i)));
          } else {
            miss = [...miss, b.id].slice(-2000);
            try { localStorage.setItem(OL_MISS_KEY, JSON.stringify(miss)); } catch {}
          }
          await new Promise((r) => setTimeout(r, 700));
        }
      } finally {
        busy.current = false;
      }
    })();
  }, [sig]);
}

/* ============ Books tab ============ */
const byLastRead = (list) => [...list].sort((a, b) => (b.lastWatched || b.updated).localeCompare(a.lastWatched || a.updated));
const byAdded = (list) => [...list].sort((a, b) => b.added.localeCompare(a.added));
const byFinished = (list) => [...list].sort((a, b) => (b.finished || b.updated).localeCompare(a.finished || a.updated));

function BooksView({ books, onOpen, onAdd, onAddByHand, onMove, onMore, onImport }) {
  const [query, setQuery] = useStateBk("");
  const search = useBookSearch(query);
  const reading = byLastRead(books.filter((b) => b.status === "watching"));
  const want = byAdded(books.filter((b) => b.status === "watchlist"));
  const read = byFinished(books.filter((b) => b.status === "watched"));
  const year = new Date().getFullYear();
  const thisYear = read.filter((b) => b.finished && new Date(b.finished).getFullYear() === year);
  const pagesThisYear = thisYear.reduce((n, b) => n + (b.pages || 0), 0);

  // A one-tap move (Start, Done) folds the row away first.
  const moving = useRefBk({});
  const [isLeaving, foldAway] = useFoldAway((id) => { onMove(id, moving.current[id]); delete moving.current[id]; });
  const quick = (book, act) => {
    if (act === "update") { onOpen(book, { focusPage: true }); return; }
    moving.current[book.id] = act === "start" ? "watching" : "watched";
    foldAway(book.id);
  };
  const row = (book) => <BookRow book={book} onOpen={onOpen} onQuick={quick} onMore={onMore} />;
  const q = query.trim();

  return (
    <main className="tvt-view tvt-page" style={{ padding: PAGE_PAD }}>
      <ScreenTitle title="Books" detail={books.length ? `${thisYear.length} read in ${year}` : null} />
      <SearchField value={query} onChange={setQuery} placeholder="Title, author or ISBN" />

      {q.length >= 2 ? (
        <BookResults state={search} books={books} query={q} onOpen={onOpen} onAdd={onAdd} onAddByHand={onAddByHand} />
      ) : !books.length ? (
        <Card style={{ textAlign: "center", padding: "30px 20px" }}>
          <span className="tvt-pop" style={{ width: 56, height: 56, borderRadius: 999, background: "var(--fill)", color: "var(--ink-dim)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 12, animationDelay: "0.2s" }}>
            <BookIcon size={26} />
          </span>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Track what you're reading</div>
          <div style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.5, margin: "6px auto 16px", maxWidth: 310 }}>
            Search above by title, author or ISBN, or bring in your Goodreads or StoryGraph library.
          </div>
          <button type="button" onClick={onImport} style={accentBtn()}>Import a CSV</button>
        </Card>
      ) : (
        <>
          <InfoStrip cells={[
            { label: "Reading", value: reading.length, sub: "now" },
            { label: `Read in ${year}`, value: thisYear.length, sub: thisYear.length === 1 ? "book" : "books" },
            { label: "Pages", value: pagesThisYear.toLocaleString("en-GB"), sub: `in ${year}` },
          ]} />
          <div style={{ height: 18 }} />

          {reading.length > 0 ? (
            <section style={{ marginBottom: 22 }}>
              <SectionHeader title="Reading" detail={reading.length} />
              {reading.map((b, i) => <AnimatedRow key={b.id} index={i} leaving={isLeaving(b.id)}>{row(b)}</AnimatedRow>)}
            </section>
          ) : (
            <Card style={{ textAlign: "center", padding: "20px", marginBottom: 22 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Nothing on the go</div>
              <div style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.5, marginTop: 4 }}>
                {want.length ? "Tap Start on one you want to read." : "Search for a book to start."}
              </div>
            </Card>
          )}

          {want.length > 0 && (
            <FoldSection id="books:want" title="Want to Read" count={want.length} defaultOpen={!reading.length || want.length <= 6}>
              <LongList items={want} leaving={isLeaving} render={row} />
            </FoldSection>
          )}
          {read.length > 0 && (
            <FoldSection id="books:read" title="Read" count={read.length} defaultOpen>
              <LongList items={read} leaving={isLeaving} render={row} />
            </FoldSection>
          )}

          <div style={{ textAlign: "center", marginTop: 8 }}>
            <button type="button" onClick={onImport} style={ghostBtn()}>Import from Goodreads or StoryGraph</button>
          </div>
        </>
      )}
      <div style={{ fontSize: 11.5, color: "var(--ink-faint)", textAlign: "center", marginTop: 16 }}>Book data and covers from Open Library.</div>
    </main>
  );
}

function BookRow({ book, onOpen, onQuick, onMore }) {
  const press = useLongPress(onMore ? () => onMore(book) : null);
  const p = bookProgress(book);
  const label = bookProgressLabel(book);
  const act = book.status === "watchlist" ? "start" : book.status === "watching" ? (book.pages && book.page >= book.pages ? "done" : "update") : null;
  const actLabel = { start: "Start", update: "Page", done: "Done" }[act];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 18, padding: "10px 8px 10px 10px" }}>
      <button type="button" className="tvt-wide-btn tvt-hold" ref={press.ref} onClick={press.guard(() => onOpen(book))} style={{
        flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12,
        background: "transparent", border: "none", padding: 0, margin: 0, textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit",
      }}>
        <Poster item={bookArt(book)} stripe={false} />
        <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{book.title}</span>
          {book.author && <span style={{ fontSize: 13, color: "var(--ink-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{book.author}</span>}
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, color: "var(--ink-dim)" }}>
            {label && <span key={label} className="mono tvt-pop">{label}</span>}
            <Stars value={book.rating} />
          </span>
          {book.status === "watching" && p != null && <ProgressBar value={p} style={{ marginTop: 2 }} />}
        </span>
      </button>
      {act && (
        <button type="button" onClick={() => onQuick(book, act)} style={{
          ...(act === "update" ? ghostBtn() : accentBtn()), padding: "8px 13px", minHeight: 36, borderRadius: 999, fontSize: 13, fontWeight: 600, flexShrink: 0,
        }}>{actLabel}</button>
      )}
      {onMore && <MoreButton onClick={() => onMore(book)} label={`${book.title} options`} size={34} style={{ background: "transparent", marginRight: -4 }} />}
    </div>
  );
}

/* Search results: tap for the book's sheet; + puts it on Want to Read. */
function BookResults({ state, books, query, onOpen, onAdd, onAddByHand }) {
  const note = (text) => <div style={{ fontSize: 13.5, color: "var(--ink-dim)", padding: "6px 4px 14px" }}>{text}</div>;
  const byHand = (
    <button type="button" onClick={() => onAddByHand(query)} style={{ ...ghostBtn(), width: "100%", marginBottom: 18 }}>
      Not there? Add “{query.length > 40 ? query.slice(0, 40) + "…" : query}” by hand
    </button>
  );
  if (state.error) return <>{note(state.error)}{byHand}</>;
  if (!state.results.length) return <>{note(state.loading ? "Searching Open Library…" : "No matches on Open Library.")}{!state.loading && byHand}</>;
  return (
    <div style={{ marginBottom: 18 }}>
      {state.results.map((t, i) => {
        const have = findBook(books, t);
        return (
          <AnimatedRow key={(t.olKey || t.title) + i} index={i}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 18, padding: "10px 8px 10px 10px" }}>
              <button type="button" className="tvt-wide-btn" onClick={() => onOpen(have || t)} style={{
                flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, padding: 0, margin: 0,
                background: "transparent", border: "none", textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer",
              }}>
                <Poster item={bookArt(t)} stripe={false} />
                <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                  <span style={{ fontSize: 13, color: "var(--ink-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[t.author, t.year].filter(Boolean).join(" · ") || " "}</span>
                  {have && <span key={have.status} className="tvt-pop" style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600 }}>{bookStatusLabel(have.status)}</span>}
                </span>
              </button>
              {!have ? (
                <button type="button" onClick={() => onAdd(t, "watchlist")} aria-label={`Add ${t.title} to Want to Read`} title="Want to Read" style={{
                  ...iconBtn(38), background: "color-mix(in oklab, var(--accent) 16%, transparent)", color: "var(--accent)",
                }}><PlusIcon size={18} /></button>
              ) : (
                <span aria-hidden className="tvt-check-pop" style={{ display: "inline-flex", color: "var(--accent)", padding: "0 8px" }}><CheckIcon size={16} /></span>
              )}
            </div>
          </AnimatedRow>
        );
      })}
      {byHand}
    </div>
  );
}

/* ============ Book sheet ============
   The cover, author and facts; your status; for one you're reading, the
   page you're on; your rating and note; its description; and its details
   to edit (a book typed in by hand opens with them showing). */
function BookSheet({ target, books, onAdd, onStatus, onPatch, onDelete, onClose }) {
  const { ref, closing, close } = useModalDismiss(onClose);
  const item = findBook(books, target);
  // Once removed, it still shows as it was while the sheet slides away.
  const last = useRefBk(null);
  if (item) last.current = item;
  const b = item || last.current || target;
  const work = useOlWork(b.olKey);
  const [editing, setEditing] = useStateBk(!!target.editDetails);
  const remove = () => { onDelete(item.id); close(); };
  const facts = [
    { label: "Pages", value: b.pages || "–", sub: b.pages ? "in print" : "not known" },
    { label: "Published", value: b.year || "–", sub: b.year ? "first" : "" },
  ];
  if (item?.status === "watching" && b.pages) facts.push({ label: "Read", value: `${Math.round(bookProgress(b) * 100)}%`, sub: `p. ${b.page}` });
  else if (b.editions) facts.push({ label: "Editions", value: b.editions.toLocaleString("en-GB"), sub: "on Open Library" });
  const art = bookArt(b, "L");

  return (
    <ModalFrame sheet flush maxWidth={600} dismiss={{ ref, closing, close }} label={b.title}>
      <div className="tvt-sheet-top">
        <button type="button" onClick={close} aria-label="Close" className="tvt-glass-btn" style={{ right: 12 }}><XIcon size={12} /></button>
      </div>
      <div style={{ position: "relative", height: 200, overflow: "hidden" }}>
        <span aria-hidden style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg, oklch(52% 0.12 ${titleHue(b.title || "")}), oklch(26% 0.08 ${titleHue(b.title || "") + 40}))` }} />
        {art.img && <img src={art.img} alt="" style={{ position: "absolute", inset: -30, width: "calc(100% + 60px)", height: "calc(100% + 60px)", objectFit: "cover", filter: "blur(28px) saturate(140%)", opacity: 0.7 }} />}
        <span aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 35%, color-mix(in oklab, var(--bg-1) 55%, transparent) 70%, var(--bg-1) 100%)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: -150, position: "relative" }}>
        <span className="tvt-detail-poster" style={{ borderRadius: 10, boxShadow: "0 26px 50px -22px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)" }}>
          <Poster item={art} size={150} ratio={1.5} radius={10} stripe={false} />
        </span>
      </div>
      <div style={{ textAlign: "center", padding: "18px 22px 0" }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, overflowWrap: "anywhere" }}>{b.title}</h2>
        {b.author && <div style={{ fontSize: 14.5, color: "var(--ink-dim)", marginTop: 6 }}>{b.author}</div>}
      </div>
      <InfoStrip cells={facts} />

      <div style={{ padding: "20px 16px 0" }}>
        <div role="radiogroup" aria-label={item ? "Status" : "Add to"} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {BOOK_STATUSES.map((s) => {
            const Icon = s.icon;
            const on = s.v === item?.status;
            return (
              <button key={s.v} type="button" role="radio" aria-checked={on} onClick={() => (item ? onStatus(item.id, s.v) : onAdd(target, s.v))} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "12px 4px 10px",
                borderRadius: 16, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                background: on ? "var(--accent)" : "var(--fill)", color: on ? "var(--accent-ink)" : "var(--ink)",
                transition: "background-color 0.2s ease, color 0.2s ease, var(--press)",
              }}>
                <span key={on ? "on" : "off"} className={on ? "tvt-tab-pop" : undefined} style={{ display: "inline-flex" }}><Icon size={22} /></span>
                {item ? s.l : `+ ${s.l}`}
              </button>
            );
          })}
        </div>
      </div>

      {item?.status === "watching" && <PageSection book={item} focus={!!target.focusPage} onPatch={onPatch} onFinish={() => onStatus(item.id, "watched")} />}

      {item && (
        <DetailSection title="Your Rating">
          <RatingInput value={item.rating} onChange={(v) => onPatch(item.id, { rating: v })} />
        </DetailSection>
      )}
      {item && <BookNote book={item} onPatch={onPatch} />}

      {(work?.about || work?.subjects?.length > 0) && (
        <DetailSection title="About">
          <Overview key={work.about} text={work.about} />
          {work.subjects.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {work.subjects.map((s) => <span key={s} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, background: "var(--fill)", color: "var(--ink-dim)" }}>{s}</span>)}
            </div>
          )}
        </DetailSection>
      )}

      {item && (
        <DetailSection title="Details">
          {editing ? <BookDetails book={item} onPatch={onPatch} onDone={() => setEditing(false)} /> : (
            <button type="button" onClick={() => setEditing(true)} style={ghostBtn()}>Edit Title, Author and Pages</button>
          )}
        </DetailSection>
      )}

      <div style={{ padding: "24px 20px calc(28px + var(--safe-bottom))", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {b.olKey && (
          <a href={OL + b.olKey} target="_blank" rel="noopener noreferrer" style={{ ...ghostBtn(), textDecoration: "none" }}>On Open Library</a>
        )}
        <span style={{ flex: 1 }} />
        {item && <button type="button" onClick={remove} style={{ ...ghostBtn(), color: "var(--danger)" }}>Remove</button>}
      </div>
    </ModalFrame>
  );
}

/* A whole number from a field, or null for nothing typed. */
const bookNum = (s) => (String(s).trim() === "" ? null : clampInt(s, 0, 99999));

/* The page you're on, out of how many, with steps forward and a button
   to finish it. A field saves when you leave it or press Done. */
function PageSection({ book, focus, onPatch, onFinish }) {
  const [page, setPage] = useStateBk(String(book.page || ""));
  const [total, setTotal] = useStateBk(String(book.pages || ""));
  const pageRef = useRefBk(null);
  useEffectBk(() => { if (document.activeElement !== pageRef.current) setPage(String(book.page || "")); }, [book.page]);
  useEffectBk(() => { setTotal(String(book.pages || "")); }, [book.pages]);
  useEffectBk(() => { if (focus) setTimeout(() => pageRef.current?.focus(), 350); }, []);
  const savePage = (n) => {
    const v = Math.min(n, book.pages || 99999);
    setPage(String(v || ""));
    if (v !== book.page) onPatch(book.id, { page: v });
  };
  const saveTotal = () => {
    const n = bookNum(total) ?? 0;
    if (n !== book.pages) onPatch(book.id, { pages: n, page: n ? Math.min(book.page, n) : book.page });
  };
  const step = (d) => savePage(Math.max(0, (bookNum(page) ?? book.page) + d));
  const p = bookProgress(book);
  const enter = (fn) => (e) => { if (e.key === "Enter") { e.preventDefault(); fn(); e.currentTarget.blur(); } };
  const box = { ...fieldStyle(), width: 92, textAlign: "center", fontWeight: 700 };
  return (
    <DetailSection title="Your Progress">
      <div style={{ background: "var(--bg-2)", borderRadius: 16, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 14, color: "var(--ink-dim)" }} htmlFor="tvt-page">Page</label>
          <input id="tvt-page" className="mono" ref={pageRef} type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" value={page} placeholder="0"
            onChange={(e) => setPage(e.target.value.replace(/\D/g, "").slice(0, 5))} onBlur={() => savePage(bookNum(page) ?? 0)} onKeyDown={enter(() => savePage(bookNum(page) ?? 0))} style={box} />
          <label style={{ fontSize: 14, color: "var(--ink-dim)" }} htmlFor="tvt-pages">of</label>
          <input id="tvt-pages" className="mono" type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" value={total} placeholder="?"
            onChange={(e) => setTotal(e.target.value.replace(/\D/g, "").slice(0, 5))} onBlur={saveTotal} onKeyDown={enter(saveTotal)} style={box} />
        </div>
        {p != null && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <ProgressBar value={p} height={6} style={{ flex: 1 }} />
            <span key={Math.round(p * 100)} className="mono tvt-pop" style={{ fontSize: 13, fontWeight: 700 }}>{Math.round(p * 100)}%</span>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 12 }}>
          {[-10, 10, 25, 50].map((d) => (
            <button key={d} type="button" onClick={() => step(d)} style={{ ...ghostBtn(), padding: "9px 0", background: "var(--fill)" }} className="mono">{d > 0 ? `+${d}` : `−${-d}`}</button>
          ))}
        </div>
        <button type="button" onClick={onFinish} style={{ ...accentBtn(), width: "100%", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <CheckCircleIcon size={18} /> I've Finished It
        </button>
        <div style={{ fontSize: 12, color: "var(--ink-faint)", lineHeight: 1.4, marginTop: 10 }}>
          Page counts vary by edition: set the total to yours. Reading an ebook? Set it to 100 and log your percentage.
        </div>
      </div>
    </DetailSection>
  );
}

/* Your note, saved when you leave the field or close the sheet. */
function BookNote({ book, onPatch }) {
  const [note, setNote] = useStateBk(book.note);
  const latest = useRefBk({ note, book });
  latest.current = { note, book };
  const save = () => { const { note: n, book: b } = latest.current; if (n !== b.note) onPatch(b.id, { note: n }); };
  useEffectBk(() => save, []);
  return (
    <DetailSection title="Your Note">
      <textarea aria-label="Your note" rows={3} value={note} onChange={(e) => setNote(e.target.value.slice(0, 2000))} onBlur={save}
        placeholder="Who recommended it, favourite lines, where you left off…" style={{ ...fieldStyle(), resize: "vertical", lineHeight: 1.4, display: "block" }} />
    </DetailSection>
  );
}

/* Title, author, total pages and year, for a book typed in by hand or an
   edition that differs from Open Library's. */
function BookDetails({ book, onPatch, onDone }) {
  const [d, setD] = useStateBk({ title: book.title, author: book.author, pages: String(book.pages || ""), year: book.year });
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }));
  const ok = d.title.trim().length > 0;
  const save = () => {
    if (!ok) return;
    const pages = bookNum(d.pages) ?? 0;
    onPatch(book.id, { title: d.title.trim(), author: d.author.trim(), pages, page: pages ? Math.min(book.page, pages) : book.page, year: /^\d{4}$/.test(d.year.trim()) ? d.year.trim() : "" });
    onDone();
  };
  // Numbers get the number pad; words get capitals.
  const field = (id, label, k, max, num) => (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={id} className="label" style={{ display: "block", marginBottom: 5 }}>{label}</label>
      <input id={id} value={d[k]} onChange={set(k)} style={fieldStyle()} autoComplete="off" maxLength={max}
        inputMode={num ? "numeric" : undefined} pattern={num ? "[0-9]*" : undefined} autoCapitalize={num ? undefined : "words"} />
    </div>
  );
  return (
    <div>
      {field("tvt-btitle", "Title", "title", 200)}
      {field("tvt-bauthor", "Author", "author", 200)}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>{field("tvt-bpages", "Pages", "pages", 5, true)}</div>
        <div style={{ flex: 1 }}>{field("tvt-byear", "Year", "year", 4, true)}</div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onDone} style={ghostBtn()}>Cancel</button>
        <button type="button" onClick={save} disabled={!ok} style={{ ...accentBtn(), opacity: ok ? 1 : 0.4 }}>Save</button>
      </div>
    </div>
  );
}

/* ============ Goodreads and StoryGraph import ============
   Each export's own columns: Goodreads (Exclusive Shelf, My Rating, Date
   Read, ISBN13…) and StoryGraph (Read Status, Star Rating, Last Date
   Read, ISBN/UID…). Merged like the CSV import: a book you have moves
   forward but never back, and gains what it lacked; nothing is removed. */
const headKey = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const BOOK_HEADS = {
  title: ["title"],
  author: ["author", "authors"],
  isbn13: ["isbn13"],
  isbn: ["isbn", "isbnuid"],
  rating: ["myrating", "starrating"],
  pages: ["numberofpages", "pages"],
  year: ["originalpublicationyear", "yearpublished"],
  read: ["dateread", "lastdateread"],
  added: ["dateadded"],
  shelf: ["exclusiveshelf", "readstatus"],
  review: ["myreview", "review"],
  notes: ["privatenotes"],
  count: ["readcount"],
};
/* A header row from a book export (so the TV import can turn it away). */
function looksLikeBookCsv(row) {
  const hs = new Set((row || []).map(headKey));
  return hs.has("exclusiveshelf") || hs.has("readstatus") || hs.has("isbnuid") || (hs.has("isbn13") && hs.has("author"));
}
// "2024/05/14" or "2024-05-14", at midday so no time zone moves the day.
function bookDate(s) {
  const m = String(s || "").match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toISOString();
  const t = Date.parse(String(s || ""));
  return t ? new Date(t).toISOString() : "";
}
const SHELVES = { read: "watched", currentlyreading: "watching", paused: "watching", toread: "watchlist" };

/* bookRecords — a file's rows as books, or null when it isn't a book
   export. Did-not-finish books are counted and left out. */
function bookRecords(text) {
  const rows = parseCsv(text);
  const at = rows.slice(0, 5).findIndex(looksLikeBookCsv);
  if (at < 0) return null;
  const col = {};
  rows[at].forEach((h, i) => {
    const k = headKey(h);
    for (const [field, names] of Object.entries(BOOK_HEADS)) {
      const rank = names.indexOf(k);
      if (rank >= 0 && (col[field] == null || rank < col[field].rank)) col[field] = { i, rank };
    }
  });
  const get = (r, f) => (col[f] ? String(r[col[f].i] ?? "").trim() : "");
  const recs = [];
  let dnf = 0;
  for (const r of rows.slice(at + 1)) {
    const title = get(r, "title").slice(0, 200);
    if (!title) continue;
    const shelf = headKey(get(r, "shelf"));
    if (shelf === "didnotfinish" || shelf === "dnf") { dnf++; continue; }
    const status = SHELVES[shelf] || "watchlist";
    const note = [get(r, "review"), get(r, "notes")].filter(Boolean).join("\n\n")
      .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").slice(0, 2000);
    const reads = clampInt(get(r, "count") || 0, 0, 999);
    recs.push({
      title, author: get(r, "author").split(",").slice(0, 3).map((s) => s.trim()).filter(Boolean).join(", "),
      isbn: cleanIsbn(get(r, "isbn13")) || cleanIsbn(get(r, "isbn")),
      rating: clampRating(get(r, "rating")), pages: clampInt(get(r, "pages") || 0, 0, 99999),
      year: (get(r, "year").match(/^\d{4}$/) || [""])[0], status,
      finished: status === "watched" ? bookDate(get(r, "read")) : "",
      added: bookDate(get(r, "added")), note, rereads: Math.max(0, reads - 1),
    });
  }
  return { recs, dnf };
}

const BOOK_RANK = { watchlist: 0, watching: 1, watched: 2 };
/* planBookImport — what the records change: new books, and books you
   have with what the file adds. */
function planBookImport(recs, books) {
  const pool = [...books];
  const added = [], changed = new Map();
  let same = 0;
  const into = { watching: 0, watchlist: 0, watched: 0 };
  for (const r of recs) {
    const have = findBook(pool, r);
    if (!have) {
      const item = normaliseItem(touch({
        ...blankItem(r.status), kind: "book", title: r.title, author: r.author, isbn: r.isbn, pages: r.pages, year: r.year,
        page: r.status === "watched" ? r.pages : 0, rating: r.rating, note: r.note, finished: r.finished,
        added: r.added || nowIso(), lastWatched: r.finished || (r.status === "watching" ? nowIso() : ""), rewatches: r.rereads,
      }));
      if (!item) continue;
      added.push(item);
      pool.push(item);
      into[item.status]++;
      continue;
    }
    const p = {};
    if (BOOK_RANK[r.status] > BOOK_RANK[have.status]) {
      Object.assign(p, { status: r.status }, r.status === "watched" ? { finished: r.finished || nowIso(), page: have.pages || r.pages } : {});
    }
    if (r.rating && !have.rating) p.rating = r.rating;
    if (r.finished && !have.finished && (p.status || have.status) === "watched") p.finished = r.finished;
    if (r.pages && !have.pages) p.pages = r.pages;
    if (r.isbn && !have.isbn) p.isbn = r.isbn;
    if (r.author && !have.author) p.author = r.author;
    if (r.note && !have.note) p.note = r.note;
    if (!Object.keys(p).length) { same++; continue; }
    const next = normaliseItem(touch({ ...have, ...p }));
    changed.set(next.id, next);
    pool[pool.indexOf(have)] = next;
    if (p.status) into[p.status]++;
  }
  return { added, changed, same, into };
}

function BookImportSheet({ books, onImport, onClose }) {
  const { ref, closing, close } = useModalDismiss(onClose);
  const fileRef = useRefBk(null);
  const [file, setFile] = useStateBk(null); // { name, recs, dnf, error }
  const plan = useMemoBk(() => (file?.recs?.length ? planBookImport(file.recs, books) : null), [file, books]);
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 20e6) { setFile({ name: f.name, error: "Too big to import (over 20 MB)" }); return; }
    try {
      const got = bookRecords(await f.text());
      setFile(got ? { name: f.name, ...got } : { name: f.name, error: "Not a Goodreads or StoryGraph export: no Exclusive Shelf or Read Status column" });
    } catch {
      setFile({ name: f.name, error: "Couldn't read this file" });
    }
  };
  const n = plan ? plan.added.length + plan.changed.size : 0;
  const go = () => {
    if (!n || closing) return;
    onImport(plan);
    close();
  };
  const note = { fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5 };
  const shelves = plan && BOOK_STATUSES.map((s) => plan.into[s.v] ? `${s.l} ${plan.into[s.v]}` : "").filter(Boolean).join(", ");
  return (
    <ModalFrame sheet dismiss={{ ref, closing, close }} label="Import books">
      <ModalHead eyebrow="Books" title="Import from Goodreads or StoryGraph" onClose={close} />
      <div style={{ ...note, marginBottom: 12 }}>
        Pick the CSV your library exports to. Books you already have are updated (a status moves forward, never back) and nothing is removed.
      </div>
      <div style={{ ...note, fontSize: 12.5, color: "var(--ink-faint)", marginBottom: 14 }}>
        Goodreads: on the website, My Books → Import and Export → Export Library. StoryGraph: Manage Account → Export StoryGraph Library.
        Covers and page counts are then filled in from Open Library in the background.
      </div>
      {file && (
        <div style={{ background: "var(--bg-2)", borderRadius: 16, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
          <div style={{ fontSize: 12.5, color: file.error ? "var(--danger)" : "var(--ink-dim)", marginTop: 3, lineHeight: 1.45 }}>
            {file.error || [
              plural(file.recs.length, "book"),
              file.dnf ? `${file.dnf} did-not-finish left out` : "",
            ].filter(Boolean).join(" · ")}
          </div>
          {plan && (
            <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 6, lineHeight: 1.45 }}>
              {plan.added.length} new, {plan.changed.size} updated{plan.same ? `, ${plan.same} already up to date` : ""}.{shelves && ` Into ${shelves}.`}
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button type="button" onClick={() => fileRef.current?.click()} style={ghostBtn()}>{file ? "Pick Another" : "Pick CSV File"}</button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={go} disabled={!n} style={{ ...accentBtn(), opacity: n ? 1 : 0.4 }}>{n ? `Import ${plural(n, "book")}` : "Import"}</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/comma-separated-values" onChange={pick} hidden />
      </div>
    </ModalFrame>
  );
}

Object.assign(window, {
  isBook, BOOK_STATUSES, bookStatusLabel, bookFields, bookStatusPatch, bookProgress, bookProgressLabel,
  coverUrl, bookArt, olSearch, useOlWork, useBookSearch, findBook, useBookBackfill,
  BooksView, BookRow, BookSheet, looksLikeBookCsv, bookRecords, planBookImport, BookImportSheet,
});
