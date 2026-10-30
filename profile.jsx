/* profile.jsx — your account and profile picture, what you've watched
   (time, episodes, movies, genres), awards for milestones, and your
   library's lists. */
const { useRef: useRefP } = React;

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

function ProfileView({ items, tmdbKey, session, sync, avatar, setAvatar, onOpenList, onSettings }) {
  // Runtimes and episode counts for everything that counts towards time.
  const pending = usePrefetchDetails(items.filter((i) => i.status !== "watchlist"), tmdbKey);
  const s = watchStats(items);
  const counts = {};
  for (const st of STATUSES) counts[st.v] = items.filter((i) => i.status === st.v).length;
  const earned = BADGES.filter((b) => b.of(s) >= b.goal).length;
  const genres = [...s.genreTime].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <main className="tvt-view tvt-page" style={{ padding: "8px 16px calc(120px + var(--safe-bottom))" }}>
      <ScreenTitle title="Profile" />
      <AccountCard session={session} sync={sync} avatar={avatar} setAvatar={setAvatar} onSettings={onSettings} />

      <SectionHeader title="Watch Time" detail={pending ? "Updating…" : null} />
      <WatchTimeCard s={s} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 26 }}>
        <StatTile label="Episodes" value={s.episodes.toLocaleString("en-GB")} color="var(--tv)" icon={<PlayIcon size={16} />} />
        <StatTile label="Movies" value={s.movies.toLocaleString("en-GB")} color="var(--movie)" icon={<CheckCircleIcon size={16} />} />
        <StatTile label="Shows finished" value={s.showsDone} color="var(--ok)" icon={<CheckIcon size={15} />} />
        <StatTile label="Your average" value={s.rated ? (s.ratingSum / s.rated).toFixed(1) : "–"} color="var(--star)" icon={<StarIcon size={15} filled />} />
      </div>

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

      <SectionHeader title="Awards" detail={`${earned} of ${BADGES.length}`} />
      <Card style={{ marginBottom: 26, padding: "20px 10px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px 6px" }}>
          {BADGES.map((b) => <BadgeMedal key={b.id} badge={b} value={b.of(s)} />)}
        </div>
      </Card>

      <SectionHeader title="Library" />
      <LibraryRows counts={counts} onOpen={onOpenList} />

      <div style={{ fontSize: 12, color: "var(--ink-faint)", lineHeight: 1.45, margin: "0 4px" }}>
        Times use TMDB's runtimes. A show counts the episodes up to your progress, or all of them once it's in Watched.
        {s.estimated > 0 && ` ${plural(s.estimated, "title")} without a runtime ${s.estimated === 1 ? "is" : "are"} estimated at 45 min an episode or 1h 50m a movie.`}
      </div>
    </main>
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
function Avatar({ src, email, size = 56 }) {
  return (
    <span aria-hidden style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0, overflow: "hidden",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(145deg, color-mix(in oklab, var(--accent) 85%, #fff), color-mix(in oklab, var(--accent) 60%, #000))",
      color: "#fff", fontSize: Math.round(size * 0.43), fontWeight: 700,
    }}>
      {src ? <img key={src} src={src} alt="" className="tvt-pop" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : email ? email[0].toUpperCase() : <PersonIcon size={Math.round(size / 2)} />}
    </span>
  );
}

/* Settings: the picture, with Choose and Remove. */
function AvatarPicker({ avatar, setAvatar, email }) {
  const [input, choose] = useAvatarInput(setAvatar);
  const remove = () => {
    const before = avatar;
    setAvatar("");
    showToast("Profile picture removed", { action: { label: "Undo", onClick: () => setAvatar(before) } });
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Avatar src={avatar} email={email} size={52} />
      <button type="button" onClick={choose} style={ghostBtn()}>{avatar ? "Change Photo" : "Choose Photo"}</button>
      {avatar && <button type="button" onClick={remove} style={{ ...ghostBtn(), color: "var(--danger)" }}>Remove</button>}
      {input}
    </div>
  );
}

/* Your picture (tap it to change it) and account; the rest opens Settings.
   Two buttons side by side, as buttons can't nest. */
