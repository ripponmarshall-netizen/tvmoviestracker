/* detail.jsx — the title sheet: big artwork, the facts (rating, dates,
   runtime) in a strip like the App Store's, your status, progress and
   rating, where to watch it, its schedule, facts from Wikidata, Trakt's
   numbers, and more like it. It opens for titles in your library and for
   ones from Explore; picking a status adds a new one. */
const { useState: useStateD, useEffect: useEffectD } = React;

/* The library item a sheet is about: by id, else by TMDB id. */
function findInLibrary(items, t) {
  return (t.itemId && items.find((i) => i.id === t.itemId))
    || (t.tmdbId && items.find((i) => i.tmdbId === t.tmdbId && i.kind === t.kind))
    || null;
}

function TitleSheet({ target, items, tmdbKey, region, onStatus, onAdvance, onPatch, onCatchUp, onEdit, onDelete, onClose }) {
  const { ref, closing, close } = useModalDismiss(onClose);
  // A title from "More Like This" opens in the same sheet; Back returns.
  const [stack, setStack] = useStateD([target]);
  const top = stack[stack.length - 1];
  const item = findInLibrary(items, top);
  const kind = item ? item.kind : top.kind;
  const tmdbId = item ? item.tmdbId : top.tmdbId;
  const { d, recs, error, loading } = useTitleDetails(kind, tmdbId, tmdbKey);
  useEffectD(() => { if (ref.current) ref.current.scrollTop = 0; }, [stack.length]);
  // Once the big title has scrolled away, a bar with the title takes its
  // place, as an iOS navigation bar does.
  const [barOn, setBarOn] = useStateD(false);
  useEffectD(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setBarOn(el.scrollTop > 330);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const tv = kind === "tv";
  const title = item?.title || top.title || d?.title || "";
  const art = { title, kind, poster: item?.poster || top.poster || d?.poster || "" };
  const date = d?.date || top.date || "";
  const year = date.slice(0, 4) || item?.year || top.year || "";
  const meta = [tv ? "Show" : "Movie", d?.genres?.slice(0, 2).join(", "), year, tv && d?.status && d.status !== "Returning Series" ? d.status : ""]
    .filter(Boolean).join(" · ");
  const overview = d?.overview || top.overview || "";
  const more = (recs || []).filter((t) => !(t.kind === kind && t.tmdbId === tmdbId)).slice(0, 15);
  // TVmaze, for a show: once TMDB's details are in (they carry the ids
  // that find it for certain), or straight away without them.
  const ready = !tmdbId || !tmdbKey || d || error;
  const nextUp = item && tv && item.status === "watching" ? nextEpisode(item, d) : null;
  const air = useTvmaze(tv && title && ready ? { tmdbId, title, year, imdb: d?.imdb || "", tvdb: d?.tvdb || 0 } : null,
    nextUp ? { s: nextUp.season, e: nextUp.episode } : null);
  // Wikidata, once TMDB's details are in (they carry the IMDb id, a
  // second way to find it), or straight away without a key.
  const wiki = useWikidata(tmdbId && ready ? { kind, tmdbId, imdb: d?.imdb || "" } : null);
  const trakt = useTraktStats(kind, tmdbId);
  const remove = () => { onDelete(item.id); close(); };

  return (
    <ModalFrame sheet flush dismiss={{ ref, closing, close }} label={title}>
      {/* Stays at the top of the sheet as it scrolls. */}
      <div className={barOn ? "tvt-sheet-top is-barred" : "tvt-sheet-top"}>
        <div className="tvt-sheet-bar" aria-hidden>{title}</div>
        {stack.length > 1 && (
          <button type="button" onClick={() => setStack((s) => s.slice(0, -1))} aria-label="Back" className="tvt-glass-btn" style={{ left: 12 }}>
            <ChevronIcon dir="left" size={17} />
          </button>
        )}
        <button type="button" onClick={close} aria-label="Close" className="tvt-glass-btn" style={{ right: 12 }}><XIcon size={12} /></button>
      </div>

      {/* Keyed by depth, so a title opened from "More Like This" rises in. */}
      <div key={stack.length} className={stack.length > 1 ? "tvt-view" : undefined}>
        <div style={{ position: "relative", height: 250, overflow: "hidden" }}>
          <Backdrop path={d?.backdrop || top.backdrop} poster={art.poster} title={title} size="w1280" />
          <span aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 30%, color-mix(in oklab, var(--bg-1) 55%, transparent) 70%, var(--bg-1) 100%)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: -186, position: "relative" }}>
          <span className="tvt-detail-poster" style={{ borderRadius: 14, boxShadow: "0 26px 50px -22px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)" }}>
            <Poster item={art} size={184} ratio={1.5} radius={14} stripe={false} />
          </span>
        </div>

        <div style={{ textAlign: "center", padding: "18px 22px 0" }}>
          <h2 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, overflowWrap: "anywhere" }}>{title}</h2>
          <div style={{ fontSize: 13.5, color: "var(--ink-dim)", marginTop: 6 }}>{meta}</div>
        </div>

        {tmdbId ? (
          <InfoStrip cells={infoCells(tv, d, top, date, year, loading)} />
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)", textAlign: "center", lineHeight: 1.4, padding: "12px 28px 0" }}>
            Typed in by hand. Use Edit to link it to TMDB for ratings, dates and runtimes.
          </div>
        )}
        {error && !d && <div style={{ fontSize: 12.5, color: "var(--ink-faint)", textAlign: "center", padding: "10px 24px 0" }}>{error}</div>}
        {tmdbId && !tmdbKey && !d && (
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)", textAlign: "center", padding: "10px 24px 0" }}>Add a TMDB key in Settings for ratings, dates and runtimes.</div>
        )}

        <div style={{ padding: "20px 16px 0" }}>
          <StatusTiles status={item?.status} onPick={(s) => onStatus(top, s)} />
        </div>

        {item && tv && item.status === "watching" && (
          <ProgressSection item={item} d={d} onAdvance={onAdvance} onPatch={onPatch} onCatchUp={onCatchUp} />
        )}

        {item && (
          <DetailSection title="Your Rating">
            <RatingInput value={item.rating} onChange={(v) => onPatch(item.id, { rating: v })} />
          </DetailSection>
        )}

        <WhereToWatch d={d} region={region} />

        {tv && <AirSection m={air} mine={nextUp && { s: nextUp.season, e: nextUp.episode }} />}

        {(overview || d?.tagline) && (
          <DetailSection title="About">
            {d?.tagline && <div style={{ fontSize: 15, fontStyle: "italic", color: "var(--ink-dim)", marginBottom: 6 }}>{d.tagline}</div>}
            <Overview key={overview} text={overview} />
            {d?.network && <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 8 }}>On {d.network}</div>}
          </DetailSection>
        )}

        <WikidataSection w={wiki} />
        <TraktSection s={trakt} />

        {item?.note && (
          <DetailSection title="Your Note">
            <div style={{ fontSize: 15, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.note}</div>
          </DetailSection>
        )}

        {more.length > 0 && (
          <div style={{ padding: "26px 16px 0" }}>
            <Shelf title="More Like This">
              {more.map((t) => (
                <PosterCard key={titleKey(t.kind, t.tmdbId)} tile={t} width={104} status={findInLibrary(items, t)?.status}
                  onOpen={(tile) => setStack((s) => [...s, tile])} />
              ))}
            </Shelf>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, padding: more.length ? "0 16px" : "26px 16px 0" }}>
          {item && <button type="button" onClick={() => onEdit(item)} style={{ ...ghostBtn(), flex: 1 }}>Edit Details</button>}
          {item && <button type="button" onClick={remove} style={{ ...ghostBtn(), flex: 1, color: "var(--danger)" }}>Remove</button>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ink-faint)", textAlign: "center", lineHeight: 1.4, padding: "14px 24px calc(22px + var(--safe-bottom))" }}>
          {[tmdbId && "Details from TMDB", providersFor(d) && "Streaming data from JustWatch", air?.id && (
            <React.Fragment key="tvmaze">Schedule from <a href={air.url} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>TVmaze</a> (CC BY-SA)</React.Fragment>
          ), wiki?.id && "Facts from Wikidata", trakt?.slug && "Stats from Trakt"].filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]))}
        </div>
      </div>
    </ModalFrame>
  );
}

