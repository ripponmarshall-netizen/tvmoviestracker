/* components.jsx — shared primitives: cards, buttons, segmented control,
   sheets and dialogs, toasts, list-row motion, icons. Ported from the
   Night Shift Calculator so the two apps look and move the same. */
const { useState: useStateC, useEffect: useEffectC, useRef: useRefC } = React;

function Card({ children, style }) {
  return (
    <section style={{
      background: "var(--bg-1)",
      border: "1px solid var(--card-edge)",
      borderRadius: 20,
      padding: 18,
      marginBottom: 14,
      ...style,
    }}>{children}</section>
  );
}

/* An iOS segmented control: a gray track and a raised pill that slides
   between options. full: the options share the whole width. */
function SegToggle({ options, value, onChange, small, full, label }) {
  const rootRef = useRefC(null);
  const [pill, setPill] = useStateC(null);
  const activeIndex = options.findIndex((o) => o.v === value);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const el = root.querySelectorAll("[data-seg]")[activeIndex];
      setPill(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);
  return (
    <div ref={rootRef} role="radiogroup" aria-label={label} style={{
      display: full ? "grid" : "inline-grid", gridAutoFlow: "column", gridAutoColumns: full ? "1fr" : undefined,
      position: "relative", isolation: "isolate",
      background: "var(--fill)", border: "1px solid transparent",
      borderRadius: 10, padding: 2, gap: 2,
    }}>
      {pill && (
        <span aria-hidden className="tvt-seg-pill" style={{
          position: "absolute", left: 0, top: 0, zIndex: -1,
          width: pill.w, height: pill.h, borderRadius: 8, background: "var(--seg-pill)",
          boxShadow: "0 3px 8px rgba(0,0,0,0.12), 0 3px 1px rgba(0,0,0,0.04)",
          transform: `translate(${pill.x}px, ${pill.y}px)`,
        }} />
      )}
      {options.map((o) => {
        const active = o.v === value;
        return (
          <button key={String(o.v)} type="button" data-seg role="radio" aria-checked={active} onClick={() => onChange(o.v)} style={{
            padding: small ? "5px 10px" : "8px 14px",
            borderRadius: 8, border: "none",
            // Until the pill is measured, paint the active option directly.
            background: active && !pill ? "var(--seg-pill)" : "transparent",
            color: active ? "var(--ink)" : "var(--ink-dim)",
            fontSize: small ? 12 : 13, fontWeight: active ? 600 : 500,
            cursor: "pointer", whiteSpace: "nowrap",
            transition: "color 0.2s ease, var(--press)",
          }}>{o.l}</button>
        );
      })}
    </div>
  );
}

/* 44px: Apple's minimum comfortable tap target. A round gray button, as
   iOS draws toolbar and close buttons. */
