/* activity.jsx — Profile's Activity section: what you watched and when,
   drawn from the watch history (watchlog.jsx) and the library.

   - Calendar: a heatmap of the days you watched, 26 weeks at a time, with
     your streaks and busiest day.
   - When You Watch: by day of the week, or by hour of the day.
   - Coming Up: a month calendar of new episodes of shows you're watching
     and releases on your lists, from TMDB.
   - Your Eras: the decades your shows and movies come from.
   - Your Ratings: how your stars spread.

   Days and hours are the device's own (local time), so a 1 a.m. episode
   counts on the day it was 1 a.m. where you are. Charts take a tap: the
   line above each one reads out the bar or day you tapped. */
const { useState: useStateA, useMemo: useMemoA } = React;

const ACT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ACT_DAYS_LONG = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const CAL_WEEKS = 26;
// Heatmap steps: the accent mixed into the card, faint to full. Zero is
// the empty fill. One hue, light to dark (dark to bright on dark mode).
const HEAT = ["var(--fill)", 32, 55, 78, 100].map((p) => (typeof p === "string" ? p : `color-mix(in oklab, var(--accent) ${p}%, var(--bg-1))`));

const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
const dayKeyOf = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const weekdayIx = (d) => (d.getDay() + 6) % 7; // Monday first
const fmtDay = (d, opts = { weekday: "short", day: "numeric", month: "short" }) => d.toLocaleDateString("en-GB", opts);
const fmtHour = (h) => (h % 12 || 12) + (h < 12 ? " am" : " pm");
const countLine = (tv, movie) => [tv && `${tv} episode${tv === 1 ? "" : "s"}`, movie && `${movie} movie${movie === 1 ? "" : "s"}`].filter(Boolean).join(" · ") || "Nothing watched";

/* Watches marked in bulk: three or more in a row under BULK_GAP_MIN
   apart, faster than anyone watches. Trackers stamp a whole show "watched"
   at the moment you mark it (TV Time does when you join), which would make
   that one day look like a thousand-episode binge. They still count
   towards totals, but not towards the calendar, streaks or times. */
const BULK_GAP_MIN = 3;
function splitBulk(events) {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const timed = [], bulk = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].at - sorted[j].at < BULK_GAP_MIN * 60000) j++;
    (j - i >= 2 ? bulk : timed).push(...sorted.slice(i, j + 1));
    i = j + 1;
  }
  return { timed, bulk };
}

/* activityStats — the history by local day, weekday and hour, with
   streaks, leaving out watches marked in bulk. */
