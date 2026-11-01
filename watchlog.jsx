/* watchlog.jsx — a history of what you watched and when, for Profile's
   Activity charts. A title only keeps its latest watch (`lastWatched`), so
   the history lives here: one entry per episode (or movie), keyed by the
   library item's id and the episode, holding when you watched it.

   It fills from a CSV watch history (a dated row per episode or movie,
   such as TV Time's watches.csv) and from episodes ticked and movies
   marked watched in the app. The same episode imported again keeps its
   latest date, so reading a file twice doesn't count it twice. It's kept
   on this device only (IndexedDB `tvt-log`; a big history runs to a few
   hundred KB, more than localStorage should carry), not synced.

   Keys: "t:<item id>:<season>:<episode>" for an episode, "m:<item id>"
   for a movie. Values: minutes since 1970, to keep it small. */
const { useState: useStateL, useEffect: useEffectL } = React;

let watchLog = {}; // key → minutes
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
    if (stored && typeof stored === "object") watchLog = { ...stored, ...watchLog };
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

/* logWatches — entries [{ key, at (ISO) }] into the history, each keeping
   the later of its dates. Returns how many were new or moved. */
function logWatches(entries) {
  let n = 0;
  for (const { key, at } of entries) {
    const min = toLogMin(at);
    if (!min || (watchLog[key] || 0) >= min) continue;
    watchLog[key] = min;
    n++;
  }
  if (n) { saveWatchLog(); watchLogNotify(); }
  return n;
}
/* How many of `entries` the history doesn't already have (at that date
   or later). */
const newWatches = (entries) => entries.filter(({ key, at }) => (watchLog[key] || 0) < toLogMin(at)).length;

/* logWatchStep — an edit that watched something: a show moved on to a
   later episode logs that episode; a movie moved to Watched logs the
   movie. Now, by the device's clock. */
function logWatchStep(before, after) {
  if (!before || !after) return;
  if (after.kind === "tv") {
    const on = after.season * 10000 + after.episode > before.season * 10000 + before.episode;
    if (on && after.episode > 0) logWatches([{ key: watchKey(after, after.season, after.episode), at: nowIso() }]);
  } else if (after.status === "watched" && before.status !== "watched") {
    logWatches([{ key: watchKey(after), at: nowIso() }]);
  }
}

/* useWatchLog — the history as [{ at (ms), kind: "tv" | "movie", id }],
   re-read when it changes. `ready` is false until it has loaded. */
function useWatchLog() {
  const [, bump] = useStateL(0);
  useEffectL(() => {
    const fn = () => bump((n) => n + 1);
    watchLogListeners.add(fn);
    return () => watchLogListeners.delete(fn);
  }, []);
  if (!watchLogEvents) {
    watchLogEvents = Object.entries(watchLog).map(([k, min]) => {
      const [t, id] = k.split(":");
      return { at: min * 60000, kind: t === "m" ? "movie" : "tv", id };
    });
  }
  return { events: watchLogEvents, version: watchLogVersion, ready: watchLogReady };
}

Object.assign(window, { logWatches, newWatches, logWatchStep, watchKey, useWatchLog });
