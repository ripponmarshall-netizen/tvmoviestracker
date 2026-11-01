# Nostalgiaa

A small installable web app (PWA) for keeping track of the shows and movies you're **watching**, **want to watch** and have **watched**, and the books you're **reading**. Four tabs along the bottom:

- **Watching**: *Up Next*, the next episode of what you've watched in the last 30 days (rolling on to the next season); *Not Started*, shows with no episode ticked yet; *Caught Up*, shows you've seen everything out of; your watchlist, titles like your recent ones, what you've finished lately and *On Hold*, what you haven't watched in a while. Each list folds away under its header, and its **•••** menu acts on all its shows (mark all caught up, move all to Watched or the Watchlist). Every row has a **•••** menu too: tick the next episode, *I'm Caught Up* (jump to the latest episode out), choose the episode you're on, move or remove it.
- **Explore**: what's trending and popular on TMDB, for shows, movies or both, with search. **Anime** swaps in AniList's shelves (trending, airing this season with each show's next-episode countdown, next season, all-time popular, top rated, films) and searches AniList, in English or Japanese names. A **+** on any search result puts it on your Watchlist without opening it.
- **Books**: what you're *Reading* (the page you're on, out of how many, with a progress bar), *Want to Read* and *Read*, with how many books and pages you've read this year. Search [Open Library](https://openlibrary.org) by title, author or ISBN; **+** puts a book on Want to Read, and one it hasn't got can be added by hand. Tap a book for its sheet: status, your page (with −10/+10/+25/+50 and *I've Finished It*), rating, note, its description and its details to edit. **Import from Goodreads or StoryGraph** brings in either's CSV export.
- **Profile**: your username and picture (Edit Profile), with a small green tick beside the name once synced (tap it for details), library counts, total watch time split by shows and movies, top genres, awards for milestones, your library's lists (each with search and a sort dropdown) and CSV import. Settings is the gear beside the Profile title, the only button at the top of any screen; the header is just the logo and name.

Tap any title for its sheet: big artwork, rating, dates and runtime, your status, progress and rating, *Where to Watch* (the services with it in your country, from JustWatch), a show's schedule from TVmaze (your next episode by name, the next to air in your time zone, the latest out, and its days and channel), *Did You Know* from Wikidata (awards, box office against budget, what it's based on, who made it, where it was filmed and set, its series), *On Trakt* (Trakt's rating, watchers and plays), *On AniList* for anime (score, rank, studio, source, season, the next episode to the minute, tags, and its prequels, sequels and spin-offs, each a tap away) and more like it. Sign in to sync your list across devices. Pull down on any screen to refresh: it syncs and fetches what's on screen afresh from TMDB. It uses the same look and motion as the Night Shift Calculator: iOS system colours, light and dark themes, spring animations and sheets you can pull down to close. The loading screen is a strip of film (its frames your own posters) rolling up the screen behind the logo, an old television with a sunset on its screen; once the app is ready the film whooshes off the top and the splash cross-fades into the app as it rises in.

There's no build step. React and Babel load from a CDN, and the `.jsx` files are compiled in the browser, so you can edit any file on GitHub (even from a phone) and the change is live once Pages redeploys.

## Run it

1. **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`.
2. Open `https://<your-user>.github.io/tvmoviestracker/` in Safari.
3. **Share → Add to Home Screen.** This matters on iPhone: Safari can clear website data that hasn't been used for a while, but a Home Screen app keeps its own storage.

### Title search and posters (TMDB)

1. Make a free account at [themoviedb.org](https://www.themoviedb.org), then **Settings → API** and request a key (personal use).
2. In the app: **Settings → Title search**, paste the *API Key* (or the longer *API Read Access Token*) and tap **Test**.

Explore, the title sheet's facts, Up Next's season roll-over and the watch-time stats all need the key; without it the app still tracks your list.

### Schedules (TVmaze)

Nothing to set up: [TVmaze](https://www.tvmaze.com/api) is free and needs no key. A show is found by its IMDb or TVDB id (from TMDB's details), else by name and year. Its data is licensed CC BY-SA 4.0, so the title sheet links to TVmaze and **Settings → About → Credits** lists it, with TMDB, Supabase and the open-source code the app uses.

The key is stored on the device and, once you're signed in, in your profile, so other devices pick it up. It never goes in the repo.

### Where to Watch (JustWatch)

JustWatch has no public API, so the data comes the licensed way: TMDB's `/watch/providers`, which is JustWatch's, in the same request as the title's details (so it needs the TMDB key). **Settings → Where to Watch** picks the country; it starts as Jamaica on a phone set to Jamaica's time zone. Where JustWatch lists nothing for your country, the sheet says so and shows the US. Tapping a service opens TMDB's page for the title, which links on to each one.

### Did You Know (Wikidata)

Nothing to set up: [Wikidata](https://www.wikidata.org) is free and needs no key. A title is found by its TMDB id (or IMDb id) with one SPARQL query to `query.wikidata.org`, only when its sheet opens. Money is shown only where Wikidata has it in US dollars. Its data is CC0.

### Anime (AniList)

Nothing to set up for the title sheet or Explore → Anime: [AniList](https://anilist.co)'s GraphQL API (`graphql.anilist.co`) is free, needs no key and answers any origin. A title counts as anime when TMDB has it as Animation in Japanese (`anime` in its details); its AniList entry is found by its Japanese name, then English, of the same type and year. A card opened from AniList is matched to its TMDB title (by its English, romaji or Japanese name against TMDB's name and original name, animated only, within a year), or, for a sequel AniList names "Season 2", its prequel's; that needs the TMDB key, and without one it's tracked as a title typed in. Links both ways are kept on the device (`tvt:anilist:v1`).

**Settings → AniList → Import** brings in a public AniList list by username (needs the TMDB key). AniList has one entry per season or cour; TMDB one show with seasons. Each entry goes to its TMDB show (its own match, else its prequel's), your episodes across the seasons before it on that show are added up, and the total is laid onto TMDB's seasons, so *Season 2, episode 10 of 23* after a 24-episode first season lands on S2 · E10. The furthest entry decides the status: watching, paused or dropped are Watching (old ones fall into On Hold), planning is the Watchlist, completed is Watched only once TMDB has nothing more out. Scores out of 100 become stars; a finished movie's completion date goes into Activity. Specials, OVAs and dropped movies are left out, and the confirm dialog says how many didn't match. It goes through the same merge as a CSV import, with Undo.

### Books (Open Library)

Nothing to set up: [Open Library](https://openlibrary.org/developers/api)'s API is free and needs no key. Search uses `/search.json`, an ISBN it doesn't index falls back to `/isbn/{isbn}.json`, a book's sheet loads its work (`/works/OL…W.json`) for the description, and covers come from `covers.openlibrary.org` by cover id (covers by ISBN are rate-limited; by id they aren't).

Books are items like any other (`kind: "book"`), so they sync, back up and undo the same way; the database needs no change. `App` hands the TV and movie screens, TMDB lookups, the CSV, Trakt and AniList imports, Profile's stats and Activity only shows and movies, so a book never reaches TMDB or counts as watch time.

**Import from Goodreads or StoryGraph** (the Books tab) reads Goodreads' *Export Library* CSV (Exclusive Shelf, My Rating, ISBN13, Date Read, My Review…) or StoryGraph's (Read Status, Star Rating, ISBN/UID, Last Date Read…). read → Read, currently-reading and paused → Reading, to-read and other shelves → Want to Read; did-not-finish is left out. Books you have are matched by ISBN, else title and author, and move forward but never back, gaining a rating, date read, pages or note they lacked. Afterwards books without an Open Library link are looked up there one at a time in the background (by ISBN, else title and author) for a cover and page count; a miss isn't tried again (`tvt:olmiss:v1`). The CSV import under Settings turns a book export away rather than make shows of it.

### Trakt

1. Make a free API app at [trakt.tv → Your API Apps](https://trakt.tv/oauth/applications/new). Redirect URI: `urn:ietf:wg:oauth:2.0:oob`. JavaScript (CORS) origins: your Pages address, e.g. `https://<your-user>.github.io` (without it, the browser is refused).
2. **Settings → Trakt**: paste its *Client ID*. That's enough for *On Trakt* on the title sheet.
3. To bring in your history, paste the *Client Secret* too and tap **Connect Trakt Account**: the app shows a code to enter at trakt.tv/activate. Then **Import from Trakt**.

The import goes through the same merge as a CSV import (below): each show moves to the last episode you watched on Trakt (episodes before a progress reset don't count), with when you watched it, so Up Next and On Hold are right; watched movies go to Watched, your watchlist to the Watchlist, and ratings out of 10 become stars. Nothing goes back a step and Undo puts it all back. The Client ID, secret and sign-in stay on the device (`tvt:trakt:v1`); Trakt's sign-in now lasts a day and renews itself.

### Sign-in and sync (Supabase)

This repo already points at its Supabase project, with the schema applied, so only steps 2 and 3 are left to do. For a fresh project, do all four.

1. Run [`supabase/schema.sql`](supabase/schema.sql) in your project's **SQL Editor**. It only adds two `tvt_`-prefixed tables with row-level security, so it can share a project with other apps. It's safe to run again, and running it again is how an existing project picks up new columns (v1.5 added `avatar`, for the profile picture, and v1.6 `username`; until a column is there that setting stays on each device and everything else syncs as usual).
2. **Authentication → Users → Add user → Create new user**: your email and a password, with *Auto Confirm User* ticked.
3. **Authentication → Sign In / Providers**: turn off *Allow new users to sign up*, so nobody else can make an account in your project.
4. Put the project URL and its **publishable** key (Project Settings → API Keys) at the top of `cloud.jsx`. Both are meant to be public; row-level security is what protects the data.

Then **Settings → Account → Sign in**. Sign-in uses a password rather than an emailed link: on iPhone a link opens in Safari, which doesn't share sign-in with the Home Screen app. iCloud Keychain can fill the password in.

## What's in it

| File | What it holds |
| --- | --- |
| `index.html` | Theme applied before first paint, the film-strip loading screen and its cross-fade into the app, script tags. If a script fails, the error appears on the loading screen. |
| `styles.css` | Colour tokens (dark and light), layout tokens (`--page-max`, the side gutters `--pad-l`/`--pad-r`, which clear the notch in landscape and widen on iPad), the responsive grids (`.tvt-tiles`, `.tvt-awards`, `.tvt-hero`), the font (Geist), spring easings, and every animation. |
| `components.jsx` | Shared building blocks: `Card`, `SegToggle`, button styles, `ScreenTitle`, `SectionHeader`, `ProgressBar`, `ModalFrame` (sheets and dialogs), `showMenu` (action sheets), `FoldSection` and `useFold` (fold-away sections), `Picker` (a dropdown), `PullToRefresh`, `showToast`, `askConfirm`, `AnimatedRow`, `Collapse`, icons. |
| `tmdb.jsx` | TMDB search, image URLs, title details (cached on the device) with where to watch them (`providersFor`, `setWatchRegion`), the Explore lists, and the episode maths (`nextEpisode`, `episodesWatched`, `airedEpisodes`, `latestAired`). |
| `wikidata.jsx` | Wikidata: the SPARQL query (`wikidataQuery`), the facts it keeps (`compactWikidata`, cached on the device), `useWikidata`, and the title sheet's Did You Know section (`WikidataSection`). |
| `anilist.jsx` | AniList: the request queue (`anilistQuery`, two at a time, waits out a 429), title facts (`useAnilist`, `AnilistSection`), matching both ways (`findAnilistId`, `tmdbAnimeMatch`, `resolveAnilistToTmdb`), Explore's Anime shelves and search (`useAnimeExplore`, `useAnilistSearch`), and the list import (`fetchAnilistLibrary`, `absToSeasonEp`, `AnilistSettings`). |
| `trakt.jsx` | Trakt: settings and device sign-in (`traktDeviceCode`, `traktWaitForSignIn`, token refresh), community stats (`useTraktStats`, `TraktSection`), your history as import records (`fetchTraktLibrary`), and the Settings panel (`TraktSettings`). |
| `tvmaze.jsx` | TVmaze: finding a show (`findTvmazeId`), its next and latest episodes and schedule (cached on the device), episode names (`useTvmaze`), and the title sheet's Schedule section (`AirSection`). |
| `cloud.jsx` | Supabase config, sign-in, the profile (TMDB key, username, profile picture) and sync. |
| `detail.jsx` | The title sheet (`TitleSheet`): artwork, the facts strip, status tiles, progress (with `EpisodePicker`, the season and episode dropdowns), rating, more like this. |
| `browse.jsx` | The Watching and Explore screens (`watchingGroup` decides Up Next, Not Started, Caught Up or On Hold), and the poster cards and shelves they're built from. |
| `profile.jsx` | The Profile screen: the username (`cleanUsername`, `ProfileSheet`), the profile picture (`avatarFromFile`, `AvatarPicker`), `watchStats`, the `BADGES` list, the library rows. |
| `activity.jsx` | Profile's Activity section: the calendar heatmap and streaks (`activityStats`, which sets aside watches marked in bulk), When You Watch, Coming Up, Your Eras and Your Ratings, and the shared `ColumnChart`. |
| `watchlog.jsx` | The watch history behind Activity: one dated entry per episode or movie, in IndexedDB on the device (`logWatches`, `logWatchStep`, `useWatchLog`). |
| `books.jsx` | Books: Open Library search and lookups (`olSearch`, `useOlWork`, `useBookBackfill`), the Books tab (`BooksView`), the book sheet (`BookSheet`, with `PageSection`), book fields (`bookFields`, `bookStatusPatch`), matching (`findBook`) and the Goodreads and StoryGraph import (`bookRecords`, `planBookImport`, `BookImportSheet`). |
| `importcsv.jsx` | CSV import: the parser, column matching (`CSV_HEADS`), merging into the library (`planImport`), matching titles on TMDB afterwards, and the import sheet. |
| `app.jsx` | The data model, routing between tabs, the "•••" menus (`itemMenu`, `bulkMenu`), catching up (`catchUp`), the list screens, add/edit sheet, settings (with `CREDITS`, the attributions) and tab bar. |
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
| `tvt:tvmaze:v1` | TVmaze schedules for the 300 shows opened last | After 12 hours, or once the next episode has aired |
| `tvt:wikidata:v1` | Wikidata facts for the 300 titles opened last | After 30 days (a week for one Wikidata hasn't got) |
| `tvt:traktstats:v1` | Trakt's numbers for the 300 titles opened last | After 3 days |
| `tvt:anilist:v1` | AniList facts for the 300 anime opened last, AniList ↔ TMDB links, and Explore's Anime shelves | A day (12 hours while airing); links after 30 days (7 for a miss); shelves after half an hour |
| `tvt-img-v1` (service worker cache) | Posters and stills, TMDB's and AniList's (the latest 600) | Never: TMDB image files don't change |

They're only caches: each is dropped first if storage runs short. Pulling down to refresh fetches the lists and titles on screen, and the shows you're watching, straight away.

**Settings → Export** saves a JSON backup (on iPhone it opens the share sheet, so you can use *Save to Files*), and **Import** restores one.

### Importing CSV files

**Settings → Import CSV** takes one or more CSV files: your ratings, library, watched history and lists, from a spreadsheet or another tracker's export (Letterboxd, IMDb, Trakt- or TV Time-style). Each file is read by its column names: it needs a *Title* or *Name* column, and uses any of type, year, TMDB or IMDb id (or a TMDB/IMDb URL), rating, status, season and episode, note and date added it finds (`CSV_HEADS` in `importcsv.jsx` lists the names it knows). Comma, semicolon and tab separators all work.

For each file you say what it holds (it guesses from the file name), which decides where titles go when the file has no status column: *Ratings* and *Watched* into Watched, *Library* and *List* into the Watchlist. With *Library*, *List* or *Watched*, a show with episodes watched goes to Watching instead. A watch history with a row per episode (a show column plus season and episode numbers, or an `S02E05`-style code) becomes one show at the furthest episode watched, with the latest watch date as when you last watched it; a file named like `watches.csv` or `history.csv` is read as one. Where an *Episode* column holds names and another holds numbers, the numbers win. Each file shows how many shows it found episode progress for. Under each file the sheet lists the columns it read, and above the Import button where the titles will land, so a status or episode column it didn't recognise shows up before anything changes.

Imports merge: titles already in your library (matched by TMDB id, else by name and year) get the file's rating and progress (and, for a show that had no episode ticked, the file's watch date as when you last watched it), and move further along but never back (Watchlist → Watching → Watched); a show in your Watchlist that the file gives episode progress moves to Watching. So importing a file again, with the right columns, puts titles where they belong. Nothing is removed, and Undo puts everything back. Ratings out of 10 or 100 become stars, to the nearest half; half stars (Letterboxd's) are kept. Afterwards, with a TMDB key, titles without a TMDB id are matched on TMDB (by IMDb id, else by name and year) for posters, runtimes and Up Next; a title it can't match confidently is left as it is. A lost connection is retried; if the match is cut off (the app closed, or the phone slept), titles with a TMDB id but no poster are filled in the next time the app opens.

**Recent Files**: each file you import is kept on the device (IndexedDB `tvt-csv`, the last 8, one per file name, never synced) and listed in the import sheet under *Recent Files*. *Read Again* runs it through the current importer without picking it from Files again, as the role you last imported it as. That brings in anything a newer version of the app reads that an older one didn't (TV Time's episode history, say). Titles the file matches that still have no TMDB link or poster are matched on TMDB again, even when nothing else changes: the button then reads *Update N titles*.

Signed in, each title is also a row in `tvt_items`, with the whole item in a `data` column. Devices sync when you sign in, when the app comes back to the foreground or back online, and a moment after each change. They merge title by title, and the newer edit wins. A delete leaves a tombstone row (`deleted = true`) so the other devices drop the title too. Undo and Import count as fresh edits, so they win over what they replace.

```js
{
  id, kind: "tv" | "movie" | "book", title,
  status: "watching" | "watchlist" | "watched",
  season, episode,   // TV only: last episode watched (episode 0 = not started)
  rating,            // 0–5 in half stars, 0 = unrated
  note,
  tmdbId, poster, year, // from TMDB search; null / "" for titles typed in
  added, updated,    // ISO dates; `updated` decides which edit wins a sync
  lastWatched,       // ISO date you last moved it on ("" = never); Up Next vs On Hold
  rewatch,           // { season, episode } while rewatching a show, else null
  rewatches          // rewatches finished (a show through again, a movie again)
}
// A book (kind: "book") has the same status values, shown as Reading,
// Want to Read and Read, and also:
{
  author, page,      // the last page read (0 = not started)
  pages,             // total pages (0 = not known); an ebook can use 100 for percent
  olKey, cover,      // Open Library work ("/works/OL…W") and cover id; "" / null when typed in
  isbn, finished     // ISO date it moved to Read, for "read this year"
}
```

### Activity (Profile)

A title only keeps when you last watched it, so Activity has its own history (`watchlog.jsx`): one entry per episode or movie with when you watched it, kept on this device (IndexedDB `tvt-log`) and not synced. It fills from a CSV whose date column says when you watched (`watched_at`, `last_watched_at`, *Watched Date* and the like; an *added* or *rated* date doesn't count), such as TV Time's `watches.csv` or a Letterboxd diary, and from episodes you tick and movies you mark watched in the app. A date already logged isn't added again, so reading a file twice doesn't double it. Bulk moves from a section's ••• menu and *I'm Caught Up* aren't logged.

- **Calendar**: a heatmap of the last 26 weeks (‹ › for earlier), one cell a day, shaded by quartile of your busy days; tap a day for what you watched. Under it your busiest day, and above it your current and longest streaks.
- **When You Watch**: by day of the week or hour of the day.
- **Coming Up**: a month calendar of the next episode of each show you're watching and release dates of titles on your lists, from TMDB's cached details; tap a day for the titles.
- **Your Eras**: the decades your shows and movies come from (not the Watchlist), stacked.
- **Your Ratings**: how your stars spread, with your average.

**Rewatches.** Each entry holds every time you watched it, so a rewatch is a second date, not a replacement. From a CSV, a first-watched date beside the last (TV Time's `first_watched_at`) logs both; plays beyond those two have no dates and aren't counted. In the app:

- **Rewatch from the Start** (a show's ••• menu, once it has progress or is in Watched) puts it in Up Next as *Rewatching*, on its own counter (`rewatch` on the item). Each tick logs that episode again; your progress doesn't move. It ends after the last episode out (a show in Watched) or the one you'd got to, adding one to `rewatches`. **Stop Rewatching** ends it early.
- **Watched It Again** (a watched movie's ••• menu) logs another viewing today, with Undo.

A tick on an episode already logged in the last 6 hours (`CORRECTION_MIN`) moves that date rather than adding a rewatch, so tick, undo, tick doesn't count twice. Rewatched episodes and movies add to Watch Time (at their runtime) and show on Activity's *Rewatches* tile.

Days and hours are local to the device. Watches three or more in a row under 3 minutes apart (`BULK_GAP_MIN`) count as marked in bulk, as when a tracker stamps a whole show watched the moment you mark it, and are left out of the calendar, streaks and times (the Calendar says how many). Shows and movies use `--chart-tv` and `--chart-movie`, which differ from `--tv`/`--movie` on dark so the two stay apart for colour-blind eyes.

### Up Next, Not Started, Caught Up and On Hold

A show in Watching still at S1 · E0 goes in *Not Started*: no episode is ticked yet (an import that only had a show's name, not its progress, lands here). A show where TMDB has no aired episode after yours is *Caught Up*. Anything else is in *Up Next* if you've watched it or added it in the last 30 days (`RECENT_DAYS` in `browse.jsx`), or if an episode has aired in that time that you haven't seen; otherwise it's *On Hold*. Not Started lists the shows on air most lately first, Caught Up the next episode soonest.

*I'm Caught Up* (a row's ••• menu, the title sheet, or a section's ••• for all of it) sets a show to its latest episode out, per TMDB; a show that has ended goes to Watched. It needs the show linked to TMDB and a TMDB key. A CSV status of "Up to date" or "Caught up" does the same once the import's titles are linked. `lastWatched` is set when an edit moves a title on: an episode ticked or stepped forward, or the title moved into Watching. Ratings, notes, imports of a backup and sync leave it alone. Titles saved before v1.5 count their last edit. A CSV watch history sets it from the latest date in the file.

The profile picture is cropped square and shrunk to 256px on the device, then kept as a small JPEG (about 30 KB) in `tvt:v1` and, signed in, in the `avatar` column of `tvt_profiles`. Profile settings sync by a three-way merge against what each device last agreed with the server, so clearing one (the picture or the TMDB key) on one device clears it on the others.

### How watch time is counted

A watched movie counts its TMDB runtime. A show counts the episodes up to your progress (season and episode), never more than TMDB says have aired, or every aired episode once it's in Watched, times its typical episode length. Watchlist titles, and shows in Not Started, count for nothing, and the "across N titles" line counts only titles with time watched. Rewatches count on top: the viewings beyond the first in the watch history, or the title's own count (`rewatches`, plus a rewatch under way), whichever is more, so a rewatch of something whose first watch was never logged (imported without dates, or marked caught up) still counts, and nothing counts twice. Titles without a TMDB runtime (typed in by hand, or missing on TMDB) are estimated at 45 minutes an episode or 1h 50m a movie, and Profile says how many are. Each title's time goes to its first genre for *Top Genres*.

## Layout and type

The app is drawn for iPhone first and widens on iPad: the reading column is 640px on a phone, 780px from 700px wide and 880px from 1100px, with 24px gutters on iPad. Stat tiles go from two across to four, awards from four to eight, and Up Next's big card from 16:10 to 21:9 (3:1 on a phone in landscape). The gutters are `max(gutter, safe-area inset)`, so in landscape nothing sits under the notch or Dynamic Island. Text is Geist (Google Fonts, cached by the service worker), with San Francisco standing in until it loads.

The footer of Profile and **Settings → About** carry the maker's tag (`MAKER_TAG` in `app.jsx`, drawn by `MakerTag`).

## Adding features

- **A new "•••" action**: add an entry to the `actions` in `itemMenu` (one title) or `bulkMenu` (a Watching section) in `app.jsx`.
- **A new field** (e.g. platform): give it a default in `normaliseItem`, then add an input to `ItemSheet`. Old saved data, backups and synced rows pick up the default automatically; the database needs no change.
- **A new status** (e.g. *Dropped*): add an entry to `STATUSES`. That gives it a list screen (Profile → Library), a status tile on the title sheet and a place in the edit sheet.
- **A new tab**: add it to `TABS` in `app.jsx` and a branch where `App` picks the screen.
- **A new award**: add an entry to `BADGES` in `profile.jsx`, with the stat it reads (`of`) and its `goal`.
- **A new data source or library**: credit it in `CREDITS` or `OPEN_SOURCE` in `app.jsx`.
- **Another Wikidata fact**: add `["key", "P-number"]` to `WD_FACTS` in `wikidata.jsx` and a line for it in `wikidataFacts`.
- **Another country for Where to Watch**: add its code to `REGIONS` in `app.jsx`.
- **A new Explore shelf**: add a row to `EXPLORE` in `browse.jsx` with any TMDB list path (e.g. `/discover/tv?with_networks=213`).
- **A CSV column the import doesn't know**: add its header (lower-case, letters and digits only) to the right field in `CSV_HEADS` in `importcsv.jsx`.
- **A new one-tap button on a row**: add a case to `quickAction`. If it moves the title to another tab, the row folds away and an Undo toast appears automatically.
- **A new file**: add a `<script type="text/babel">` tag before `app.jsx` in `index.html` and list it in `ASSETS` in `sw.js` (CI fails if you forget). Files share one global scope, so give hooks unique names, as `components.jsx` does (`useStateC`); CI fails if two files declare the same top-level name.
- **More from TMDB** (cast, where to stream): `tmdbGet` in `tmdb.jsx` calls any endpoint, and each linked title has its `tmdbId`. For something on the title sheet, add it to `compactDetails` (and to the `append_to_response` in `loadDetails` if it's a sub-request).
- **A profile setting that follows you**: add a column to `tvt_profiles` (an `alter table … add column if not exists` in `schema.sql`) and one `useProfileField(userId, "column", value, setValue)` call in `App`.

## Motion cheatsheet

| Class / helper | Effect |
| --- | --- |
| `FoldSection` / `useFold` | A section that folds away under its header, with a turning chevron; remembered on the device (`tvt:fold:v1`). |
| `.tvt-view > *` | Blocks on a screen rise in one after another (key the screen to replay it). |
| `.tvt-view.tvt-push` | The same, sliding in from the right (a list pushed over a tab). |
| `.tvt-shelf` | A row of cards that scrolls sideways, edge to edge, snapping card by card. |
| `AnimatedRow` + `useFoldAway` | List rows cascade in and fold shut when removed. |
| `.tvt-screen` (`--enter-x`) | Switching tabs, the new screen drifts in from the side its tab is on. |
| `useLongPress` + `.tvt-hold` | Press and hold a row for its ••• menu, sinking as it's held. |
| `.tvt-tick` | A ring pulses out of Up Next's tick as it's pressed. |
| `.tvt-skel` | Loading placeholders with a sheen sweeping across. |
| `.tvt-pop` (keyed by value) | A number or badge pops when it changes. |
| `.tvt-check-pop` | Press-and-release spring (used by the stars). |
| `ModalFrame sheet` | Bottom sheet that springs up and can be flung down to close. |
| `--ease-bouncy / snappy / soft / wobbly` | Spring curves for your own transitions. |

The OS *Reduce Motion* setting turns all of it off.