function activityStats(all, now = Date.now()) {
  const { timed: events, bulk } = splitBulk(all);
  const days = new Map(); // day key → { tv, movie }
  const weekday = Array(7).fill(0), hour = Array(24).fill(0);
  let first = Infinity;
  for (const ev of events) {
    const d = new Date(ev.at);
    const k = dayKeyOf(d);
    const c = days.get(k) || { tv: 0, movie: 0 };
    c[ev.kind]++;
    days.set(k, c);
    weekday[weekdayIx(d)]++;
    hour[d.getHours()]++;
    if (ev.at < first) first = ev.at;
  }
  // Streaks: days in a row with something watched. Today not watched yet
  // doesn't break the current one.
  const today = dayStart(now);
  let current = 0;
  for (let d = days.has(dayKeyOf(today)) ? today : addDays(today, -1); days.has(dayKeyOf(d)); d = addDays(d, -1)) current++;
  const sorted = [...days.keys()].map((k) => { const [y, m, dd] = k.split("-").map(Number); return new Date(y, m - 1, dd); }).sort((a, b) => a - b);
  let longest = 0, run = 0, prev = null;
  for (const d of sorted) {
    run = prev && Math.round((d - prev) / 864e5) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let busiest = null;
  for (const [k, c] of days) if (!busiest || c.tv + c.movie > busiest.n) busiest = { k, n: c.tv + c.movie };
  if (busiest) { const [y, m, dd] = busiest.k.split("-").map(Number); busiest.date = new Date(y, m - 1, dd); }
  return { days, weekday, hour, current, longest, busiest, first: first === Infinity ? 0 : first, total: events.length, bulk: bulk.length,
    rewatches: all.filter((e) => e.again).length, logged: all.length };
}

function ActivitySection({ items, tmdbKey, onOpenItem, onImportCsv }) {
  const { events, version, ready } = useWatchLog();
  const stats = useMemoA(() => activityStats(events), [version, events.length]);
  // Release dates for titles on your lists, for Coming Up.
  usePrefetchDetails(items.filter((i) => i.status === "watchlist" && i.tmdbId), tmdbKey);
  return (
    <>
      <SectionHeader title="Activity" detail={stats.total ? `since ${fmtDay(new Date(stats.first), { month: "short", year: "numeric" })}` : null} />
      {stats.total ? (
        <>
          <ActivityCalendar stats={stats} />
          <div className="tvt-tiles" style={{ marginBottom: 10 }}>
            <StatTile label="Current streak" value={`${stats.current}d`} color="var(--accent)" icon={<FlameIcon size={15} />} />
            <StatTile label="Longest streak" value={`${stats.longest}d`} color="var(--accent)" icon={<TrophyIcon size={15} />} />
            <StatTile label="Rewatches" value={stats.rewatches.toLocaleString("en-GB")} color="var(--accent)" icon={<RepeatIcon size={15} />} />
            <StatTile label="Watches logged" value={stats.logged.toLocaleString("en-GB")} color="var(--accent)" icon={<PlayIcon size={14} />} />
          </div>
          <WhenYouWatch stats={stats} />
        </>
      ) : ready && (
        <Card style={{ marginBottom: 10, textAlign: "center", padding: "22px 20px" }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Your watch history starts here</div>
          <div style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.5, margin: "6px auto 14px", maxWidth: 320 }}>
            Tick episodes in Watching, or import a watch history with dates (TV Time's watches.csv, a Letterboxd diary), and
            your calendar, streaks and viewing hours show up here.
          </div>
          <button type="button" onClick={onImportCsv} style={ghostBtn()}>Import CSV</button>
        </Card>
      )}
      <ComingUp items={items} onOpenItem={onOpenItem} />
      <YourEras items={items} />
      <YourRatings items={items} />
    </>
  );
}

/* ============ Calendar heatmap ============ */
function ActivityCalendar({ stats }) {
  const [back, setBack] = useStateA(0); // pages of CAL_WEEKS back from now
  const [pick, setPick] = useStateA(null); // a tapped day
  const today = dayStart(Date.now());
  // The grid ends on the Sunday of this week (less `back` pages) and runs
  // CAL_WEEKS weeks, Monday to Sunday down each column.
  const end = addDays(today, 6 - weekdayIx(today) - back * CAL_WEEKS * 7);
  const start = addDays(end, -(CAL_WEEKS * 7 - 1));
  const cells = [];
  for (let i = 0; i < CAL_WEEKS * 7; i++) {
    const d = addDays(start, i);
    const c = stats.days.get(dayKeyOf(d)) || { tv: 0, movie: 0 };
    cells.push({ d, c, n: c.tv + c.movie, future: d > today });
  }
  // Steps by quartile of the busy days over the whole history, so a binge
  // stands out and an ordinary night still shows.
  const steps = useMemoA(() => {
    const ns = [...stats.days.values()].map((c) => c.tv + c.movie).sort((a, b) => a - b);
    const q = (p) => ns[Math.min(ns.length - 1, Math.floor(p * ns.length))] || 1;
    return [q(0.25), q(0.5), q(0.75)];
  }, [stats]);
  const level = (n) => (n <= 0 ? 0 : n <= steps[0] ? 1 : n <= steps[1] ? 2 : n <= steps[2] ? 3 : 4);
  const inRange = cells.filter((x) => !x.future);
  const sum = inRange.reduce((a, x) => ({ tv: a.tv + x.c.tv, movie: a.movie + x.c.movie, days: a.days + (x.n > 0) }), { tv: 0, movie: 0, days: 0 });
  const earliest = stats.first ? dayStart(stats.first) : today;
  const canBack = start > earliest;
  // Month names over the weeks they start in, skipping one too close to
  // the last.
  const months = [];
  for (let w = 0; w < CAL_WEEKS; w++) {
    const d = addDays(start, w * 7);
    const prev = w ? addDays(start, (w - 1) * 7) : null;
    if ((!prev || prev.getMonth() !== d.getMonth()) && (!months.length || w - months[months.length - 1].w >= 3)) {
      months.push({ w, l: d.toLocaleDateString("en-GB", { month: "short" }) });
    }
  }
  const picked = pick && cells.find((x) => dayKeyOf(x.d) === pick);
  const range = `${fmtDay(start, { month: "short", year: start.getFullYear() === end.getFullYear() ? undefined : "numeric" })} – ${fmtDay(end > today ? today : end, { month: "short", year: "numeric" })}`;

  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label">Calendar</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, minHeight: 20 }}>
            {picked ? `${fmtDay(picked.d)}: ${countLine(picked.c.tv, picked.c.movie)}` : `${sum.days} days watched · ${countLine(sum.tv, sum.movie)}`}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 1 }}>{range}</div>
        </div>
        <button type="button" disabled={!canBack} onClick={() => { setBack((b) => b + 1); setPick(null); }} aria-label="Earlier"
          style={{ ...iconBtn(34), opacity: canBack ? 1 : 0.35 }}><ChevronIcon dir="left" size={12} /></button>
        <button type="button" disabled={!back} onClick={() => { setBack((b) => b - 1); setPick(null); }} aria-label="Later"
          style={{ ...iconBtn(34), opacity: back ? 1 : 0.35 }}><ChevronIcon dir="right" size={12} /></button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `14px repeat(${CAL_WEEKS}, 1fr)`, columnGap: 2, marginTop: 12 }}>
        <span />
        {Array.from({ length: CAL_WEEKS }, (_, w) => {
          const m = months.find((x) => x.w === w);
          return <span key={w} style={{ fontSize: 10.5, color: "var(--ink-faint)", whiteSpace: "nowrap", overflow: "visible", height: 14 }}>{m ? m.l : ""}</span>;
        })}
      </div>
      <div role="grid" aria-label={`Days watched, ${range}`} style={{
        display: "grid", gridTemplateColumns: `14px repeat(${CAL_WEEKS}, 1fr)`, gridTemplateRows: "repeat(7, auto)",
        gridAutoFlow: "column", gap: 2, marginTop: 2,
      }}>
        {ACT_DAYS.map((w, i) => (
          <span key={w} aria-hidden style={{ fontSize: 9.5, color: "var(--ink-faint)", lineHeight: 1, alignSelf: "center" }}>{i % 2 ? "" : w[0]}</span>
        ))}
        {cells.map((x) => {
          const k = dayKeyOf(x.d);
          const on = pick === k;
          return (
            <button key={k} type="button" disabled={x.future} onClick={() => setPick(on ? null : k)}
              aria-label={`${fmtDay(x.d)}: ${countLine(x.c.tv, x.c.movie)}`} aria-pressed={on}
              style={{
                aspectRatio: "1", width: "100%", padding: 0, border: "none", borderRadius: 3, cursor: x.future ? "default" : "pointer",
                background: x.future ? "transparent" : HEAT[level(x.n)],
                outline: on ? "2px solid var(--ink)" : "none", outlineOffset: 1,
                boxShadow: dayKeyOf(today) === k && !on ? "inset 0 0 0 1.5px var(--ink-faint)" : "none",
              }} />
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3, marginTop: 10, fontSize: 11, color: "var(--ink-faint)" }}>
        Less{HEAT.map((c, i) => <span key={i} style={{ width: 10, height: 10, borderRadius: 2, background: c, marginLeft: i ? 0 : 4 }} />)}<span style={{ marginLeft: 4 }}>More</span>
      </div>
      {stats.busiest && (
        <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginTop: 8, borderTop: "1px solid var(--line-soft)", paddingTop: 8 }}>
          Busiest day: <b style={{ color: "var(--ink)" }}>{fmtDay(stats.busiest.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</b>, {stats.busiest.n} watched
          {stats.bulk > 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 4, lineHeight: 1.4 }}>
              {stats.bulk.toLocaleString("en-GB")} marked in bulk (several a minute, as when a tracker marks a whole show watched) aren't counted here.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ============ Column chart ============
   Columns from one baseline, ≤24px wide with 4px rounded tops; a stack's
   parts (one per colour) split by a 2px gap. Tap one to read it out in
   the line above (`onPick`); `picked` is drawn full strength, the rest
   faded. `ticks` labels some columns along the bottom. */
function ColumnChart({ bars, colors, height = 120, picked, onPick, label }) {
  const max = Math.max(1, ...bars.map((b) => b.values.reduce((a, v) => a + v, 0)));
  return (
    <div role="group" aria-label={label}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height, borderBottom: "1px solid var(--line)" }}>
        {bars.map((b, i) => {
          const total = b.values.reduce((a, v) => a + v, 0);
          const dim = picked != null && picked !== i;
          return (
            <button key={b.label} type="button" onClick={() => onPick?.(picked === i ? null : i)} aria-label={b.aria} aria-pressed={picked === i}
              style={{ flex: 1, minWidth: 0, height: "100%", padding: 0, border: "none", background: "none", cursor: "pointer", display: "flex", flexDirection: "column-reverse", alignItems: "center" }}>
              <span style={{ width: "100%", maxWidth: 24, height: `${(total / max) * 100}%`, display: "flex", flexDirection: "column-reverse", gap: total ? 2 : 0, opacity: dim ? 0.38 : 1, transition: "opacity 0.2s, height 0.6s var(--ease-snappy)" }}>
                {b.values.map((v, j) => {
                  const top = b.values.slice(j + 1).every((x) => !x);
                  return v > 0 && <span key={j} style={{ flex: v, minHeight: 2, background: colors[j], borderRadius: top ? "4px 4px 0 0" : 0 }} />;
                })}
              </span>
            </button>
          );
        })}
      </div>
      <div aria-hidden style={{ display: "flex", gap: 2, marginTop: 5 }}>
        {bars.map((b) => (
          <span key={b.label} style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: "var(--ink-faint)", textAlign: "center", whiteSpace: "nowrap", overflow: "visible" }}>{b.tick || ""}</span>
        ))}
      </div>
    </div>
  );
}

