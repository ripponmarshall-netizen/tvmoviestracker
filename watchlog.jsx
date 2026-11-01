/* watchlog.jsx — a history of what you watched and when, for Profile's
   Activity charts. A title only keeps its latest watch (`lastWatched`), so
   the history lives here: one entry per episode (or movie), keyed by the
   library item's id and the episode, holding every time you watched it,
   so a rewatch is a second date on the same entry.

   It fills from a CSV watch history (a dated row per episode or movie,
   such as TV Time's watches.csv, whose first and last watch dates both
   count) and from the app: episodes ticked, movies marked watched, a
   rewatch ticked through, a movie watched again. A date already there
   isn't added twice, so reading a file again doesn't double it. It's kept
   on this device only (IndexedDB `tvt-log`; a big history runs to a few
   hundred KB, more than localStorage should carry), not synced.

   Keys: "t:<item id>:<season>:<episode>" for an episode, "m:<item id>"
   for a movie. Values: the times watched, oldest first, as minutes since
   1970 (to keep it small). Histories saved before rewatches held one
   number; they're read as a list of one. */
const { useState: useStateL, useEffect: useEffectL } = React;

let watchLog = {}; // key → [minutes, …], oldest first
let watchLogReady = false;
const watchLogListeners = new Set();
let watchLogVersion = 0;
let watchLogEvents = null; // the parsed list, until the next change
const watchLogNotify = () => {
  watchLogVersion++;
  watchLogEvents = null;
  watchLogListeners.forEach((fn) => fn());
};

function watchLogStore(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("tvt-log", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("log");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("log", mode);
      const req = fn(tx.objectStore("log"));
      tx.oncomplete = () => { db.close(); resolve(req?.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

// Loaded once, as the app starts. Entries logged before it finishes are
// kept: the stored ones only fill in around them.
const watchLogLoading = (async () => {
  try {
    const stored = await watchLogStore("readonly", (s) => s.get("entries"));
    if (stored && typeof stored === "object") {
      const merged = {};
      for (const [k, v] of Object.entries(stored)) merged[k] = (Array.isArray(v) ? v : [v]).filter((m) => m > 0);
      for (const [k, v] of Object.entries(watchLog)) merged[k] = unionMins(merged[k], v);
      watchLog = merged;
    }
  } catch {}
  watchLogReady = true;
  watchLogNotify();
})();

let watchLogTimer = 0;
function saveWatchLog() {
  clearTimeout(watchLogTimer);
  watchLogTimer = setTimeout(async () => {
    await watchLogLoading;
    try { await watchLogStore("readwrite", (s) => s.put(watchLog, "entries")); } catch {}
  }, 600);
}

const watchKey = (item, season, episode) =>
  item.kind === "movie" ? `m:${item.id}` : `t:${item.id}:${season}:${episode}`;
const toLogMin = (iso) => Math.floor((Date.parse(iso) || 0) / 60000);
const unionMins = (a = [], b = []) => [...new Set([...a, ...b])].sort((x, y) => x - y);
/* A tick on an episode watched in the app under CORRECTION_MIN ago is a
   correction (ticked, undone, ticked again), not a rewatch: it moves the
   date rather than adding one. */
const CORRECTION_MIN = 6 * 60;

/* logWatches — entries [{ key, at (ISO) }] into the history: a date it
   doesn't have yet is added. With `live` (a tick in the app, now), one
   within CORRECTION_MIN of the latest replaces it. Returns how many dates
   were added. */
function logWatches(entries, { live = false } = {}) {
  let n = 0;
  for (const { key, at } of entries) {
    const min = toLogMin(at);
    const have = watchLog[key] || [];
    if (!min || have.includes(min)) continue;
    const last = have[have.length - 1];
    if (live && last && min - last >= 0 && min - last < CORRECTION_MIN) {
      watchLog[key] = [...have.slice(0, -1), min];
    } else {
      watchLog[key] = unionMins(have, [min]);
      n++;
    }
  }
  saveWatchLog();
  watchLogNotify();
  return n;
}
/* unlogWatch — takes one date off (the Undo of "Watched It Again"). */
function unlogWatch(key, at) {
  const min = toLogMin(at);
  const have = watchLog[key];
  if (!have?.includes(min)) return;
  const left = have.filter((m) => m !== min);
  if (left.length) watchLog[key] = left; else delete watchLog[key];
  saveWatchLog();
  watchLogNotify();
}
/* How many of `entries` the history doesn't already have. */
const newWatches = (entries) => entries.filter(({ key, at }) => !(watchLog[key] || []).includes(toLogMin(at))).length;

/* logWatchStep — an edit that watched something: a show moved on to a
   later episode logs that episode; a movie moved to Watched logs the
   movie. Now, by the device's clock. */
function logWatchStep(before, after) {
  if (!before || !after) return;
  if (after.kind === "tv") {
    const on = after.season * 10000 + after.episode > before.season * 10000 + before.episode;
    if (on && after.episode > 0) logWatches([{ key: watchKey(after, after.season, after.episode), at: nowIso() }], { live: true });
  } else if (after.status === "watched" && before.status !== "watched") {
    logWatches([{ key: watchKey(after), at: nowIso() }], { live: true });
  }
}

/* useWatchLog — the history as [{ at (ms), kind: "tv" | "movie", id,
   again (a rewatch: not the first time for that episode or movie) }],
   re-read when it changes. `repeats` maps an item's id to its rewatched
   episodes or movie viewings. `ready` is false until it has loaded. */
function useWatchLog() {
  const [, bump] = useStateL(0);
  useEffectL(() => {
    const fn = () => bump((n) => n + 1);
    watchLogListeners.add(fn);
    return () => watchLogListeners.delete(fn);
  }, []);
  if (!watchLogEvents) {
    const events = [], repeats = new Map();
    for (const [k, mins] of Object.entries(watchLog)) {
      const [t, id] = k.split(":");
      const kind = t === "m" ? "movie" : "tv";
      mins.forEach((min, i) => events.push({ at: min * 60000, kind, id, again: i > 0 }));
      if (mins.length > 1) repeats.set(id, (repeats.get(id) || 0) + mins.length - 1);
    }
    watchLogEvents = { events, repeats };
  }
  return { ...watchLogEvents, version: watchLogVersion, ready: watchLogReady };
}

Object.assign(window, { logWatches, unlogWatch, newWatches, logWatchStep, watchKey, useWatchLog });
