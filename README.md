# TV & Movie Tracker

A small installable web app (PWA) for keeping track of the shows and movies you're **watching**, **want to watch** and have **watched**. Three tabs along the bottom:

- **Watching**: what's up next from what you've been watching (the next episode, rolling on to the next season), your watchlist, titles like your recent ones and what you've finished lately.
- **Explore**: what's trending and popular on TMDB, for shows, movies or both, with search.
- **Profile**: total watch time split by shows and movies, top genres, awards for milestones, and your library's lists.

Tap any title for its sheet: big artwork, rating, dates and runtime, your status, progress and rating, and more like it. Sign in to sync your list across devices. Pull down on any screen to refresh: it syncs and fetches what's on screen afresh from TMDB. It uses the same look and motion as the Night Shift Calculator: iOS system colours, light and dark themes, spring animations, sheets you can pull down to close, and a night-sky loading screen whose logo leaps into the header.

There's no build step. React and Babel load from a CDN, and the `.jsx` files are compiled in the browser, so you can edit any file on GitHub (even from a phone) and the change is live once Pages redeploys.

## Run it

1. **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`.
2. Open `https://<your-user>.github.io/tvmoviestracker/` in Safari.
3. **Share → Add to Home Screen.** This matters on iPhone: Safari can clear website data that hasn't been used for a while, but a Home Screen app keeps its own storage.

### Title search and posters (TMDB)

1. Make a free account at [themoviedb.org](https://www.themoviedb.org), then **Settings → API** and request a key (personal use).
2. In the app: **Settings → Title search**, paste the *API Key* (or the longer *API Read Access Token*) and tap **Test**.

Explore, the title sheet's facts, Up Next's season roll-over and the watch-time stats all need the key; without it the app still tracks your list.

The key is stored on the device and, once you're signed in, in your profile, so other devices pick it up. It never goes in the repo.

### Sign-in and sync (Supabase)

This repo already points at its Supabase project, with the schema applied, so only steps 2 and 3 are left to do. For a fresh project, do all four.

1. Run [`supabase/schema.sql`](supabase/schema.sql) in your project's **SQL Editor**. It only adds two `tvt_`-prefixed tables with row-level security, so it can share a project with other apps.
2. **Authentication → Users → Add user → Create new user**: your email and a password, with *Auto Confirm User* ticked.
3. **Authentication → Sign In / Providers**: turn off *Allow new users to sign up*, so nobody else can make an account in your project.
4. Put the project URL and its **publishable** key (Project Settings → API Keys) at the top of `cloud.jsx`. Both are meant to be public; row-level security is what protects the data.

Then **Settings → Account → Sign in**. Sign-in uses a password rather than an emailed link: on iPhone a link opens in Safari, which doesn't share sign-in with the Home Screen app. iCloud Keychain can fill the password in.

## What's in it

| File | What it holds |
| --- | --- |
| `index.html` | Theme applied before first paint, the loading screen and its hand-off into the header, script tags. If a script fails, the error appears on the loading screen. |
| `styles.css` | Colour tokens (dark and light), spring easings, and every animation. |
| `components.jsx` | Shared building blocks: `Card`, `SegToggle`, button styles, `ScreenTitle`, `SectionHeader`, `ProgressBar`, `ModalFrame` (sheets and dialogs), `PullToRefresh`, `showToast`, `askConfirm`, `AnimatedRow`, `Collapse`, icons. |
| `tmdb.jsx` | TMDB search, image URLs, title details (cached on the device), the Explore lists, and the episode maths (`nextEpisode`, `episodesWatched`, `airedEpisodes`). |
| `cloud.jsx` | Supabase config, sign-in, the profile (TMDB key) and sync. |
| `detail.jsx` | The title sheet (`TitleSheet`): artwork, the facts strip, status tiles, progress, rating, more like this. |
| `browse.jsx` | The Watching and Explore screens, and the poster cards and shelves they're built from. |
| `profile.jsx` | The Profile screen: `watchStats`, the `BADGES` list, the library rows. |
| `importcsv.jsx` | CSV import: the parser, column matching (`CSV_HEADS`), merging into the library (`planImport`), matching titles on TMDB afterwards, and the import sheet. |
| `app.jsx` | The data model, routing between tabs, the list screens, add/edit sheet, settings and tab bar. |
| `supabase/schema.sql` | The tables and row-level security for sync. |
| `sw.js` | Offline support. The app's own files are network-first, so a deploy shows up on the next reload. TMDB posters are cache-first (the latest 600). |
| `check.js` | CI check: every `.jsx` file compiles, is precached and declares no name another file does. Runs on each push. |

## Data

Everything is saved on the device first, in `localStorage` under `tvt:v1`, so the app works offline and signed out. What the app loads from TMDB is kept on the device too, so it opens with it straight away, even offline, and refreshes it in the background:

| Key | What | Refreshed |
| --- | --- | --- |
| `tvt:tmdb:v1` | Details of titles you've looked at (the latest 2,000; synopses only for the ones opened lately) | Shows daily, movies monthly |
| `tvt:lists:v1` | Explore's lists | After half an hour |
| `tvt:recs:v1` | "More like this" for the 60 titles you opened last | With the title's details |
| `tvt-img-v1` (service worker cache) | Posters and stills (the latest 600) | Never: TMDB image files don't change |

They're only caches: each is dropped first if storage runs short. Pulling down to refresh fetches the lists and titles on screen, and the shows you're watching, straight away.

**Settings → Export** saves a JSON backup (on iPhone it opens the share sheet, so you can use *Save to Files*), and **Import** restores one.

### Importing CSV files

**Settings → Import CSV** takes one or more CSV files: your ratings, library, watched history and lists, from a spreadsheet or another tracker's export (Letterboxd, IMDb, Trakt- or TV Time-style). Each file is read by its column names: it needs a *Title* or *Name* column, and uses any of type, year, TMDB or IMDb id (or a TMDB/IMDb URL), rating, status, season and episode, note and date added it finds (`CSV_HEADS` in `importcsv.jsx` lists the names it knows). Comma, semicolon and tab separators all work.

For each file you say what it holds (it guesses from the file name), which decides where titles go when the file has no status column: *Ratings* and *Watched* into Watched, *Library* and *List* into the Watchlist. With *Library*, *List* or *Watched*, a show with episodes watched goes to Watching instead. A watch history with a row per episode becomes one title at the last episode watched. Under each file the sheet lists the columns it read, and above the Import button where the titles will land, so a status or episode column it didn't recognise shows up before anything changes.

Imports merge: titles already in your library (matched by TMDB id, else by name and year) get the file's rating and progress, and move further along but never back (Watchlist → Watching → Watched); a show in your Watchlist that the file gives episode progress moves to Watching. So importing a file again, with the right columns, puts titles where they belong. Nothing is removed, and Undo puts everything back. Ratings out of 10 or 100 become stars, to the nearest half; half stars (Letterboxd's) are kept. Afterwards, with a TMDB key, titles without a TMDB id are matched on TMDB (by IMDb id, else by name and year) for posters, runtimes and Up Next; a title it can't match confidently is left as it is. A lost connection is retried; if the match is cut off (the app closed, or the phone slept), titles with a TMDB id but no poster are filled in the next time the app opens.

