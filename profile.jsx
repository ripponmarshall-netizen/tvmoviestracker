/* profile.jsx — your username, profile picture and account, what you've
   watched (time, episodes, movies, genres), awards for milestones, and
   your library's lists. */
const { useState: useStateP, useRef: useRefP } = React;

/* For titles TMDB can't time (typed in by hand, or no runtime listed). */
const EST_EPISODE_MIN = 45;
const EST_MOVIE_MIN = 110;

/* watchStats — totals over the library. A watched movie counts its
   runtime. A show counts the episodes up to your progress, or, once it's
   in Watched, every episode aired. Watchlist titles count for nothing. */
function watchStats(items) {
  const s = {
    titles: items.length, tvMin: 0, movieMin: 0, episodes: 0, movies: 0,
    showsDone: 0, rated: 0, ratingSum: 0, estimated: 0, genreTime: new Map(), genres: new Set(),
  };
  for (const it of items) {
    if (it.rating) { s.rated++; s.ratingSum += it.rating; }
    if (it.status === "watchlist") continue;
    const d = it.tmdbId ? cachedDetails(it.kind, it.tmdbId) : null;
    let min = 0;
    if (it.kind === "movie") {
      if (it.status !== "watched") continue;
      s.movies++;
      min = d?.rt || EST_MOVIE_MIN;
      s.movieMin += min;
    } else {
      const eps = it.status === "watched" ? Math.max(airedEpisodes(d), episodesWatched(it, d)) : episodesWatched(it, d);
      if (it.status === "watched") s.showsDone++;
      s.episodes += eps;
      min = eps * (d?.rt || EST_EPISODE_MIN);
      s.tvMin += min;
    }
    if (min && !d?.rt) s.estimated++;
    for (const g of d?.genres || []) s.genres.add(g);
    // Each title's time goes to its first (main) genre, so they add up.
    const g = d?.genres?.[0];
    if (min && g) s.genreTime.set(g, (s.genreTime.get(g) || 0) + min);
  }
  s.minutes = s.tvMin + s.movieMin;
  return s;
}

/* Awards, in the order you're likely to earn them. `of` reads the stat it
   tracks; time awards count minutes and show hours. Add one here. */
const BADGES = [
  { id: "first", icon: "🎬", hue: 25, name: "Opening Night", desc: "Add your first title", goal: 1, of: (s) => s.titles },
  { id: "pilot", icon: "📺", hue: 250, name: "Pilot", desc: "Watch an episode", goal: 1, of: (s) => s.episodes },
  { id: "movie1", icon: "🍿", hue: 300, name: "Movie Night", desc: "Watch a movie", goal: 1, of: (s) => s.movies },
  { id: "finish1", icon: "🏁", hue: 150, name: "Finisher", desc: "Finish a show", goal: 1, of: (s) => s.showsDone },
  { id: "critic", icon: "⭐", hue: 85, name: "Critic", desc: "Rate 10 titles", goal: 10, of: (s) => s.rated },
  { id: "day", icon: "⏰", hue: 200, name: "Full Day", desc: "24 hours watched", goal: 24 * 60, of: (s) => s.minutes, hours: true },
  { id: "eps100", icon: "🛋️", hue: 270, name: "Binge Mode", desc: "Watch 100 episodes", goal: 100, of: (s) => s.episodes },
  { id: "movie25", icon: "🎞️", hue: 320, name: "Film Buff", desc: "Watch 25 movies", goal: 25, of: (s) => s.movies },
  { id: "genres", icon: "🧭", hue: 175, name: "Genre Hopper", desc: "Watch 8 genres", goal: 8, of: (s) => s.genres.size },
  { id: "week", icon: "🗓️", hue: 230, name: "Week Off", desc: "7 days watched", goal: 7 * 24 * 60, of: (s) => s.minutes, hours: true },
  { id: "finish10", icon: "🥇", hue: 60, name: "Closer", desc: "Finish 10 shows", goal: 10, of: (s) => s.showsDone },
  { id: "eps500", icon: "🔥", hue: 35, name: "Marathoner", desc: "Watch 500 episodes", goal: 500, of: (s) => s.episodes },
  { id: "movie100", icon: "🏆", hue: 95, name: "Cinephile", desc: "Watch 100 movies", goal: 100, of: (s) => s.movies },
  { id: "month", icon: "🌙", hue: 280, name: "Night Owl", desc: "30 days watched", goal: 30 * 24 * 60, of: (s) => s.minutes, hours: true },
  { id: "eps1000", icon: "👑", hue: 50, name: "Series Royalty", desc: "Watch 1,000 episodes", goal: 1000, of: (s) => s.episodes },
];