/* The facts strip: rating, when it came out, how long it runs and, for a
   show, its seasons (genres are in the line under the title). Until
   details arrive, what the tile knew. */
function infoCells(tv, d, top, date, year, loading) {
  const dash = loading ? "…" : "–";
  const vote = d ? d.vote : top.vote || 0;
  const votes = d ? d.votes : top.votes || 0;
  const future = date && Date.parse(date) > Date.now();
  const cells = [
    { label: "Rating", value: votes ? <>{vote.toFixed(1)}<span style={{ color: "var(--star)", marginLeft: 3, display: "inline-flex", verticalAlign: "1px" }}><StarIcon size={14} filled /></span></> : dash, sub: votes ? `${fmtCount(votes)} ratings` : "on TMDB" },
    { label: tv ? "First aired" : future ? "Coming" : "Released", value: year || dash, sub: date ? fmtDate(date, DATE_SHORT) : "" },
    { label: tv ? "Episode" : "Duration", value: d?.rt ? fmtRuntime(d.rt) : dash, sub: d?.rt ? (tv ? "per episode" : `${d.rt} minutes`) : "" },
  ];
  if (tv) {
    const n = d?.seasons ? Object.keys(d.seasons).length : 0;
    cells.push({ label: "Seasons", value: n || dash, sub: d?.seasons ? plural(airedEpisodes(d), "episode") : "" });
  }
  return cells;
}

