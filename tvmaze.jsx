/* tvmaze.jsx — when a show airs, from TVmaze: the next episode's name and
   air time (in your time zone), the latest one out, the name and synopsis
   of the episode you're up to, and where and on which days it airs.
   TVmaze is free and needs no key. A show is found by its IMDb or TVDB id
   (from TMDB's details), else by name and year, and kept on the device:
   a show is checked again after 12 hours, or as soon as its next episode
   has aired. Its data is CC BY-SA, so the sheet credits and links it. */
const { useState: useStateM, useEffect: useEffectM } = React;

const TVMAZE_API = "https://api.tvmaze.com";
const TVMAZE_STORE = "tvt:tvmaze:v1";
const TVMAZE_MAX = 300; // shows kept; past this the longest-unchecked go
const TVMAZE_FRESH_MS = 12 * 36e5;
const TVMAZE_MISS_MS = 7 * DAY_MS; // a show TVmaze hasn't got is looked for again after this
const TVMAZE_EPS_MAX = 6; // episode names kept per show

let tvmazeMem = null;
const tvmazeInflight = new Map();

function tvmazeAll() {
  if (!tvmazeMem) {
    try { tvmazeMem = JSON.parse(localStorage.getItem(TVMAZE_STORE) || "{}") || {}; } catch { tvmazeMem = {}; }
  }
  return tvmazeMem;
}
let tvmazeSaveTimer = 0;
function saveTvmazeSoon() {
  clearTimeout(tvmazeSaveTimer);
  tvmazeSaveTimer = setTimeout(() => {
    const all = tvmazeAll();
    const out = {};
    for (const k of Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, TVMAZE_MAX)) out[k] = all[k];
    // Only a cache: if storage is full, drop it rather than crowd out the list.
    try { localStorage.setItem(TVMAZE_STORE, JSON.stringify(out)); } catch { try { localStorage.removeItem(TVMAZE_STORE); } catch {} }
  }, 500);
}

/* A show's place in the cache: its TMDB id, else its name and year (a
   show typed in by hand). */
function tvmazeKey(show) {
  return show.tmdbId ? `tmdb:${show.tmdbId}` : `q:${show.title.trim().toLowerCase()}|${show.year || ""}`;
}
function tvmazeStale(c, show) {
  if (!c) return true;
  // Not found by name, but now there's an id to look it up by.
  if (!c.id && !c.byId && (show.imdb || show.tvdb)) return true;
  if (Date.now() - c.at > (c.id ? TVMAZE_FRESH_MS : TVMAZE_MISS_MS)) return true;
  // The next episode has aired: it's now the latest, and there's a new next.
  return !!c.next?.stamp && Date.parse(c.next.stamp) < Date.now();
}

/* GET from TVmaze. Resolves with null for a 404 (no such show or episode);
   rejects with a message to show for anything else that goes wrong. */
async function tvmazeGet(path) {
  let res;
  try {
    res = await fetch(TVMAZE_API + path, { headers: { accept: "application/json" } });
  } catch {
    throw new Error("Couldn't reach TVmaze. Check your connection.");
  }
  if (res.status === 404) return null;
  if (res.status === 429) throw new Error("TVmaze is busy. Try again in a moment.");
  if (!res.ok) throw new Error(`TVmaze error ${res.status}`);
  return res.json();
}

/* TVmaze's summaries are HTML. DOMParser reads them without running
   anything or loading images. */
function plainText(html) {
  if (!html) return "";
  try { return (new DOMParser().parseFromString(html, "text/html").body.textContent || "").replace(/\s+/g, " ").trim(); } catch { return ""; }
}

/* The parts of a TVmaze episode the sheet shows. `stamp` is the moment it
   airs (UTC); `time` is empty when TVmaze knows the day but not the hour
   (most streaming drops). */
function tvmazeEp(x) {
  if (!x || !(x.season > 0) || !(x.number > 0)) return null;
  return {
    s: x.season, e: x.number, name: String(x.name || "").slice(0, 120),
    stamp: x.airstamp || "", date: x.airdate || "", time: x.airtime || "",
    summary: plainText(x.summary).slice(0, 400),
  };
}