function ProfileView({ items, tmdbKey, session, sync, avatar, setAvatar, username, onEditProfile, onOpenList, onSettings, onImportCsv, onOpenItem }) {
  // Runtimes and episode counts for everything that counts towards time.
  const pending = usePrefetchDetails(items.filter((i) => i.status !== "watchlist"), tmdbKey);
  const s = watchStats(items);
  const counts = {};
  for (const st of STATUSES) {
    const inSt = items.filter((i) => i.status === st.v);
    counts[st.v] = { all: inSt.length, tv: inSt.filter((i) => i.kind === "tv").length, movie: inSt.filter((i) => i.kind === "movie").length };
  }
  const genres = [...s.genreTime].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const tint = { watching: "var(--accent)", watchlist: "var(--tv)", watched: "var(--ok)" };
  const split = (c) => [c.tv && plural(c.tv, "show"), c.movie && plural(c.movie, "movie")].filter(Boolean).join(" · ") || "Empty";

  return (
    <main className="tvt-view tvt-page" style={{ padding: "8px 16px calc(120px + var(--safe-bottom))" }}>
      <ScreenTitle title="Profile" action={{ icon: <GearIcon size={19} />, label: "Settings", onClick: onSettings }} />
      <ProfileHeader items={items} session={session} sync={sync} avatar={avatar} setAvatar={setAvatar} username={username} onEdit={onEditProfile} />

      <SectionHeader title="Watch Time" detail={pending ? "Updating…" : null} />
      <WatchTimeCard s={s} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 26 }}>
        <StatTile label="Episodes" value={s.episodes.toLocaleString("en-GB")} color="var(--tv)" icon={<PlayIcon size={16} />} />
        <StatTile label="Movies" value={s.movies.toLocaleString("en-GB")} color="var(--movie)" icon={<CheckCircleIcon size={16} />} />
        <StatTile label="Shows finished" value={s.showsDone} color="var(--ok)" icon={<CheckIcon size={15} />} />
        <StatTile label="Your average" value={s.rated ? (s.ratingSum / s.rated).toFixed(1) : "–"} color="var(--star)" icon={<StarIcon size={15} filled />} />
      </div>

      <ActivitySection items={items} tmdbKey={tmdbKey} onOpenItem={onOpenItem} onImportCsv={onImportCsv} />
      <div style={{ height: 16 }} />

      {genres.length > 0 && (
        <>
          <SectionHeader title="Top Genres" />
          <Card style={{ marginBottom: 26 }}>
            {genres.map(([name, min], i) => (
              <div key={name} style={{ marginTop: i ? 14 : 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14.5, marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{name}</span>
                  <span className="mono" style={{ color: "var(--ink-dim)" }}>{fmtRuntime(min)}</span>
                </div>
                <ProgressBar value={min / genres[0][1]} height={6} />
              </div>
            ))}
          </Card>
        </>
      )}

      <AwardsSection s={s} />

      <SectionHeader title="Library" />
      <ListRows rows={STATUSES.map((st) => ({
        key: st.v, icon: <st.icon size={18} />, tint: tint[st.v], label: st.l, sub: split(counts[st.v]),
        detail: counts[st.v].all, onClick: () => onOpenList(st.v),
      }))} />

      <SectionHeader title="Import" />
      <ListRows rows={[
        { key: "csv", icon: <UploadIcon size={18} />, tint: "var(--movie)", label: "Import CSV", sub: "From another tracker or a spreadsheet", onClick: onImportCsv },
      ]} />

      <HowCounted s={s} />
      <div className="mono" style={{ fontSize: 12, color: "var(--ink-faint)", textAlign: "center", marginTop: 18 }}>
        {APP_NAME} v{APP_VERSION}
      </div>
    </main>
  );
}