/* Fits a phone's width; scrolls sideways if a cell runs long. `flat`
   drops the rules above and below, for a strip inside a card. */
function InfoStrip({ cells, flat }) {
  return (
    <div className="tvt-strip" role="list" style={{ display: "flex", overflowX: "auto", margin: flat ? 0 : "20px 0 0", padding: "12px 4px", borderTop: flat ? "none" : "1px solid var(--line-soft)", borderBottom: flat ? "none" : "1px solid var(--line-soft)" }}>
      {cells.map((c, i) => (
        <div key={c.label} role="listitem" style={{ flex: "1 0 auto", textAlign: "center", padding: "0 8px", borderLeft: i ? "1px solid var(--line-soft)" : "none" }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--ink-faint)", whiteSpace: "nowrap" }}>{c.label}</div>
          <div className="mono" style={{ fontSize: 20, fontWeight: 700, marginTop: 4, whiteSpace: "nowrap" }}>{c.value}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-dim)", marginTop: 3, whiteSpace: "nowrap" }}>{c.sub || " "}</div>
        </div>
      ))}
    </div>
  );
}

/* Three tiles, one per status. The lit one is where it is; tapping
   another moves it (or adds it, for a title not in your library). */
function StatusTiles({ status, onPick }) {
  return (
    <div role="radiogroup" aria-label={status ? "Status" : "Add to"} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {STATUSES.map((s) => {
        const Icon = s.icon;
        const on = s.v === status;
        return (
          <button key={s.v} type="button" role="radio" aria-checked={on} onClick={() => onPick(s.v)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "12px 4px 10px",
            borderRadius: 16, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
            background: on ? "var(--accent)" : "var(--fill)", color: on ? "var(--accent-ink)" : "var(--ink)",
            transition: "background-color 0.2s ease, color 0.2s ease, var(--press)",
          }}>
            <span key={on ? "on" : "off"} className={on ? "tvt-tab-pop" : undefined} style={{ display: "inline-flex" }}><Icon size={22} /></span>
            {status ? s.l : `+ ${s.l}`}
          </button>
        );
      })}
    </div>
  );
}

/* Where to Watch: the services with it in your country (TMDB's data,
   from JustWatch), by how you'd watch it, else the US's. Tapping a service
   opens TMDB's page for the title, which links on to each one. */
