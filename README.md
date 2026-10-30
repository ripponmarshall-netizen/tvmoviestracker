# TV & Movie Tracker

A small installable web app (PWA) for keeping track of the shows and movies you're **watching**, **want to watch** and have **watched**. Search TMDB to add a title with its poster, and sign in to sync your list across devices. It uses the same look and motion as the Night Shift Calculator: iOS system colours, light and dark themes, spring animations, sheets you can pull down to close, and a night-sky loading screen whose logo leaps into the header.

There's no build step. React and Babel load from a CDN, and the `.jsx` files are compiled in the browser, so you can edit any file on GitHub (even from a phone) and the change is live once Pages redeploys.

## Run it

1. **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`.
2. Open `https://<your-user>.github.io/tvmoviestracker/` in Safari.
3. **Share → Add to Home Screen.** This matters on iPhone: Safari can clear website data that hasn't been used for a while, but a Home Screen app keeps its own storage.

### Title search and posters (TMDB)

1. Make a free account at [themoviedb.org](https://www.themoviedb.org), then **Settings → API** and request a key (personal use).
2. In the app: **Settings → Title search**, paste the *API Key* (or the longer *API Read Access Token*) and tap **Test**.

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
| `components.jsx` | Shared building blocks: `Card`, `SegToggle`, button styles, `ModalFrame` (sheets and dialogs), `showToast`, `askConfirm`, `AnimatedRow`, `Collapse`, icons. |
| `tmdb.jsx` | TMDB search, poster URLs, the key test and the search results list. |
| `cloud.jsx` | Supabase config, sign-in, the profile (TMDB key) and sync. |
| `app.jsx` | The data model, list screens, add/edit sheet, settings and tab bar. |
| `supabase/schema.sql` | The tables and row-level security for sync. |
| `sw.js` | Offline support. The app's own files are network-first, so a deploy shows up on the next reload. |
| `check.js` | CI check: every `.jsx` file compiles and is precached. Runs on each push. |

## Data

Everything is saved on the device first, in `localStorage` under `tvt:v1`, so the app works offline and signed out. **Settings → Export** saves a JSON backup (on iPhone it opens the share sheet, so you can use *Save to Files*), and **Import** restores one.

Signed in, each title is also a row in `tvt_items`, with the whole item in a `data` column. Devices sync when you sign in, when the app comes back to the foreground or back online, and a moment after each change. They merge title by title, and the newer edit wins. A delete leaves a tombstone row (`deleted = true`) so the other devices drop the title too. Undo and Import count as fresh edits, so they win over what they replace.

```js
{
  id, kind: "tv" | "movie", title,
  status: "watching" | "watchlist" | "watched",
  season, episode,   // TV only: last episode watched (episode 0 = not started)
  rating,            // 0–5, 0 = unrated
  note,
  tmdbId, poster, year, // from TMDB search; null / "" for titles typed in
  added, updated     // ISO dates; `updated` decides which edit wins a sync
}
```

## Adding features

- **A new field** (e.g. platform): give it a default in `normaliseItem`, then add an input to `ItemSheet`. Old saved data, backups and synced rows pick up the default automatically; the database needs no change.
- **A new tab / status** (e.g. *Dropped*): add an entry to `STATUSES`. That gives it a tab, a screen, an empty state and a place in the edit sheet.
- **A new one-tap button on a row**: add a case to `quickAction`. If it moves the title to another tab, the row folds away and an Undo toast appears automatically.
- **A new file**: add a `<script type="text/babel">` tag before `app.jsx` in `index.html` and list it in `ASSETS` in `sw.js` (CI fails if you forget). Files share one global scope, so give hooks unique names, as `components.jsx` does (`useStateC`).
- **More from TMDB** (episode counts, where to stream): `tmdbGet` in `tmdb.jsx` calls any endpoint, and each linked title has its `tmdbId`.
- **A profile setting that follows you**: add a column to `tvt_profiles` and load/save it next to the TMDB key in `useProfileKey` (`cloud.jsx`).

## Motion cheatsheet

| Class / helper | Effect |
| --- | --- |
| `.tvt-view > *` | Blocks on a screen rise in one after another (key the screen to replay it). |
| `AnimatedRow` + `useFoldAway` | List rows cascade in and fold shut when removed. |
| `.tvt-pop` (keyed by value) | A number or badge pops when it changes. |
| `.tvt-check-pop` | Press-and-release spring (used by the stars). |
| `ModalFrame sheet` | Bottom sheet that springs up and can be flung down to close. |
| `--ease-bouncy / snappy / soft / wobbly` | Spring curves for your own transitions. |

The OS *Reduce Motion* setting turns all of it off.
