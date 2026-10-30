/* cloud.jsx — sign-in and sync with Supabase.
   The list still lives on the device first, so the app works offline and
   signed out. Signed in, each title is also a row in Supabase, and every
   device you sign in on merges its list with it, title by title: the
   newer edit wins. Deletes travel too. Your TMDB key, username and profile
   picture ride along in your profile. Clear SUPABASE_URL and the app goes back to device-only. */
const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;

const SUPABASE_URL = "https://mjynccgncbgyfqntodrj.supabase.co";
// The publishable (anon) key is meant to be public: row-level security in
// the database (supabase/schema.sql) keeps every row to its owner.
const SUPABASE_KEY = "sb_publishable_uj0Uj8LWeVUIyRytyh_G7Q_M5yTK4gb";
const ITEMS_TABLE = "tvt_items";
const PROFILES_TABLE = "tvt_profiles";

const cloud = SUPABASE_URL && SUPABASE_KEY && window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      // Its own storage key: other apps on the same github.io address
      // (same origin, same localStorage) might use this project too.
      auth: { storageKey: "tvt-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

const isoTime = (iso) => Date.parse(iso) || 0;

/* useSession — the signed-in session, null when signed out, undefined
   while it's still being read from storage. */
function useSession() {
  const [session, setSession] = useStateS(cloud ? undefined : null);
  useEffectS(() => {
    if (!cloud) return;
    cloud.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data } = cloud.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

/* ============ Sync ============
   `synced` maps each id the server has to the version (`updated`) both
   sides last agreed on. A title whose version differs has changed here
   and is pushed; an id in `synced` that's gone from the list was deleted
   here, and the server gets a tombstone row so other devices delete it. */
const syncedKey = (userId) => `tvt:synced:${userId}`;
function loadSynced(userId) {
  try { return JSON.parse(localStorage.getItem(syncedKey(userId)) || "{}") || {}; } catch { return {}; }
}
function saveSynced(userId, synced) {
  try { localStorage.setItem(syncedKey(userId), JSON.stringify(synced)); } catch {}
}

/* mergeRemote — fold the server's rows into the local list, newer edit
   winning. Pure, so it's easy to reason about. */
function mergeRemote(local, rows, synced) {
  const byId = new Map(local.map((i) => [i.id, i]));
  const next = { ...synced };
  let changed = false;
  for (const row of rows) {
    const theirs = isoTime(row.data?.updated);
    const mine = byId.get(row.id);
    if (row.deleted) {
      // Deleted elsewhere: drop it here too, unless it was edited (or
      // restored) here since.
      if (mine && isoTime(mine.updated) <= theirs) { byId.delete(row.id); changed = true; }
      delete next[row.id];
      continue;
    }
    const remote = normaliseItem({ ...row.data, id: row.id });
    if (!remote) continue;
    if (mine) {
      const ours = isoTime(mine.updated);
      if (ours < theirs) { byId.set(row.id, remote); next[row.id] = remote.updated; changed = true; }
      else if (ours === theirs) next[row.id] = mine.updated;
      // Ours is newer: it's pushed next.
    } else if (!(row.id in synced) || theirs > isoTime(synced[row.id])) {
      // New from another device, or edited there after it was deleted here.
      byId.set(row.id, remote);
      next[row.id] = remote.updated;
      changed = true;
    }
    // Otherwise it was deleted here and the push sends the tombstone.
  }
  return { items: [...byId.values()], synced: next, changed };
}

/* pendingRows — what the server needs to hear: changed titles and
   tombstones for deleted ones. */
function pendingRows(local, synced, userId) {
  const ids = new Set(local.map((i) => i.id));
  const now = nowIso();
  const rows = local
    .filter((i) => synced[i.id] !== i.updated)
    .map((i) => ({ user_id: userId, id: i.id, data: i, deleted: false, updated_at: i.updated }));
  for (const id of Object.keys(synced)) {
    if (!ids.has(id)) rows.push({ user_id: userId, id, data: { id, updated: now }, deleted: true, updated_at: now });
  }
  return rows;
}

async function fetchAllRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await cloud.from(ITEMS_TABLE).select("id,data,deleted").order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/* useCloudSync — keeps the list in step with Supabase while signed in.
   Syncs on sign-in, when the app comes back to the foreground or back
   online, and a moment after each change. `itemsRef` must always hold the
   latest list and `updateItems` must update it straight away, so a merge
   never works from a stale copy. Returns { status, syncNow }. */
function useCloudSync(userId, items, itemsRef, updateItems) {
  const [status, setStatus] = useStateS({ state: "idle", at: 0, error: "" });
  const syncedRef = useRefS({});
  const busy = useRefS(false);
  const again = useRefS(false);
  const run = useRefS(null);

  run.current = async () => {
    if (!cloud || !userId) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    setStatus((s) => ({ ...s, state: "syncing" }));
    try {
      do {
        again.current = false;
        const rows = await fetchAllRows();
        const merged = mergeRemote(itemsRef.current, rows, syncedRef.current);
        if (merged.changed) updateItems(() => merged.items);
        syncedRef.current = merged.synced;
        const out = pendingRows(itemsRef.current, syncedRef.current, userId);
        if (out.length) {
          const { error } = await cloud.from(ITEMS_TABLE).upsert(out, { onConflict: "user_id,id" });
          if (error) throw error;
          const next = { ...syncedRef.current };
          for (const r of out) {
            if (r.deleted) delete next[r.id];
            else next[r.id] = r.data.updated;
          }
          syncedRef.current = next;
        }
        saveSynced(userId, syncedRef.current);
      } while (again.current);
      setStatus({ state: "ok", at: Date.now(), error: "" });
    } catch (e) {
      setStatus((s) => ({ ...s, state: navigator.onLine === false ? "offline" : "error", error: e?.message || String(e) }));
    } finally {
      busy.current = false;
    }
  };

  useEffectS(() => {
    if (!userId) { setStatus({ state: "idle", at: 0, error: "" }); return; }
    syncedRef.current = loadSynced(userId);
    run.current();
    const onVisible = () => { if (document.visibilityState === "visible") run.current(); };
    const onOnline = () => run.current();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [userId]);

  // A moment after a change made here (not one a merge just brought in).
  useEffectS(() => {
    if (!userId || !pendingRows(itemsRef.current, syncedRef.current, userId).length) return;
    const t = setTimeout(() => run.current(), 800);
    return () => clearTimeout(t);
  }, [items, userId]);

  return { status, syncNow: () => run.current() };
}

/* ============ Profile ============
   One row per user, a column per setting that follows you between devices
   (the TMDB key, the profile picture). useProfileField keeps one column in
   step with `value`, saving each change once the typing stops.
   On sign-in (and each launch) it's a three-way merge against the value
   this device last agreed with the server (kept as a hash): whichever side
   changed since wins, so clearing a setting on one device clears it
   everywhere rather than being pushed back by the others. If both changed,
   or this device has never synced, the server's wins (or gets this
   device's, if it has none).
   Each column loads and saves on its own, so one the database doesn't have
   yet (schema.sql not re-run) can't stop the others syncing. */
const hashStr = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) | 0;
  return `${h >>> 0}:${str.length}`;
};
function useProfileField(userId, column, value, setValue, clean = (v) => v) {
  const loaded = useRefS(false);
  const saved = useRefS(null);
  const valueRef = useRefS(value);
  valueRef.current = value;
  const agreedKey = `tvt:profile:${userId}:${column}`;
  const agree = (v) => {
    saved.current = v;
    try { localStorage.setItem(agreedKey, hashStr(v || "")); } catch {}
  };

  const save = (v) => {
    if (!loaded.current || v === saved.current) return;
    cloud.from(PROFILES_TABLE).upsert({ user_id: userId, [column]: v || null, updated_at: nowIso() })
      .then(({ error }) => { if (!error) agree(v); });
  };

  useEffectS(() => {
    loaded.current = false;
    saved.current = null;
    if (!cloud || !userId) return;
    let live = true;
    cloud.from(PROFILES_TABLE).select(column).maybeSingle().then(({ data, error }) => {
      if (!live || error) return;
      loaded.current = true;
      const theirs = clean(data?.[column] || "");
      const mine = valueRef.current || "";
      let agreed = null;
      try { agreed = localStorage.getItem(agreedKey); } catch {}
      if (hashStr(theirs) === hashStr(mine)) agree(theirs);
      // Only this device changed it since (or the server has none yet).
      else if (agreed === hashStr(theirs) || (!theirs && agreed == null)) { saved.current = theirs; save(mine); }
      else { agree(theirs); setValue(theirs); }
    });
    return () => { live = false; };
  }, [userId]);

  useEffectS(() => {
    if (!cloud || !userId) return;
    const t = setTimeout(() => save(valueRef.current), 800);
    return () => clearTimeout(t);
  }, [value, userId]);
}

/* ============ Account (in Settings) ============ */
function syncLabel(status) {
  if (status.state === "syncing") return "Syncing…";
  if (status.state === "offline") return "Offline. Changes will sync when you're back online.";
  if (status.state === "error") return `Sync failed: ${status.error}`;
  if (status.state === "ok") {
    const mins = Math.round((Date.now() - status.at) / 60000);
    return `Synced ${mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : "over an hour ago"}`;
  }
  return "Not synced yet";
}

function AccountSection({ session, sync, avatar, username }) {
  const [email, setEmail] = useStateS("");
  const [password, setPassword] = useStateS("");
  const [busy, setBusy] = useStateS(false);
  const [error, setError] = useStateS("");

  if (!cloud) return null;
  if (session === undefined) return <div className="label">Checking sign-in…</div>;

  // Email and password, not a magic link: a link opens in Safari, which
  // on iPhone doesn't share sign-in with the Home Screen app.
  const signIn = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const { error: err } = await cloud.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError(err.message);
    else { setPassword(""); showToast("Signed in. Syncing your list"); }
  };
  const signOut = async () => {
    await cloud.auth.signOut();
    showToast("Signed out. Your list stays on this device");
  };

  if (!session) {
    return (
      <form onSubmit={signIn}>
        <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5, marginBottom: 10 }}>
          Sign in to keep your list, username and TMDB key in sync across your devices.
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email"
            autoComplete="username" autoCapitalize="off" spellCheck={false} required style={fieldStyle()} />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password"
            autoComplete="current-password" required style={fieldStyle()} />
        </div>
        {error && <div role="alert" className="tvt-pop" style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 8 }}>{error}</div>}
        <button type="submit" disabled={busy} style={{ ...accentBtn(), marginTop: 10, opacity: busy ? 0.6 : 1 }}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    );
  }

  const failed = sync.status.state === "error";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar src={avatar} name={username} email={session.user.email} size={36} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{username || session.user.email}</div>
          {username && <div style={{ fontSize: 12.5, color: "var(--ink-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.user.email}</div>}
          <div aria-live="polite" style={{ fontSize: 12.5, color: failed ? "var(--danger)" : "var(--ink-dim)", marginTop: 2 }}>{syncLabel(sync.status)}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" onClick={sync.syncNow} disabled={sync.status.state === "syncing"} style={ghostBtn()}>Sync now</button>
        <button type="button" onClick={signOut} style={ghostBtn()}>Sign out</button>
      </div>
    </div>
  );
}

Object.assign(window, { cloud, useSession, useCloudSync, useProfileField, AccountSection, mergeRemote, pendingRows });