const PROVIDER_LABELS = { stream: "Stream", free: "Free", ads: "Free with ads", rent: "Rent", buy: "Buy" };
function regionName(code) {
  try { return new Intl.DisplayNames(["en-GB"], { type: "region" }).of(code) || code; } catch { return code; }
}
function WhereToWatch({ d, region }) {
  const p = providersFor(d);
  if (!p) return null;
  const rows = Object.keys(PROVIDER_LABELS).filter((k) => p[k]);
  return (
    <DetailSection title="Where to Watch">
      {p.region !== region && (
        <div style={{ fontSize: 12.5, color: "var(--ink-dim)", lineHeight: 1.4, marginBottom: 10 }}>
          JustWatch has nothing listed for {regionName(region)}, so this is {regionName(p.region)}. A VPN or a local service may differ.
        </div>
      )}
      <div style={{ background: "var(--bg-2)", borderRadius: 16, padding: "2px 14px" }}>
        {rows.map((k, i) => (
          <div key={k} style={{ padding: "11px 0", borderTop: i ? "1px solid var(--line-soft)" : "none" }}>
            <div className="label">{PROVIDER_LABELS[k]}</div>
            <div className="tvt-strip" style={{ display: "flex", gap: 12, overflowX: "auto", marginTop: 8 }}>
              {p[k].map(([id, name, logo]) => (
                <a key={id} href={p.link || undefined} target="_blank" rel="noopener noreferrer" title={name} style={{ width: 60, flexShrink: 0, textAlign: "center", color: "inherit", textDecoration: "none" }}>
                  <span style={{ display: "block", width: 48, height: 48, margin: "0 auto", borderRadius: 12, overflow: "hidden", background: "var(--bg-3)", boxShadow: "0 0 0 1px var(--line-soft)" }}>
                    {logo && <img src={posterUrl(logo, "w92")} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  </span>
                  <span className="tvt-clamp-2" style={{ fontSize: 11, color: "var(--ink-dim)", lineHeight: 1.2, marginTop: 5 }}>{name}</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 8 }}>
        In {regionName(p.region)} · from JustWatch{p.link && <> · <a href={p.link} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>All options</a></>}
      </div>
    </DetailSection>
  );
}

function DetailSection({ title, children }) {
  return (
    <section style={{ padding: "24px 20px 0" }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 19, fontWeight: 700, letterSpacing: "-0.015em" }}>{title}</h3>
      {children}
    </section>
  );
}

/* Up next, progress through what's aired, a tick for the next episode,
   "caught up" (straight to the latest episode out) and dropdowns to pick
   the season and episode you're on. */
function ProgressSection({ item, d, onAdvance, onPatch, onCatchUp }) {
  const info = upNextInfo(item, d);
  const aired = airedEpisodes(d);
  const watched = episodesWatched(item, d);
  const latest = latestAired(d);
  const behind = latest && (item.season < latest.season || (item.season === latest.season && item.episode < latest.episode));
  return (
    <DetailSection title="Your Progress">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label">{info.line === "All caught up" ? "Caught up" : "Up next"}</div>
          <div key={info.line} className="mono tvt-pop" style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{info.line}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 2 }}>{info.sub}</div>
        </div>
        {info.canTick && (
          <button type="button" onClick={() => onAdvance(item.id)} style={{ ...accentBtn(), display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "10px 16px", minHeight: 40 }}>
            {/* Not plain "Watched": that's also a status tile above. */}
            <CheckIcon size={16} />{info.tick === "Watched" ? "Mark Watched" : info.tick}
          </button>
        )}
      </div>
      {aired > 0 && (
        <div style={{ marginTop: 12 }}>
          <ProgressBar value={watched / aired} height={6} />
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 6 }}>{Math.min(watched, aired)} of {plural(aired, "episode")} watched</div>
        </div>
      )}
      <div className="label" style={{ margin: "16px 0 6px" }}>Last episode watched</div>
      <EpisodePicker season={item.season} episode={item.episode} d={d} onChange={(p) => onPatch(item.id, p)} />
      {behind && (
        <button type="button" onClick={() => onCatchUp(item.id)} style={{ ...ghostBtn(), width: "100%", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <ForwardIcon size={16} />I'm Caught Up
          <span className="mono" style={{ color: "var(--ink-dim)" }}>· S{latest.season} E{latest.episode}</span>
        </button>
      )}
    </DetailSection>
  );
}

const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/* EpisodePicker — two dropdowns: the season, and the last episode watched
   in it (0: none of it yet). With TMDB details they list the show's real
   seasons and episodes, marking ones not out yet; without, a generous
   range. Moving on to a later season starts it at episode 0; going back
   keeps the episode, within that season's length. onChange gets
   { season, episode }. */
function EpisodePicker({ season, episode, d, onChange }) {
  const known = d?.seasons ? Object.keys(d.seasons).map(Number).sort((a, b) => a - b) : [];
  const seasons = [...new Set([...(known.length ? known : range(1, Math.max(15, season + 3))), season])].sort((a, b) => a - b);
  const count = (s) => d?.seasons?.[s] || 0;
  const eps = range(0, Math.max(count(season) || 40, episode));
  const out = (s, e) => d?.last && (s > d.last[0] || (s === d.last[0] && e > d.last[1]));
  const seasonOpts = seasons.map((s) => ({ v: s, short: `Season ${s}`, l: `Season ${s}${count(s) ? ` · ${plural(count(s), "episode")}` : ""}${out(s, 1) ? " (not out yet)" : ""}` }));
  const epOpts = eps.map((e) => ({ v: e, short: e ? `Episode ${e}` : "None yet", l: e ? `Episode ${e}${out(season, e) ? " (not out yet)" : ""}` : "None of this season yet" }));
  const pickSeason = (v) => {
    const s = Number(v);
    if (s === season) return;
    onChange({ season: s, episode: s > season ? 0 : Math.min(episode, count(s) || episode) });
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <Picker label="Season" value={season} options={seasonOpts} onChange={pickSeason} />
      <Picker label="Episode" value={episode} options={epOpts} onChange={(v) => onChange({ season, episode: Number(v) })} />
    </div>
  );
}

/* The synopsis, four lines until you tap More. */
function Overview({ text }) {
  const [open, setOpen] = useStateD(false);
  if (!text) return null;
  const long = text.length > 220;
  return (
    <div>
      <div className={open || !long ? undefined : "tvt-clamp-4"} style={{ fontSize: 15, lineHeight: 1.45 }}>{text}</div>
      {long && !open && (
        <button type="button" onClick={() => setOpen(true)} style={{ background: "none", border: "none", padding: "4px 0", color: "var(--accent)", fontSize: 15, cursor: "pointer" }}>More</button>
      )}
    </div>
  );
}

Object.assign(window, { findInLibrary, TitleSheet, EpisodePicker, InfoStrip, DetailSection, regionName });