function AccountCard({ session, sync, avatar, setAvatar, onSettings }) {
  const [input, choose] = useAvatarInput(setAvatar);
  const email = session?.user?.email || "";
  const sub = session === undefined ? "Checking sign-in…"
    : session ? syncLabel(sync.status)
    : cloud ? "Sign in to sync across your devices" : "Saved on this device";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, marginBottom: 26, padding: 14,
      background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 20,
    }}>
      <button type="button" onClick={choose} aria-label={avatar ? "Change profile picture" : "Add a profile picture"} style={{
        position: "relative", flexShrink: 0, display: "inline-flex", padding: 0, margin: 0,
        background: "none", border: "none", borderRadius: 999, cursor: "pointer", transition: "var(--press)",
      }}>
        <Avatar src={avatar} email={email} size={56} />
        <span aria-hidden style={{
          position: "absolute", right: -3, bottom: -3, width: 24, height: 24, borderRadius: 999,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "var(--accent)", color: "var(--accent-ink)", border: "2px solid var(--bg-1)",
        }}><CameraIcon size={13} /></span>
      </button>
      {input}
      <button type="button" className="tvt-wide-btn" onClick={onSettings} style={{
        flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, padding: 0, margin: 0,
        background: "transparent", border: "none", textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer",
      }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 17, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{email || "Your Library"}</span>
          <span style={{ display: "block", fontSize: 13, color: sync.status.state === "error" ? "var(--danger)" : "var(--ink-dim)", marginTop: 2 }}>{sub}</span>
        </span>
        <span style={{ color: "var(--ink-faint)", display: "inline-flex" }}><ChevronIcon /></span>
      </button>
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
    { l: "Shows", c: "var(--tv)", min: s.tvMin, n: plural(s.episodes, "episode") },
    { l: "Movies", c: "var(--movie)", min: s.movieMin, n: plural(s.movies, "movie") },
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
        <span style={{ width: `${share * 100}%`, background: "var(--tv)", transition: "width 0.6s var(--ease-snappy)" }} />
        <span style={{ width: `${s.minutes ? (1 - share) * 100 : 0}%`, background: "var(--movie)", transition: "width 0.6s var(--ease-snappy)" }} />
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

/* An award: a coloured medal once earned; until then a grey one in a ring
   that fills as you get closer. */
function BadgeMedal({ badge, value }) {
  const got = value >= badge.goal;
  const frac = Math.min(1, value / badge.goal);
  const R = 35, C = 2 * Math.PI * R;
  const show = (n) => (badge.hours ? Math.floor(n / 60) : n).toLocaleString("en-GB");
  const h = badge.hue;
  return (
    <div role="img" aria-label={`${badge.name}: ${badge.desc}. ${got ? "Earned" : `${show(value)} of ${show(badge.goal)}`}`} style={{ textAlign: "center", minWidth: 0 }}>
      <div aria-hidden style={{ position: "relative", width: 78, height: 78, margin: "0 auto" }}>
        {!got && (
          <svg width="78" height="78" viewBox="0 0 78 78" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
            <circle cx="39" cy="39" r={R} fill="none" stroke="var(--fill)" strokeWidth="4" />
            {frac > 0 && <circle cx="39" cy="39" r={R} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${frac * C} ${C}`} />}
          </svg>
        )}
        <span className={got ? "tvt-pop" : undefined} style={{
          position: "absolute", inset: got ? 0 : 8, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: got ? 36 : 28,
          background: got
            ? `radial-gradient(circle at 32% 26%, oklch(90% 0.1 ${h}), oklch(66% 0.17 ${h}) 52%, oklch(44% 0.15 ${h + 25}))`
            : "var(--bg-2)",
          boxShadow: got ? `inset 0 0 0 3px rgba(255,255,255,0.35), inset 0 -6px 12px rgba(0,0,0,0.18), 0 10px 22px -12px oklch(45% 0.18 ${h})` : "none",
          filter: got ? "none" : "grayscale(1)", opacity: got ? 1 : 0.5,
        }}>{badge.icon}</span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8 }}>{badge.name}</div>
      <div style={{ fontSize: 11.5, color: "var(--ink-dim)", marginTop: 2, lineHeight: 1.3, padding: "0 2px" }}>{badge.desc}</div>
      {!got && <div className="mono" style={{ fontSize: 11, color: "var(--accent)", marginTop: 3, fontWeight: 600 }}>{show(value)} / {show(badge.goal)}{badge.hours ? " h" : ""}</div>}
    </div>
  );
}

/* The library's lists, grouped as in iOS Settings. */
function LibraryRows({ counts, onOpen }) {
  const tint = { watching: "var(--accent)", watchlist: "var(--tv)", watched: "var(--ok)" };
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--card-edge)", borderRadius: 20, overflow: "hidden", marginBottom: 14 }}>
      {STATUSES.map((st, i) => {
        const Icon = st.icon;
        return (
          <button key={st.v} type="button" className="tvt-wide-btn" onClick={() => onOpen(st.v)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "0 14px", margin: 0,
            background: "transparent", border: "none", textAlign: "left", color: "inherit", font: "inherit", cursor: "pointer",
          }}>
            <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: tint[st.v] || "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={18} />
            </span>
            {/* The divider starts after the icon, as in iOS lists. */}
            <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "14px 0", borderTop: i ? "1px solid var(--line-soft)" : "none" }}>
              <span style={{ flex: 1, fontSize: 16 }}>{st.l}</span>
              <span className="mono" style={{ fontSize: 15, color: "var(--ink-dim)" }}>{counts[st.v]}</span>
              <span style={{ color: "var(--ink-faint)", display: "inline-flex" }}><ChevronIcon size={13} /></span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

Object.assign(window, { watchStats, BADGES, ProfileView, cleanAvatar, Avatar, AvatarPicker });