/* The TVmaze id for a show: by IMDb id, then TVDB id, then a search by
   name, accepted only if the year (or, without one, the name) matches, so
   a different show of the same name isn't picked. 0 when there's none. */
async function findTvmazeId(show) {
  if (show.imdb) {
    const r = await tvmazeGet(`/lookup/shows?imdb=${encodeURIComponent(show.imdb)}`);
    if (r?.id) return r.id;
  }
  if (show.tvdb) {
    const r = await tvmazeGet(`/lookup/shows?thetvdb=${encodeURIComponent(show.tvdb)}`);
    if (r?.id) return r.id;
  }
  const r = await tvmazeGet(`/singlesearch/shows?q=${encodeURIComponent(show.title)}`);
  if (!r?.id) return 0;
  const year = Number((r.premiered || "").slice(0, 4));
  const ok = show.year ? year && Math.abs(year - Number(show.year)) <= 1 : r.name?.trim().toLowerCase() === show.title.trim().toLowerCase();
  return ok ? r.id : 0;
}

/* Fetch a show afresh (finding it first if need be). Episode names already
   looked up are kept. */
async function fetchTvmazeShow(show, prev) {
  const id = prev?.id || (await findTvmazeId(show));
  const r = id ? await tvmazeGet(`/shows/${id}?embed[]=nextepisode&embed[]=previousepisode`) : null;
  if (!r?.id) return { at: Date.now(), id: 0, byId: !!(show.imdb || show.tvdb) };
  const where = r.network || r.webChannel;
  return {
    at: Date.now(), id: r.id,
    url: /^https:\/\/www\.tvmaze\.com\//.test(r.url || "") ? r.url : `https://www.tvmaze.com/shows/${r.id}`,
    status: r.status || "",
    channel: where?.name || "",
    days: Array.isArray(r.schedule?.days) ? r.schedule.days.filter((d) => typeof d === "string") : [],
    next: tvmazeEp(r._embedded?.nextepisode),
    prev: tvmazeEp(r._embedded?.previousepisode),
    eps: prev?.id === r.id ? prev.eps || {} : {},
  };
}

/* Run `fn` once for `k`, joining the run already under way. */
function tvmazeOnce(k, fn) {
  if (tvmazeInflight.has(k)) return tvmazeInflight.get(k);
  const p = fn().finally(() => tvmazeInflight.delete(k));
  tvmazeInflight.set(k, p);
  return p;
}

/* A show's entry, fetched if stale, plus episode `want` ({ s, e }) by name
   if asked. A failed refresh keeps what was there. */
async function loadTvmaze(show, want) {
  const k = tvmazeKey(show);
  const all = tvmazeAll();
  if (tvmazeStale(all[k], show)) {
    await tvmazeOnce(k, async () => {
      all[k] = await fetchTvmazeShow(show, all[k]);
      saveTvmazeSoon();
    });
  }
  const c = all[k];
  const ek = want && `${want.s}:${want.e}`;
  if (!c?.id || !ek || ek in c.eps) return;
  await tvmazeOnce(`${k}#${ek}`, async () => {
    const ep = tvmazeEp(await tvmazeGet(`/shows/${c.id}/episodebynumber?season=${want.s}&number=${want.e}`));
    const keep = Object.entries(c.eps).slice(-(TVMAZE_EPS_MAX - 1));
    c.eps = { ...Object.fromEntries(keep), [ek]: ep }; // null: TVmaze hasn't got it
    saveTvmazeSoon();
  });
}

/* useTvmaze — what TVmaze has on a show (null until it's in), and the
   episode `want` by name. Pass show = null to wait (for TMDB's details,
   which carry the ids that find a show for certain). */
function useTvmaze(show, want) {
  const [, setV] = useStateM(0);
  const k = show ? tvmazeKey(show) : "";
  useEffectM(() => {
    if (!show) return;
    let live = true;
    loadTvmaze(show, want).catch(() => {}).finally(() => { if (live) setV((v) => v + 1); });
    return () => { live = false; };
  }, [k, show?.imdb, show?.tvdb, want?.s, want?.e]);
  return k ? tvmazeAll()[k] || null : null;
}