/* Your picture (tap it to change it), name and sync, and what's in your
   library at a glance. */
function ProfileHeader({ items, session, sync, avatar, setAvatar, username, onEdit }) {
  const [input, choose] = useAvatarInput(setAvatar);
  const email = session?.user?.email || "";
  const first = Math.min(...items.map((i) => isoTime(i.added)).filter(Boolean));
  const since = Number.isFinite(first) ? new Date(first).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "";
  const tally = [
    { l: "Titles", n: items.length },
    { l: "Shows", n: items.filter((i) => i.kind === "tv").length },
    { l: "Movies", n: items.filter((i) => i.kind === "movie").length },
  ];
  return (
    <section style={{
      position: "relative", overflow: "hidden", textAlign: "center", marginBottom: 26, padding: "24px 18px 18px",
      background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 24,
    }}>
      {/* A wash of the accent behind the picture. */}
      <span aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 0, height: 120, background: "linear-gradient(180deg, color-mix(in oklab, var(--accent) 22%, transparent), transparent)", pointerEvents: "none" }} />
      <button type="button" onClick={choose} aria-label={avatar ? "Change profile picture" : "Add a profile picture"} style={{
        position: "relative", display: "inline-flex", padding: 3, margin: 0, borderRadius: 999, cursor: "pointer",
        background: "var(--bg-1)", border: "none", boxShadow: "0 12px 30px -14px rgba(0,0,0,0.7)",
      }}>
        <Avatar src={avatar} name={username} email={email} size={92} />
        <span aria-hidden style={{
          position: "absolute", right: 0, bottom: 0, width: 30, height: 30, borderRadius: 999,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "var(--accent)", color: "var(--accent-ink)", border: "3px solid var(--bg-1)",
        }}><CameraIcon size={14} /></span>
      </button>
      {input}
      <div style={{ position: "relative", marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {username ? (
            <div key={username} className="tvt-pop" style={{ fontSize: 25, fontWeight: 700, letterSpacing: "-0.02em", overflowWrap: "anywhere", minWidth: 0 }}>{username}</div>
          ) : (
            <button type="button" onClick={onEdit} style={{ background: "none", border: "none", padding: "2px 6px", color: "var(--accent)", fontSize: 19, fontWeight: 600, cursor: "pointer" }}>
              Set a username
            </button>
          )}
          {session && <SyncBadge sync={sync} />}
        </div>
        {email && <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 4, lineHeight: 1.4, overflowWrap: "anywhere" }}>{email}</div>}
        {since && <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 4 }}>Tracking since {since}</div>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", margin: "16px 0 14px", padding: "12px 0", borderTop: "1px solid var(--line-soft)", borderBottom: "1px solid var(--line-soft)" }}>
        {tally.map((t, i) => (
          <div key={t.l} style={{ borderLeft: i ? "1px solid var(--line-soft)" : "none" }}>
            <div key={t.n} className="mono tvt-pop" style={{ fontSize: 21, fontWeight: 700 }}>{t.n.toLocaleString("en-GB")}</div>
            <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 1 }}>{t.l}</div>
          </div>
        ))}
      </div>
      <button type="button" onClick={onEdit} style={{ ...ghostBtn(), borderRadius: 999, padding: "9px 20px", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <PencilIcon size={15} />Edit Profile
      </button>
    </section>
  );
}

/* Sync, as a small tick in a circle beside your name: a faded green one
   once synced (fainter while it syncs, and pulsing), grey offline, red if
   it failed. Tap it for the details; offline or failed, a tap tries again. */