/* A chart's card: a caption, the readout line (the tapped bar, else a
   summary) and the chart. */
function ChartCard({ caption, readout, sub, action, children, legend }) {
  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label">{caption}</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{readout}</div>
          {sub && <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 1 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {legend && <div style={{ display: "flex", gap: 14, margin: "10px 0 0", fontSize: 12, color: "var(--ink-dim)" }}>{legend}</div>}
      <div style={{ marginTop: 14 }}>{children}</div>
    </Card>
  );
}
const LegendKey = ({ color, label }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />{label}</span>
);

/* ============ When you watch ============ */
const WHEN_OPTIONS = [{ v: "day", l: "Day" }, { v: "hour", l: "Hour" }];
function WhenYouWatch({ stats }) {
  const [by, setBy] = useStateA("day");
  const [pick, setPick] = useStateA(null);
  const data = by === "day" ? stats.weekday : stats.hour;
  const peak = data.indexOf(Math.max(...data));
  const name = (i) => (by === "day" ? ACT_DAYS_LONG[i] : fmtHour(i));
  const share = (i) => (stats.total ? Math.round((data[i] / stats.total) * 100) : 0);
  const bars = data.map((n, i) => ({
    label: String(i), values: [n],
    tick: by === "day" ? ACT_DAYS[i][0] : i % 6 === 0 ? fmtHour(i).replace(" ", "") : "",
    aria: `${name(i)}: ${n} watched`,
  }));
  const readout = pick != null
    ? `${name(pick)}: ${data[pick].toLocaleString("en-GB")} watched (${share(pick)}%)`
    : by === "day" ? `Most on ${ACT_DAYS_LONG[peak]}` : `Peak hour: ${fmtHour(peak)}–${fmtHour((peak + 1) % 24)}`;
  return (
    <ChartCard caption="When You Watch" readout={readout}
      sub={pick == null ? `${share(peak)}% of everything you've watched` : "Tap again to clear"}
      action={<div style={{ width: 112 }}><SegToggle small full options={WHEN_OPTIONS} value={by} onChange={(v) => { setBy(v); setPick(null); }} label="Group by" /></div>}>
      <ColumnChart bars={bars} colors={["var(--accent)"]} picked={pick} onPick={setPick} label={`Watches by ${by}`} />
    </ChartCard>
  );
}