/* ============ On the title sheet ============ */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* When an episode airs, in your time zone: "Thu 6 Nov, 9:00 pm", or just
   the day when TVmaze doesn't know the hour. */
function fmtAirTime(ep) {
  const t = Date.parse(ep.time ? ep.stamp : "");
  if (t) return new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  return fmtDate(ep.date, { weekday: "short", day: "numeric", month: "short" });
}
/* "today", "tomorrow", "in 4 days", "3 days ago": by calendar day here. */
function fmtDayGap(ep) {
  const t = Date.parse(ep.time ? ep.stamp : ep.date ? `${ep.date}T12:00:00` : "");
  if (!t) return "";
  const midnight = (x) => { const d = new Date(x); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((midnight(t) - midnight(Date.now())) / DAY_MS);
  if (Math.abs(days) > 30) return "";
  return new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" }).format(days, "day");
}
const epLabel = (ep) => `S${ep.s} · E${ep.e}`;

/* The Schedule section: your next episode by name, the next one to air
   and the latest out, and the show's days and channel. Nothing at all
   until TVmaze has something to say. */
function AirSection({ m, mine }) {
  if (!m?.id) return null;
  const rows = [];
  const yours = mine && m.eps?.[`${mine.s}:${mine.e}`];
  if (yours) {
    const out = Date.parse(yours.stamp || yours.date) <= Date.now();
    rows.push({
      k: "yours", label: "Your next episode", ep: yours, summary: yours.summary, accent: !out,
      sub: out ? (yours.date ? `Aired ${fmtDate(yours.date)}` : "") : [fmtAirTime(yours), fmtDayGap(yours)].filter(Boolean).join(" · "),
    });
  }
  if (m.next && !(yours && yours.s === m.next.s && yours.e === m.next.e)) {
    rows.push({ k: "next", label: "Next to air", ep: m.next, sub: [fmtAirTime(m.next), fmtDayGap(m.next)].filter(Boolean).join(" · "), accent: true });
  }
  if (m.prev && !(yours && yours.s === m.prev.s && yours.e === m.prev.e)) {
    rows.push({ k: "prev", label: "Latest out", ep: m.prev, sub: m.prev.date ? `Aired ${fmtDate(m.prev.date)}` : "" });
  }
  // TVmaze lists days in its own order; Sunday to Saturday reads better.
  const days = [...m.days].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
  const when = m.status === "Ended" ? "Ended"
    : days.length === 7 ? "Daily"
    : days.length > 2 ? days.map((d) => d.slice(0, 3)).join(", ")
    : days.map((d) => `${d}s`).join(" and ");
  const line = [when, m.channel].filter(Boolean).join(" · ");
  if (!rows.length && !line) return null;
  return (
    <DetailSection title="Schedule">
      {rows.length > 0 && (
        <div style={{ background: "var(--bg-2)", borderRadius: 16, padding: "2px 14px" }}>
          {rows.map((r, i) => (
            <div key={r.k} className="tvt-pop" style={{ display: "block", padding: "11px 0", borderTop: i ? "1px solid var(--line-soft)" : "none" }}>
              <div className="label" style={{ color: r.accent ? "var(--accent)" : undefined }}>{r.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 3, minWidth: 0 }}>
                <span className="mono" style={{ fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{epLabel(r.ep)}</span>
                {r.ep.name && <span style={{ fontSize: 15, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ep.name}</span>}
              </div>
              {r.sub && <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 2 }}>{r.sub}</div>}
              {r.summary && <div className="tvt-clamp-2" style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.4, marginTop: 6 }}>{r.summary}</div>}
            </div>
          ))}
        </div>
      )}
      {line && <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: rows.length ? 8 : 0 }}>{line}</div>}
    </DetailSection>
  );
}

Object.assign(window, { tvmazeGet, useTvmaze, AirSection });
