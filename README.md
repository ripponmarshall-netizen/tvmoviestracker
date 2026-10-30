# TV & Movie Tracker

A small installable web app (PWA) for keeping track of the shows and movies you're **watching**, **want to watch** and have **watched**. It uses the same look and motion as the Night Shift Calculator: iOS system colours, light and dark themes, spring animations, sheets you can pull down to close, and a night-sky loading screen whose logo leaps into the header.

There's no build step. React and Babel load from a CDN, and the `.jsx` files are compiled in the browser, so you can edit any file on GitHub (even from a phone) and the change is live once Pages redeploys.

## Run it

1. **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, folder `/ (root)`.
2. Open `https://<your-user>.github.io/tvmoviestracker/` in Safari.
3. **Share → Add to Home Screen.** This matters on iPhone: Safari can clear website data that hasn't been used for a while, but a Home Screen app keeps its own storage.

## What's in it

| File | What it holds |
| --- | --- |
| `index.html` | Theme applied before first paint, the loading screen and its hand-off into the header, script tags. If a script fails, the error appears on the loading screen. |
| `styles.css` | Colour tokens (dark and light), spring easings, and every animation. |
| `components.jsx` | Shared building blocks: `Card`, `SegToggle`, button styles, `ModalFrame` (sheets and dialogs), `showToast`, `askConfirm`, `AnimatedRow`, `Collapse`, icons. |
| `app.jsx` | The data model, list screens, add/edit sheet, settings and tab bar. |
| `sw.js` | Offline support. The app's own files are network-first, so a deploy shows up on the next reload. |
| `check.js` | CI check: every `.jsx` file compiles and is precached. Runs on each push. |

## Data

Everything is saved in `localStorage` under `tvt:v1`, on this device only. **Settings → Export** saves a JSON backup (on iPhone it opens the share sheet, so you can use *Save to Files*), and **Import** restores one.

```js
{
  id, kind: "tv" | "movie", title,
  status: "watching" | "watchlist" | "watched",
  season, episode,   // TV only: last episode watched (episode 0 = not started)
  rating,            // 0–5, 0 = unrated
  note, added, updated  // ISO dates
}
```

## Adding features

- **A new field** (e.g. year, platform): give it a default in `normaliseItem`, then add an input to `ItemSheet`. Old saved data and backups pick up the default automatically.
- **A new tab / status** (e.g. *Dropped*): add an entry to `STATUSES`. That gives it a tab, a screen, an empty state and a place in the edit sheet.
- **A new one-tap button on a row**: add a case to `quickAction`. If it moves the title to another tab, the row folds away and an Undo toast appears automatically.
- **A new file**: add a `<script type="text/babel">` tag before `app.jsx` in `index.html` and list it in `ASSETS` in `sw.js` (CI fails if you forget). Files share one global scope, so give hooks unique names, as `components.jsx` does (`useStateC`).
- **Real posters / search**: swap the stand-in in `Poster` for artwork from an API such as TMDB (needs a free API key).
- **Sync across devices**: replace `loadState` / `saveState` with a Supabase table keyed by `id`.

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