Signed in, each title is also a row in `tvt_items`, with the whole item in a `data` column. Devices sync when you sign in, when the app comes back to the foreground or back online, and a moment after each change. They merge title by title, and the newer edit wins. A delete leaves a tombstone row (`deleted = true`) so the other devices drop the title too. Undo and Import count as fresh edits, so they win over what they replace.

```js
{
  id, kind: "tv" | "movie", title,
  status: "watching" | "watchlist" | "watched",
  season, episode,   // TV only: last episode watched (episode 0 = not started)
  rating,            // 0–5 in half stars, 0 = unrated
  note,
  tmdbId, poster, year, // from TMDB search; null / "" for titles typed in
  added, updated     // ISO dates; `updated` decides which edit wins a sync
}
```

### How watch time is counted

A watched movie counts its TMDB runtime. A show counts the episodes up to your progress (season and episode), or every aired episode once it's in Watched, times its typical episode length. Watchlist titles count for nothing. Titles without a TMDB runtime (typed in by hand, or missing on TMDB) are estimated at 45 minutes an episode or 1h 50m a movie, and Profile says how many are. Each title's time goes to its first genre for *Top Genres*.

## Adding features

- **A new field** (e.g. platform): give it a default in `normaliseItem`, then add an input to `ItemSheet`. Old saved data, backups and synced rows pick up the default automatically; the database needs no change.
- **A new status** (e.g. *Dropped*): add an entry to `STATUSES`. That gives it a list screen (Profile → Library), a status tile on the title sheet and a place in the edit sheet.
- **A new tab**: add it to `TABS` in `app.jsx` and a branch where `App` picks the screen.
- **A new award**: add an entry to `BADGES` in `profile.jsx`, with the stat it reads (`of`) and its `goal`.
- **A new Explore shelf**: add a row to `EXPLORE` in `browse.jsx` with any TMDB list path (e.g. `/discover/tv?with_networks=213`).
- **A CSV column the import doesn't know**: add its header (lower-case, letters and digits only) to the right field in `CSV_HEADS` in `importcsv.jsx`.
- **A new one-tap button on a row**: add a case to `quickAction`. If it moves the title to another tab, the row folds away and an Undo toast appears automatically.
- **A new file**: add a `<script type="text/babel">` tag before `app.jsx` in `index.html` and list it in `ASSETS` in `sw.js` (CI fails if you forget). Files share one global scope, so give hooks unique names, as `components.jsx` does (`useStateC`); CI fails if two files declare the same top-level name.
- **More from TMDB** (cast, where to stream): `tmdbGet` in `tmdb.jsx` calls any endpoint, and each linked title has its `tmdbId`. For something on the title sheet, add it to `compactDetails` (and to the `append_to_response` in `loadDetails` if it's a sub-request).
- **A profile setting that follows you**: add a column to `tvt_profiles` and load/save it next to the TMDB key in `useProfileKey` (`cloud.jsx`).

## Motion cheatsheet

| Class / helper | Effect |
| --- | --- |
| `.tvt-view > *` | Blocks on a screen rise in one after another (key the screen to replay it). |
| `.tvt-view.tvt-push` | The same, sliding in from the right (a list pushed over a tab). |
| `.tvt-shelf` | A row of cards that scrolls sideways, edge to edge, snapping card by card. |
| `AnimatedRow` + `useFoldAway` | List rows cascade in and fold shut when removed. |
| `.tvt-pop` (keyed by value) | A number or badge pops when it changes. |
| `.tvt-check-pop` | Press-and-release spring (used by the stars). |
| `ModalFrame sheet` | Bottom sheet that springs up and can be flung down to close. |
| `--ease-bouncy / snappy / soft / wobbly` | Spring curves for your own transitions. |

The OS *Reduce Motion* setting turns all of it off.