function iconBtn(size = 44) {
  return {
    width: size, height: size, borderRadius: 999, flexShrink: 0,
    background: "var(--fill)", border: "1px solid transparent",
    color: "var(--ink)", cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontSize: 16, padding: 0,
  };
}
function primaryBtn() {
  return {
    padding: "10px 16px", borderRadius: 12, border: "none",
    background: "var(--ink)", color: "var(--bg-1)",
    fontWeight: 600, fontSize: 13.5, cursor: "pointer",
  };
}
/* A gray (not outlined) button, as iOS draws secondary actions. */
function ghostBtn() {
  return {
    padding: "10px 14px", borderRadius: 12,
    border: "1px solid transparent", background: "var(--fill)",
    color: "var(--ink)", fontSize: 13.5, cursor: "pointer", fontWeight: 500,
  };
}
function accentBtn() {
  return {
    padding: "10px 14px", borderRadius: 12, border: "none",
    background: "var(--accent)", color: "var(--accent-ink)",
    fontWeight: 600, fontSize: 13.5, cursor: "pointer",
  };
}
/* Text fields: 16px, or iOS zooms the page in when one is focused. */
function fieldStyle() {
  return {
    width: "100%", background: "var(--bg-2)", border: "1px solid var(--line)",
    borderRadius: 10, padding: "10px 12px", color: "var(--ink)", fontSize: 16,
  };
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* useFoldAway — remove a list row after it folds shut, so the rows below
   slide up instead of jumping. Returns [isLeaving(id), remove(id)]; a
   second tap while a row is folding is ignored. */
function useFoldAway(onRemove, ms = 220) {
  const [leaving, setLeaving] = useStateC([]);
  const busy = useRefC(new Set());
  const remove = (id) => {
    if (busy.current.has(id)) return;
    if (prefersReducedMotion()) { onRemove(id); return; }
    busy.current.add(id);
    setLeaving((l) => [...l, id]);
    setTimeout(() => {
      onRemove(id);
      busy.current.delete(id);
      setLeaving((l) => l.filter((x) => x !== id));
    }, ms);
  };
  return [(id) => leaving.includes(id), remove];
}

/* AnimatedRow — one row of a list: rises in a beat after the row above it
   and folds away when `leaving`. The gap below it folds with it. */
function AnimatedRow({ index = 0, leaving, gap = 8, children }) {
  return (
    <div className={"tvt-row" + (leaving ? " is-leaving" : "")}>
      <div>
        <div className="tvt-row-in" style={{ paddingBottom: gap, animationDelay: `${Math.min(index, 8) * 40 + 80}ms` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* Collapse — animate height open/closed via grid-template-rows (no
   measuring). Closed content is inert, so Tab and screen readers skip it;
   once open, overflow is released so focus rings aren't clipped. */
function Collapse({ open, children }) {
  const [settled, setSettled] = useStateC(open);
  useEffectC(() => {
    if (!open) { setSettled(false); return; }
    if (prefersReducedMotion()) { setSettled(true); return; }
    const t = setTimeout(() => setSettled(true), 420);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <div className={"tvt-collapse" + (open ? " is-open" : "")} style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr" }}>
      <div inert={open ? undefined : ""} aria-hidden={open ? undefined : "true"} style={{ overflow: open && settled ? "visible" : "hidden", minHeight: 0 }}>{children}</div>
    </div>
  );
}

/* Toast — any module calls showToast(); ToastHost (mounted once) renders it
   above the tab bar. Pass { action: { label, onClick } } for an Undo
   button; those stay up longer so there's time to reach them. */
function showToast(message, opts) {
  window.dispatchEvent(new CustomEvent("tvt-toast", { detail: { message, action: opts?.action || null } }));
}
const TOAST_EXIT_MS = 200;
function ToastHost() {
  const [toast, setToast] = useStateC(null);
  const timerRef = useRefC(null);
  const dismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (prefersReducedMotion()) { setToast(null); return; }
    setToast((t) => (t ? { ...t, leaving: true } : t));
    timerRef.current = setTimeout(() => setToast(null), TOAST_EXIT_MS);
  };
  const dismissRef = useRefC(dismiss);
  dismissRef.current = dismiss;
  useEffectC(() => {
    const onToast = (e) => {
      const d = e.detail || {};
      setToast({ id: Date.now(), message: String(d.message || ""), action: d.action });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => dismissRef.current(), d.action ? 6000 : 2200);
    };
    window.addEventListener("tvt-toast", onToast);
    return () => {
      window.removeEventListener("tvt-toast", onToast);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
  if (!toast) return null;
  const act = () => {
    if (toast.leaving) return;
    toast.action?.onClick?.();
    dismiss();
  };
  return (
    <div aria-live="polite" className="tvt-toast-wrap" style={{
      position: "fixed", left: 0, right: 0,
      display: "flex", justifyContent: "center", zIndex: 90, pointerEvents: "none", padding: "0 16px",
    }}>
      <div key={toast.id} className={"tvt-toast" + (toast.leaving ? " is-leaving" : "")} style={{
        background: "var(--surface-translucent)",
        backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)",
        border: "1px solid var(--glass-edge)",
        color: "var(--ink)", borderRadius: 999, padding: toast.action ? "6px 6px 6px 16px" : "10px 16px", fontSize: 13,
        boxShadow: "0 12px 32px -16px rgba(0,0,0,0.7)", maxWidth: 420,
        display: "flex", alignItems: "center", gap: 12,
        pointerEvents: toast.action && !toast.leaving ? "auto" : "none",
      }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{toast.message}</span>
        {toast.action && (
          <button type="button" onClick={act} style={{
            border: "none", borderRadius: 999, padding: "8px 14px", minHeight: 36, flexShrink: 0,
            background: "var(--accent)", color: "var(--accent-ink)",
            fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>{toast.action.label}</button>
        )}
      </div>
    </div>
  );
}

/* askConfirm — in-app window.confirm(). Resolves true on confirm, false on
   cancel / Escape / backdrop. ConfirmHost (mounted once) renders it. */
function askConfirm(opts) {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent("tvt-confirm", { detail: { opts: opts || {}, resolve } }));
  });
}
function ConfirmHost() {
  const [req, setReq] = useStateC(null);
  useEffectC(() => {
    // A second request replaces the first, which is answered "no".
    const onReq = (e) => setReq((cur) => {
      cur?.resolve(false);
      return { id: Date.now(), ...e.detail };
    });
    window.addEventListener("tvt-confirm", onReq);
    return () => window.removeEventListener("tvt-confirm", onReq);
  }, []);
  if (!req) return null;
  return <ConfirmDialog key={req.id} {...req.opts} onDone={(ok) => { req.resolve(ok); setReq(null); }} />;
}
function ConfirmDialog({ title, body, confirmLabel, danger, onDone }) {
  const resultRef = useRefC(false);
  const { ref, closing, close } = useModalDismiss(() => onDone(resultRef.current));
  const answer = (ok) => { resultRef.current = ok; close(); };
  return (
    <ModalFrame dismiss={{ ref, closing, close: () => answer(false) }} zIndex={95} maxWidth={380} role="alertdialog" label={title}>
      <div style={{ fontSize: 17, fontWeight: 600 }}>{title}</div>
      {body && <div style={{ fontSize: 13.5, color: "var(--ink-dim)", lineHeight: 1.5, marginTop: 6 }}>{body}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
        <button type="button" onClick={() => answer(false)} style={ghostBtn()}>Cancel</button>
        <button type="button" onClick={() => answer(true)} style={danger
          ? { ...primaryBtn(), background: "var(--danger)", color: "#fff" }
          : primaryBtn()}>{confirmLabel || "OK"}</button>
      </div>
    </ModalFrame>
  );
}

/* ModalFrame — the dimmed backdrop and card every modal shares. Pass the
   useModalDismiss() result as `dismiss`. sheet: a bottom sheet you can pull
   down to close; otherwise a centred dialog. Both scroll inside when tall. */
function ModalFrame({ dismiss, sheet, zIndex = 70, maxWidth = 520, role = "dialog", label, children }) {
  const { ref, closing, close } = dismiss;
  const backdropRef = useRefC(null);
  const flung = useSheetDrag(sheet ? ref : null, backdropRef, close);
  const c = (closing ? " is-closing" : "") + (flung ? " is-flung" : "");
  // Only a press that starts on the backdrop closes the modal (a text
  // selection dragged out of a field also ends with a click there).
  const downOnBackdrop = useRefC(false);
  // Rendered on <body>: a screen still rising in (transform mid-animation)
  // would otherwise become the box the fixed backdrop sits in.
  return ReactDOM.createPortal(
    <div ref={backdropRef}
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnBackdrop.current) close(); }}
      className={"tvt-backdrop" + (sheet ? " is-bottom" : "") + c} style={{ zIndex }}>
      <div ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()} role={role} aria-modal="true" aria-label={label}
        className={"tvt-modal " + (sheet ? "tvt-sheet" : "tvt-center") + c} style={{ maxWidth }}>
        {sheet && <span className="tvt-grabber" aria-hidden />}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ModalHead — small label, title and a close button. */
function ModalHead({ eyebrow, title, onClose }) {
  return (
    <div style={{ display: "flex", alignItems: eyebrow ? "flex-start" : "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="label">{eyebrow}</div>}
        <div style={{ fontSize: eyebrow ? 17 : 18, fontWeight: 600, marginTop: eyebrow ? 2 : 0, overflowWrap: "anywhere" }}>{title}</div>
      </div>
      <button type="button" onClick={onClose} style={{ ...iconBtn(), color: "var(--ink-dim)" }} aria-label="Close"><XIcon /></button>
    </div>
  );
}

/* springTo — move a value to `to` as a mass on a damped spring, starting
   at `from` with `velocity` (units/s). Returns a function that stops it.
   The defaults (damping ratio ~0.75) settle in about a third of a second. */
function springTo({ from, to, velocity = 0, stiffness = 520, damping = 34, onUpdate, onDone }) {
  let x = from, v = velocity, last = null, raf = 0;
  const step = (now) => {
    // Fixed small steps (semi-implicit Euler) keep it stable on a slow frame.
    let dt = last == null ? 1 / 60 : Math.min(0.064, (now - last) / 1000);
    last = now;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      v += (-stiffness * (x - to) - damping * v) * h;
      x += v * h;
      dt -= h;
    }
    if (Math.abs(x - to) < 0.3 && Math.abs(v) < 8) { onUpdate(to); onDone?.(); return; }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/* useSheetDrag — pull a bottom sheet down to close it, as on iOS. Only
   when the sheet is scrolled to its top and the finger moves mostly down.
   The sheet follows the finger (rubber-banding if pulled up) and the
   backdrop lightens with it. On release, a flick or a pull past a third of
   its height flings it away at the finger's speed; anything less springs
   it back, carrying the release velocity into the spring. Touch events,
   because only a non-passive touchmove can stop the page scrolling. */
function useSheetDrag(sheetRef, backdropRef, close) {
  const [flung, setFlung] = useStateC(false);
  const closeRef = useRefC(close);
  closeRef.current = close;
  useEffectC(() => {
    const el = sheetRef?.current;
    if (!el) return;
    let start = null, dragging = false, offset = 0, samples = [], stopSpring = null, done = false;
    const setY = (y) => {
      offset = y;
      el.style.transform = y ? `translateY(${y}px)` : "";
      const bd = backdropRef.current;
      if (bd) bd.style.opacity = y > 0 ? String(Math.max(0.25, 1 - y / (el.offsetHeight * 1.4))) : "";
    };
    const onStart = (e) => {
      if (done || e.touches.length !== 1) { start = null; return; }
      stopSpring?.(); stopSpring = null;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, base: offset };
      dragging = false;
      samples = [{ y: t.clientY, t: e.timeStamp }];
    };
    const onMove = (e) => {
      if (!start || done) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x, dy = t.clientY - start.y;
      if (!dragging) {
        // Claim a downward move at the top from the first event: iOS won't
        // let a scroll that has already started be cancelled.
        if (el.scrollTop <= 0 && dy > 0 && e.cancelable) e.preventDefault();
        if (el.scrollTop > 0 || dy < 8 || Math.abs(dy) < Math.abs(dx) * 1.2) {
          if (Math.abs(dx) > 10 || dy < -8 || el.scrollTop > 0) start = null;
          return;
        }
        dragging = true;
        start.y = t.clientY; // no jump by the slop distance
        // An unfinished entrance would fight the finger: skip to its end.
        el.getAnimations?.().forEach((an) => { try { an.finish(); } catch {} });
      }
      e.preventDefault();
      const raw = start.base + (t.clientY - start.y);
      setY(raw >= 0 ? raw : -(1 - 1 / (1 + (-raw * 0.55) / 120)) * 120);
      samples.push({ y: t.clientY, t: e.timeStamp });
      while (samples.length > 2 && e.timeStamp - samples[0].t > 90) samples.shift();
    };
    const onEnd = (e) => {
      if (!start) return;
      start = null;
      if (!dragging) return;
      dragging = false;
      const a = samples[0], b = samples[samples.length - 1];
      const ms = Math.max(1, (b?.t ?? 0) - (a?.t ?? 0));
      // Lifted after holding still: no fling left in it.
      const stale = e.timeStamp - (b?.t ?? 0) > 80;
      const v = stale ? 0 : ((b?.y ?? 0) - (a?.y ?? 0)) / ms; // px per ms
      const h = el.offsetHeight;
      if (offset > 0 && (v > 0.5 || offset > h / 3)) {
        done = true;
        setFlung(true);
        // Leave at (at least) the finger's speed.
        const dist = h + 140 - offset;
        const dur = Math.round(Math.max(110, Math.min(180, dist / Math.max(v, 1.6))));
        el.style.transition = `transform ${dur}ms cubic-bezier(0.3, 0.7, 0.6, 1)`;
        const bd = backdropRef.current;
        if (bd) { bd.style.transition = `opacity ${dur + 40}ms ease-out`; bd.style.opacity = "0"; }
        requestAnimationFrame(() => { el.style.transform = `translateY(${h + 140}px)`; });
        closeRef.current();
        return;
      }
      if (prefersReducedMotion()) { setY(0); return; }
      stopSpring = springTo({ from: offset, to: 0, velocity: v * 1000, onUpdate: setY, onDone: () => { stopSpring = null; } });
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      stopSpring?.();
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);
  return flung;
}

/* useModalDismiss — close on Escape, lock background scroll, trap focus,
   and drive the exit animation. Returns { ref, closing, close }: attach
   `ref` to the dialog; call close() to play the exit, then onClose runs
   after MODAL_EXIT_MS. Modals can stack, so only the top one handles keys. */
const MODAL_EXIT_MS = 180;
const modalStack = [];
function useModalDismiss(onClose) {
  const cbRef = useRefC(onClose);
  cbRef.current = onClose;
  const dialogRef = useRefC(null);
  const [closing, setClosing] = useStateC(false);
  const closingRef = useRefC(false);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) { cbRef.current?.(); return; }
    setClosing(true);
    setTimeout(() => cbRef.current?.(), MODAL_EXIT_MS);
  };
  const closeRef = useRefC(close);
  closeRef.current = close;

  useEffectC(() => {
    const prevFocus = document.activeElement;
    const token = {};
    modalStack.push(token);
    const focusables = () => {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(root.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((el) => el.offsetParent !== null || el === document.activeElement);
    };
    dialogRef.current?.focus?.();
    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === "Escape") { closeRef.current?.(); return; }
      if (e.key === "Tab" && dialogRef.current) {
        const f = focusables();
        if (f.length === 0) { e.preventDefault(); return; }
        const first = f[0], last = f[f.length - 1], active = document.activeElement;
        if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
          e.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      modalStack.splice(modalStack.indexOf(token), 1);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      prevFocus?.focus?.();
    };
  }, []);
  // closingRef flips in the same tap as close(), so a modal can freeze its
  // content for the exit before the state update lands.
  return { ref: dialogRef, closing: closing || closingRef.current, close };
}

/* downloadBlob — save a Blob as a file. Revoking the URL in the same tick
   as click() can cancel the download in Safari, so release it later. */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Icons: 1.6px strokes on a 24 grid, like SF Symbols at regular weight. */
function Svg({ size = 20, children, sw = 1.6 }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  );
}
function XIcon({ size = 13 }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M2 2l10 10M12 2L2 12" />
    </svg>
  );
}
function PlusIcon({ size = 18 }) {
  return <Svg size={size} sw={2}><path d="M12 5v14M5 12h14" /></Svg>;
}
function MinusIcon({ size = 18 }) {
  return <Svg size={size} sw={2}><path d="M5 12h14" /></Svg>;
}
function GearIcon({ size = 18 }) {
  return (
    <Svg size={size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  );
}
function PlayIcon({ size }) {
  return <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l5.5-3.5z" /></Svg>;
}
function BookmarkIcon({ size }) {
  return <Svg size={size}><path d="M7 4h10v16l-5-3.6L7 20z" /></Svg>;
}
function CheckCircleIcon({ size }) {
  return <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M8 12.3l2.7 2.7L16 9.6" /></Svg>;
}
function StarIcon({ size = 14, filled }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.5-4.2 6.1-.8z" />
    </svg>
  );
}

Object.assign(window, {
  Card, SegToggle, iconBtn, primaryBtn, ghostBtn, accentBtn, fieldStyle,
  prefersReducedMotion, useFoldAway, AnimatedRow, Collapse,
  showToast, ToastHost, askConfirm, ConfirmHost,
  ModalFrame, ModalHead, springTo, useModalDismiss, downloadBlob,
  XIcon, PlusIcon, MinusIcon, GearIcon, PlayIcon, BookmarkIcon, CheckCircleIcon, StarIcon,
});