function SyncBadge({ sync }) {
  const { state } = sync.status;
  const label = syncLabel(sync.status);
  const look = {
    ok: { c: "var(--ok)", o: 0.75 },
    syncing: { c: "var(--ok)", o: 0.45, pulse: true },
    idle: { c: "var(--ok)", o: 0.45 },
    offline: { c: "var(--ink-faint)", o: 0.8 },
    error: { c: "var(--danger)", o: 0.9, alert: true },
  }[state] || { c: "var(--ink-faint)", o: 0.6 };
  const tap = () => {
    showToast(label);
    if (state === "error" || state === "offline") sync.syncNow();
  };
  return (
    <button type="button" onClick={tap} aria-label={label} title={label} style={{
      flexShrink: 0, width: 26, height: 26, padding: 0, margin: 0, border: "none", background: "none", cursor: "pointer",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
    }}>
      <span key={state} className={look.pulse ? "tvt-skel" : "tvt-pop"} style={{
        width: 20, height: 20, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: look.c, opacity: look.o, background: `color-mix(in oklab, ${look.c} 20%, transparent)`,
        boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${look.c} 55%, transparent)`,
      }}>
        {look.alert ? <span aria-hidden style={{ fontSize: 13, fontWeight: 800, lineHeight: 1 }}>!</span> : <CheckIcon size={12} />}
      </span>
    </button>
  );
}

/* Awards: the ones you've earned and the nearest to earning first, eight
   on show and the rest under Show All. */
function AwardsSection({ s }) {
  const [open, toggle] = useFold("profile:awards", false);
  const frac = (b) => Math.min(1, b.of(s) / b.goal);
  const sorted = [...BADGES].sort((a, b) => (frac(b) >= 1) - (frac(a) >= 1) || frac(b) - frac(a));
  const earned = BADGES.filter((b) => frac(b) >= 1).length;
  const grid = (list) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px 4px" }}>
      {list.map((b) => <BadgeMedal key={b.id} badge={b} value={b.of(s)} />)}
    </div>
  );
  return (
    <>
      <SectionHeader title="Awards" detail={`${earned} of ${BADGES.length}`} />
      <Card style={{ marginBottom: 26, padding: "16px 8px 4px" }}>
        {grid(sorted.slice(0, 8))}
        <Collapse open={open}><div style={{ paddingTop: 14 }}>{grid(sorted.slice(8))}</div></Collapse>
        <button type="button" onClick={toggle} aria-expanded={open} style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", marginTop: 8, padding: "8px 0",
          background: "none", border: "none", color: "var(--accent)", fontSize: 14, cursor: "pointer",
        }}>
          {open ? "Show Fewer" : `Show All ${BADGES.length}`}
          <span style={{ display: "inline-flex", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.3s var(--ease-snappy)" }}><ChevronIcon dir="down" size={13} /></span>
        </button>
      </Card>
    </>
  );
}

/* The fine print on how watch time is worked out, folded away. */
function HowCounted({ s }) {
  const [open, toggle] = useFold("profile:how", false);
  return (
    <div style={{ margin: "4px 4px 0" }}>
      <button type="button" onClick={toggle} aria-expanded={open} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 0",
        background: "none", border: "none", color: "var(--ink-dim)", fontSize: 13.5, textAlign: "left", cursor: "pointer",
      }}>
        <span style={{ flex: 1 }}>How watch time is counted</span>
        <FoldChevron open={open} size={12} />
      </button>
      <Collapse open={open}>
        <div style={{ fontSize: 12.5, color: "var(--ink-faint)", lineHeight: 1.5, paddingBottom: 4 }}>
          Times use TMDB's runtimes. A show counts the episodes up to your progress, or all of them once it's in Watched;
          a show in Not Started counts nothing until you tick an episode or mark it caught up. Watchlist titles don't count.
          {s.estimated > 0 && ` ${plural(s.estimated, "title")} without a runtime ${s.estimated === 1 ? "is" : "are"} estimated at 45 min an episode or 1h 50m a movie.`}
        </div>
      </Collapse>
    </div>
  );
}

/* ============ Profile picture ============
   Cropped to a square and shrunk to 256px on the device, then kept as a
   JPEG data: URL (about 20–40 KB): in local storage, and in your profile
   when you're signed in, so it needs no storage bucket. */
const AVATAR_PX = 256;
const AVATAR_MAX = 400000; // characters; a 256px JPEG is a tenth of this

/* A saved or synced picture, or "" if it isn't one. */
function cleanAvatar(v) {
  return typeof v === "string" && v.length <= AVATAR_MAX && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(v) ? v : "";
}

/* A picked photo as a square avatar, centred. Rejects with a message to show. */
async function avatarFromFile(file) {
  if (file.type && !file.type.startsWith("image/")) throw new Error("That file isn't a photo");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Couldn't open that photo"));
      im.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h);
    if (!side) throw new Error("Couldn't open that photo");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_PX;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#808080"; // behind a transparent PNG, which JPEG can't keep
    ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
    const out = cleanAvatar(canvas.toDataURL("image/jpeg", 0.85));
    if (!out) throw new Error("Couldn't use that photo");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* A hidden photo picker: returns the <input> to render and a function that
   opens it. On iPhone it offers the photo library, the camera and Files. */
function useAvatarInput(setAvatar) {
  const ref = useRefP(null);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same photo again still fires
    if (!file) return;
    try {
      setAvatar(await avatarFromFile(file));
      showToast("Profile picture updated");
    } catch (err) {
      showToast(err.message || "Couldn't use that photo");
    }
  };
  return [<input ref={ref} type="file" accept="image/*" onChange={pick} hidden />, () => ref.current?.click()];
}

/* The picture in a circle; without one, your initial (or a person). */
function Avatar({ src, name, email, size = 56 }) {
  const initial = Array.from(name || email || "")[0]?.toUpperCase();
  return (
    <span aria-hidden style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0, overflow: "hidden",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(145deg, color-mix(in oklab, var(--accent) 85%, #fff), color-mix(in oklab, var(--accent) 60%, #000))",
      color: "#fff", fontSize: Math.round(size * 0.43), fontWeight: 700,
    }}>
      {src ? <img key={src} src={src} alt="" className="tvt-pop" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : initial || <PersonIcon size={Math.round(size / 2)} />}
    </span>
  );
}

/* Settings: the picture, with Choose and Remove. */
function AvatarPicker({ avatar, setAvatar, name, email, stacked }) {
  const [input, choose] = useAvatarInput(setAvatar);
  const remove = () => {
    const before = avatar;
    setAvatar("");
    showToast("Profile picture removed", { action: { label: "Undo", onClick: () => setAvatar(before) } });
  };
  return (
    <div style={{ display: "flex", flexDirection: stacked ? "column" : "row", alignItems: "center", gap: 12 }}>
      <Avatar src={avatar} name={name} email={email} size={stacked ? 88 : 52} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={choose} style={ghostBtn()}>{avatar ? "Change Photo" : "Choose Photo"}</button>
        {avatar && <button type="button" onClick={remove} style={{ ...ghostBtn(), color: "var(--danger)" }}>Remove</button>}
      </div>
      {input}
    </div>
  );
}

/* Total time, big, as Screen Time shows it, with a bar split between shows
   and movies. */
function WatchTimeCard({ s }) {
  const d = Math.floor(s.minutes / 1440), h = Math.floor((s.minutes % 1440) / 60), m = Math.round(s.minutes % 60);
  const parts = [d && [d, "d"], (d || h) && [h, "h"], [m, "m"]].filter(Boolean);
  const share = s.minutes ? s.tvMin / s.minutes : 0;
  const legend = [
    { l: "Shows", c: "var(--chart-tv)", min: s.tvMin, n: plural(s.episodes, "episode") },
    { l: "Movies", c: "var(--chart-movie)", min: s.movieMin, n: plural(s.movies, "movie") },
  ];
  return (
    <Card style={{ marginBottom: 10 }}>
      <div className="label">Total watched</div>
      <div aria-label={`${fmtRuntime(s.minutes) || "0m"} watched`} style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
        {parts.map(([n, u]) => (
          <span key={u} aria-hidden>
            <span key={n} className="mono tvt-pop" style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em" }}>{n}</span>
            <span style={{ fontSize: 18, fontWeight: 600, color: "var(--ink-dim)", marginLeft: 2 }}>{u}</span>
          </span>
        ))}
      </div>
      <div style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 2 }}>
        {Math.round(s.minutes / 60).toLocaleString("en-GB")} hours across {plural(s.titles, "title")}
      </div>
      <div aria-hidden style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--fill)", margin: "16px 0 12px" }}>
        <span style={{ width: `${share * 100}%`, background: "var(--chart-tv)", transition: "width 0.6s var(--ease-snappy)" }} />
        <span style={{ width: `${s.minutes ? (1 - share) * 100 : 0}%`, background: "var(--chart-movie)", transition: "width 0.6s var(--ease-snappy)" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {legend.map((x) => (
          <div key={x.l}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-dim)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: x.c }} />{x.l}
            </div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{fmtRuntime(x.min) || "0m"}</div>
            <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>{x.n}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatTile({ label, value, color, icon }) {
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 18, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-dim)" }}>
        <span style={{ color, display: "inline-flex" }}>{icon}</span>{label}
      </div>
      <div key={value} className="mono tvt-pop" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 4 }}>{value}</div>
    </div>
  );
}

/* An award: a small coloured medal once earned; until then a faded one in
   a ring that fills as you get closer. Tap it for what it's for. */
function BadgeMedal({ badge, value }) {
  const got = value >= badge.goal;
  const frac = Math.min(1, value / badge.goal);
  const SIZE = 50, R = 23, C = 2 * Math.PI * R;
  const show = (n) => (badge.hours ? Math.floor(n / 60) : n).toLocaleString("en-GB");
  const progress = `${show(value)} / ${show(badge.goal)}${badge.hours ? " h" : ""}`;
  const h = badge.hue;
  const explain = () => showToast(`${badge.icon} ${badge.name}: ${badge.desc}${got ? " · Earned" : ` · ${progress}`}`);
  return (
    <button type="button" onClick={explain} aria-label={`${badge.name}: ${badge.desc}. ${got ? "Earned" : progress}`} style={{
      minWidth: 0, padding: "2px 0", margin: 0, background: "none", border: "none", color: "inherit", font: "inherit", textAlign: "center", cursor: "pointer",
    }}>
      <span aria-hidden style={{ position: "relative", display: "block", width: SIZE, height: SIZE, margin: "0 auto" }}>
        {!got && (
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--fill)" strokeWidth="3" />
            {frac > 0 && <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${frac * C} ${C}`} />}
          </svg>
        )}
        <span className={got ? "tvt-pop" : undefined} style={{
          position: "absolute", inset: got ? 2 : 6, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: got ? 22 : 18,
          background: got
            ? `radial-gradient(circle at 32% 26%, oklch(90% 0.1 ${h}), oklch(66% 0.17 ${h}) 52%, oklch(44% 0.15 ${h + 25}))`
            : "var(--bg-2)",
          boxShadow: got ? `inset 0 0 0 2px rgba(255,255,255,0.35), inset 0 -4px 8px rgba(0,0,0,0.18), 0 6px 14px -8px oklch(45% 0.18 ${h})` : "none",
          filter: got ? "none" : "grayscale(1)", opacity: got ? 1 : 0.45,
        }}>{badge.icon}</span>
      </span>
      <span className="tvt-clamp-2" style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.2, marginTop: 6, color: got ? "var(--ink)" : "var(--ink-dim)" }}>{badge.name}</span>
      {!got && <span className="mono" style={{ display: "block", fontSize: 10.5, color: "var(--ink-faint)", marginTop: 2 }}>{progress}</span>}
    </button>
  );
}

