"use strict";

// Offline support. The app's own files are network-first: a deploy shows
// up on the next reload, with no cache version to remember to bump, and
// the cached copy is the fallback when offline. Change CACHE only to throw
// the whole cache away.
const CACHE = "tvt-v1";
const FONT_CACHE = "tvt-fonts-v1";
// TMDB posters and stills you've seen, so they show offline and at once on
// the next launch. Past IMG_MAX the oldest are dropped.
const IMG_CACHE = "tvt-img-v1";
const IMG_MAX = 600;
// TMDB's image server, AniList's (covers and banners for anime) and Open
// Library's book covers.
const IMG_HOSTS = new Set(["image.tmdb.org", "s4.anilist.co", "covers.openlibrary.org"]);

// Precached on install, so the app opens offline after the first visit.
// A file missing from this list is still cached the first time it loads.
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./styles.css",
  "./components.jsx",
  "./tmdb.jsx",
  "./tvmaze.jsx",
  "./wikidata.jsx",
  "./trakt.jsx",
  "./anilist.jsx",
  "./cloud.jsx",
  "./watchlog.jsx",
  "./detail.jsx",
  "./browse.jsx",
  "./profile.jsx",
  "./activity.jsx",
  "./importcsv.jsx",
  "./books.jsx",
  "./app.jsx",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

// React, Supabase and Babel load from a CDN at pinned versions
// (index.html). Those files never change, so they are cache-first. Calls
// to Supabase, TMDB, TVmaze, Wikidata, Trakt, AniList and Open Library pass straight through.
const CDN_ASSETS = [
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
  "https://unpkg.com/@supabase/supabase-js@2.117.3/dist/umd/supabase.js",
  "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js",
];
const CDN_HOSTS = new Set(["unpkg.com"]);

// Cache each file on its own: cache.addAll() is all-or-nothing.
const precache = (cache, urls, init) =>
  Promise.all(
    urls.map((u) =>
      fetch(new Request(u, init))
        .then((res) => (res.ok ? cache.put(u, res) : null))
        .catch(() => null),
    ),
  );

// Oldest first: a cache lists its entries in the order they were added.
let trimTimer = 0;
function trimImagesSoon() {
  clearTimeout(trimTimer);
  trimTimer = setTimeout(() => {
    caches.open(IMG_CACHE).then((cache) =>
      cache.keys().then((keys) =>
        Promise.all(keys.slice(0, Math.max(0, keys.length - IMG_MAX)).map((k) => cache.delete(k))),
      ),
    );
  }, 2000);
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all([
          precache(cache, ASSETS, { cache: "reload" }),
          precache(cache, CDN_ASSETS, { mode: "cors", credentials: "omit" }),
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== FONT_CACHE && k !== IMG_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // Google Fonts: stale-while-revalidate.
  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    e.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(e.request).then((cached) => {
          const fresh = fetch(e.request)
            .then((res) => {
              cache.put(e.request, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || fresh;
        }),
      ),
    );
    return;
  }

  // TMDB and AniList images: cache-first. Fetched with CORS (TMDB's image server
  // allows it), so the cache holds real responses rather than opaque ones,
  // which count far bigger against storage. If that fails, the image is
  // fetched as the page asked, uncached.
  if (IMG_HOSTS.has(url.hostname)) {
    e.respondWith(
      caches.open(IMG_CACHE).then((cache) =>
        cache.match(e.request.url).then(
          (cached) =>
            cached ||
            fetch(e.request.url, { mode: "cors", credentials: "omit" })
              .then((res) => {
                if (res.ok) cache.put(e.request.url, res.clone()).then(trimImagesSoon);
                return res;
              })
              .catch(() => fetch(e.request)),
        ),
      ),
    );
    return;
  }

  // Pinned CDN scripts: cache-first.
  if (CDN_HOSTS.has(url.hostname)) {
    e.respondWith(
      caches.match(e.request, { ignoreVary: true }).then(
        (cached) =>
          cached ||
          fetch(e.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // The app's own files: network-first, falling back to the cache (and,
  // for a page, to the cached shell).
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Only a good response replaces the cached copy.
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches
          .match(e.request, { ignoreSearch: true })
          .then(
            (cached) =>
              cached ||
              (e.request.mode === "navigate"
                ? caches.match("./index.html")
                : undefined),
          ),
      ),
  );
});