/* ============ Coming up ============
   New episodes of the shows you're watching (TMDB's next episode) and
   release dates of titles you're watching or have on your Watchlist, on a
   month calendar. */
function ComingUp({ items, onOpenItem }) {
  const [month, setMonth] = useStateA(0); // months from this one
  const [pick, setPick] = useStateA(null);
  const today = dayStart(Date.now());
  const byDay = new Map();
  const add = (date, entry) => {
    const t = Date.parse(date || "");
    if (!t) return;
    // TMDB dates are plain days: read them as that day here.
    const [y, m, d] = date.slice(0, 10).split("-").map(Number);
    const day = new Date(y, m - 1, d);
    if (day < today) return;
    const k = dayKeyOf(day);
    byDay.set(k, [...(byDay.get(k) || []), entry]);
  };
  for (const i of items) {
    if (i.status === "watched" || !i.tmdbId) continue;
    const d = cachedDetails(i.kind, i.tmdbId);
    if (!d) continue;
    if (i.kind === "tv" && i.status === "watching" && d.next?.date) add(d.next.date, { item: i, kind: "tv", what: `S${d.next.s} · E${d.next.e}` });
    else if (i.kind === "movie" && d.date) add(d.date, { item: i, kind: "movie", what: "Release" });
    else if (i.kind === "tv" && i.status === "watchlist" && d.date) add(d.date, { item: i, kind: "tv", what: "Premiere" });
  }
  const first = new Date(today.getFullYear(), today.getMonth() + month, 1);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const lead = weekdayIx(first);
  const inMonth = [...byDay.entries()].filter(([k]) => { const [y, m] = k.split("-").map(Number); return y === first.getFullYear() && m === first.getMonth() + 1; });
  const count = inMonth.reduce((a, [, l]) => a + l.length, 0);
  // The tapped day, else the next day with something on.
  const nextKey = [...byDay.keys()].map((k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }).sort((a, b) => a - b)[0];
  const shownKey = pick || (month === 0 && nextKey ? dayKeyOf(nextKey) : inMonth.length ? inMonth.map(([k]) => k).sort((a, b) => { const p = (k) => k.split("-").map(Number); const [, , da] = p(a), [, , db] = p(b); return da - db; })[0] : null);
  const shown = shownKey ? byDay.get(shownKey) || [] : [];
  const shownDate = shownKey ? (() => { const [y, m, d] = shownKey.split("-").map(Number); return new Date(y, m - 1, d); })() : null;
  if (!byDay.size) return null;

  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label">Coming Up</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 1 }}>{count ? `${count} new episode${count === 1 ? "" : "s"} and releases` : "Nothing out yet"}</div>
        </div>
        <button type="button" disabled={!month} onClick={() => { setMonth((m) => m - 1); setPick(null); }} aria-label="Previous month"
          style={{ ...iconBtn(34), opacity: month ? 1 : 0.35 }}><ChevronIcon dir="left" size={12} /></button>
        <button type="button" disabled={month >= 5} onClick={() => { setMonth((m) => m + 1); setPick(null); }} aria-label="Next month"
          style={{ ...iconBtn(34), opacity: month < 5 ? 1 : 0.35 }}><ChevronIcon dir="right" size={12} /></button>
      </div>
      <div style={{ display: "flex", gap: 14, margin: "10px 0 0", fontSize: 12, color: "var(--ink-dim)" }}>
        <LegendKey color="var(--chart-tv)" label="Episodes" /><LegendKey color="var(--chart-movie)" label="Movies" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginTop: 10, textAlign: "center" }}>
        {ACT_DAYS.map((w) => <span key={w} style={{ fontSize: 11, color: "var(--ink-faint)" }}>{w[0]}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = new Date(first.getFullYear(), first.getMonth(), i + 1);
          const k = dayKeyOf(d);
          const list = byDay.get(k) || [];
          const on = shownKey === k;
          const isToday = k === dayKeyOf(today);
          const past = d < today;
          return (
            <button key={k} type="button" disabled={!list.length} onClick={() => setPick(on && pick ? null : k)}
              aria-label={`${fmtDay(d)}${list.length ? `: ${list.map((x) => x.item.title).join(", ")}` : ""}`}
              style={{
                height: 40, padding: 0, border: "none", borderRadius: 10, cursor: list.length ? "pointer" : "default",
                background: on ? "var(--fill)" : "transparent", color: past ? "var(--ink-faint)" : "var(--ink)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, font: "inherit",
                boxShadow: isToday ? "inset 0 0 0 1.5px var(--accent)" : "none",
              }}>
              <span className="mono" style={{ fontSize: 13.5, fontWeight: list.length ? 700 : 400 }}>{i + 1}</span>
              <span style={{ display: "flex", gap: 2, height: 6 }}>
                {list.slice(0, 3).map((x, j) => <span key={j} style={{ width: 6, height: 6, borderRadius: 999, background: x.kind === "movie" ? "var(--chart-movie)" : "var(--chart-tv)" }} />)}
              </span>
            </button>
          );
        })}
      </div>
      {shown.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--line-soft)", paddingTop: 8 }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-dim)", marginBottom: 4 }}>{shownKey === dayKeyOf(today) ? "Today" : fmtDay(shownDate, { weekday: "long", day: "numeric", month: "long" })}</div>
          {shown.map((x) => (
            <button key={x.item.id} type="button" onClick={() => onOpenItem?.(x.item)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "6px 0", border: "none", background: "none",
              color: "var(--ink)", font: "inherit", textAlign: "left", cursor: "pointer",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: x.kind === "movie" ? "var(--chart-movie)" : "var(--chart-tv)" }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.item.title}</span>
              <span className="mono" style={{ fontSize: 12.5, color: "var(--ink-dim)", flexShrink: 0 }}>{x.what}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ============ Your eras ============
   The decades your shows and movies (not the Watchlist) come from. */
function YourEras({ items }) {
  const [pick, setPick] = useStateA(null);
  const by = new Map();
  for (const i of items) {
    if (i.status === "watchlist" || !i.year) continue;
    const dec = Math.floor(Number(i.year) / 10) * 10;
    const c = by.get(dec) || [0, 0];
    c[i.kind === "movie" ? 1 : 0]++;
    by.set(dec, c);
  }
  if (by.size < 2) return null;
  const tot = (d) => (by.get(d) || [0, 0]).reduce((a, v) => a + v, 0);
  const total = [...by.keys()].reduce((a, d) => a + tot(d), 0);
  // The axis starts at the first decade with at least 1% of your titles;
  // the few older ones are mentioned, not drawn as a long empty run.
  const decs = [...by.keys()].sort((a, b) => a - b);
  const from = decs.find((d) => tot(d) >= total * 0.01) ?? decs[0];
  const older = decs.filter((d) => d < from).reduce((a, d) => a + tot(d), 0);
  const all = [];
  for (let d = from; d <= decs[decs.length - 1]; d += 10) all.push(d);
  if (all.length < 2) return null;
  const top = all.reduce((a, d) => (tot(d) > tot(a) ? d : a), all[0]);
  const label = (d) => `${d}s`;
  const bars = all.map((d, i) => {
    const [tv, mv] = by.get(d) || [0, 0];
    return { label: String(d), values: [tv, mv], tick: all.length <= 6 || (all.length - 1 - i) % 2 === 0 ? `${d}s` : "", aria: `${label(d)}: ${tv} shows, ${mv} movies` };
  });
  const p = pick != null ? all[pick] : null;
  const [ptv, pmv] = p != null ? by.get(p) || [0, 0] : [0, 0];
  return (
    <ChartCard caption="Your Eras"
      readout={p != null ? `The ${label(p)}: ${ptv} show${ptv === 1 ? "" : "s"}, ${pmv} movie${pmv === 1 ? "" : "s"}` : `Mostly the ${label(top)}`}
      sub={p != null ? `${Math.round((tot(p) / total) * 100)}% of what you've watched` : `${Math.round((tot(top) / total) * 100)}% of what you've watched comes from that decade${older ? ` · ${older} older not shown` : ""}`}
      legend={<><LegendKey color="var(--chart-tv)" label="Shows" /><LegendKey color="var(--chart-movie)" label="Movies" /></>}>
      <ColumnChart bars={bars} colors={["var(--chart-tv)", "var(--chart-movie)"]} picked={pick} onPick={setPick} label="Titles by decade" />
    </ChartCard>
  );
}

/* ============ Your ratings ============ */
function YourRatings({ items }) {
  const [pick, setPick] = useStateA(null);
  const rated = items.filter((i) => i.rating > 0);
  if (rated.length < 3) return null;
  const bins = Array(10).fill(0);
  for (const i of rated) bins[Math.round(i.rating * 2) - 1]++;
  const avg = rated.reduce((a, i) => a + i.rating, 0) / rated.length;
  const peak = bins.indexOf(Math.max(...bins));
  const stars = (i) => (i + 1) / 2;
  const bars = bins.map((n, i) => ({ label: String(i), values: [n], tick: i % 2 ? `${stars(i)}★` : "", aria: `${starText(stars(i))}: ${n} titles` }));
  return (
    <ChartCard caption="Your Ratings"
      readout={pick != null ? `${starText(stars(pick))}: ${bins[pick]} title${bins[pick] === 1 ? "" : "s"}` : `Average ${avg.toFixed(1)} stars`}
      sub={pick != null ? `${Math.round((bins[pick] / rated.length) * 100)}% of your ratings` : `${rated.length.toLocaleString("en-GB")} rated · most often ${starText(stars(peak))}`}>
      <ColumnChart bars={bars} colors={["var(--star)"]} picked={pick} onPick={setPick} label="Ratings spread" height={100} />
    </ChartCard>
  );
}

function FlameIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2c.6 3.2-1.2 5-2.7 6.7C7.8 10.4 6.5 12 6.5 14.6 6.5 18.4 9 21 12 21s5.5-2.6 5.5-6.2c0-2.3-1-3.9-2.3-5.2.1 1.6-.5 2.9-1.6 3.4.4-3.9-.6-7.6-1.6-10z" />
    </svg>
  );
}
function RepeatIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </svg>
  );
}
function TrophyIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 3h10v2h3v3a4 4 0 0 1-4.1 4A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.1 12 4 4 0 0 1 4 8V5h3V3zm0 4H6v1a2 2 0 0 0 1.2 1.8A5 5 0 0 1 7 8.5V7zm10 0v1.5c0 .5-.1.9-.2 1.3A2 2 0 0 0 18 8V7h-1z" />
    </svg>
  );
}

Object.assign(window, { ActivitySection, activityStats });