/* Rows grouped as in iOS Settings: a tinted icon, a label (and a line
   under it), a detail on the right and a chevron. Each row is { key, icon,
   tint, label, sub, detail, onClick }. */
function ListRows({ rows }) {
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 20, overflow: "hidden", marginBottom: 26 }}>
      {rows.map((r, i) => (
        <button key={r.key} type="button" className="tvt-wide-btn" onClick={r.onClick} style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "0 14px", margin: 0,
          background: "transparent", border: "none", textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer",
        }}>
          <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: r.tint || "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            {r.icon}
          </span>
          {/* The divider starts after the icon, as in iOS lists. */}
          <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, padding: r.sub ? "11px 0" : "14px 0", borderTop: i ? "1px solid var(--line-soft)" : "none" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 16 }}>{r.label}</span>
              {r.sub && <span style={{ display: "block", fontSize: 12.5, color: "var(--ink-dim)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.sub}</span>}
            </span>
            {r.detail != null && <span className="mono" style={{ fontSize: 15, color: "var(--ink-dim)" }}>{r.detail}</span>}
            <span style={{ color: "var(--ink-faint)", display: "inline-flex" }}><ChevronIcon size={13} /></span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* ============ Username ============
   What Profile calls you: up to USERNAME_MAX characters, any but control
   characters. Kept on the device and, signed in, in your profile (the
   username column of tvt_profiles), so it follows you. */
const USERNAME_MAX = 24;
function cleanUsername(v) {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, USERNAME_MAX) : "";
}

/* Edit Profile: the picture and the username. */
function ProfileSheet({ username, setUsername, avatar, setAvatar, email, signedIn, onClose }) {
  const { ref, closing, close } = useModalDismiss(onClose);
  const [name, setName] = useStateP(username);
  const clean = cleanUsername(name);
  const save = (e) => {
    e.preventDefault();
    if (closing) return;
    if (clean !== username) {
      setUsername(clean);
      showToast(clean ? `Username set to ${clean}` : "Username cleared");
    }
    close();
  };
  return (
    <ModalFrame sheet dismiss={{ ref, closing, close }} label="Edit profile">
      <form onSubmit={save}>
        <ModalHead title="Edit Profile" onClose={close} />
        <div style={{ display: "flex", justifyContent: "center", margin: "4px 0 18px" }}>
          <AvatarPicker avatar={avatar} setAvatar={setAvatar} name={clean} email={email} stacked />
        </div>
        <Field label="Username" htmlFor="tvt-username">
          <input id="tvt-username" value={name} onChange={(e) => setName(e.target.value)} placeholder="What should Nostalgiaa call you?"
            maxLength={USERNAME_MAX + 10} autoComplete="nickname" autoCapitalize="words" spellCheck={false} enterKeyHint="done" style={fieldStyle()} />
          <div style={{ display: "flex", gap: 10, fontSize: 12.5, color: "var(--ink-faint)", marginTop: 8, lineHeight: 1.4 }}>
            <span style={{ flex: 1 }}>{signedIn ? "Shown on your profile, and synced to your other devices." : "Shown on your profile. Sign in to sync it."}</span>
            <span className="mono" style={{ color: name.trim().length > USERNAME_MAX ? "var(--danger)" : undefined }}>{clean.length}/{USERNAME_MAX}</span>
          </div>
        </Field>
        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button type="button" onClick={close} style={ghostBtn()}>Cancel</button>
          <button type="submit" style={accentBtn()}>Save</button>
        </div>
      </form>
    </ModalFrame>
  );
}

Object.assign(window, { watchStats, BADGES, ProfileView, cleanAvatar, Avatar, AvatarPicker, cleanUsername, ProfileSheet, ListRows });
