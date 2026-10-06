// History contains identity only. Small, safe UI projections live in memory;
// drafts, stock, receipts and mutation payloads remain with their existing owners.
export const semanticHistoryKey = "__nkSemanticBack";
export type SemanticValue = Record<string, string | boolean | null | string[]>;
type Marker = { version: 1; id: string; route: string; kind: string; key: string; guarded?: boolean };
type Entry = { marker: Marker; values: Record<string, SemanticValue>; parentId: string | null; departing?: boolean };
type Participant = { route: string; read: () => SemanticValue; restore: (value: SemanticValue) => void };
type HistoryPort = {
  state: unknown;
  pushState: (state: unknown, unused: string, url?: string) => void;
  replaceState: (state: unknown, unused: string, url?: string) => void;
  go: (delta: number) => void;
};
export function readSemanticMarker(state: unknown): Marker | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[semanticHistoryKey];
  if (!value || typeof value !== "object") return null;
  const marker = value as Marker;
  return marker.version === 1 && typeof marker.id === "string" && typeof marker.route === "string"
    && typeof marker.kind === "string" && typeof marker.key === "string" ? marker : null;
}
export function createSemanticBackHistory({ history, href, standalone, exit, beforePop, id, requestExit = () => {}, internalDocumentNavigation = () => false }: {
  history: HistoryPort; href: () => string; standalone: () => boolean;
  exit: (open: boolean) => void; beforePop: () => void; id: () => string;
  requestExit?: () => void;
  internalDocumentNavigation?: () => boolean;
}) {
  const entries = new Map<string, Entry>();
  const participants = new Map<string, Participant>();
  const transient = new Map<string, { close: () => void; blocked: () => boolean }>();
  let current: Entry | null = null;
  let initialized = false;
  let released = false;
  let returningFromBoundary = false;
  let exitOpen = false;
  let returningFromBlocked = false;
  let guarded = false;
  const pathname = () => href().split(/[?#]/)[0];
  const write = (entry: Entry, push: boolean) => {
    const state = { ...(history.state && typeof history.state === "object" ? history.state : {}), [semanticHistoryKey]: entry.marker };
    history[push ? "pushState" : "replaceState"](state, "", entry.marker.route);
    entries.set(entry.marker.id, entry);
    current = entry;
  };
  const make = (kind: string, key = "", values: Entry["values"] = {}, route = href()): Entry => ({
    marker: { version: 1, id: id(), route, kind, key, ...(guarded ? { guarded: true } : {}) }, values, parentId: current?.marker.id ?? null,
  });
  function ensure() {
    if (!initialized) {
      initialized = true;
      guarded = standalone();
      if (guarded && !readSemanticMarker(history.state)?.guarded && !internalDocumentNavigation()) {
        write(make("EXIT_BOUNDARY"), false);
        write(make("ROUTE"), true); // Exactly one boundary, only in standalone.
      }
    }
    const marker = readSemanticMarker(history.state);
    if (marker?.route === href() && entries.has(marker.id)) current = entries.get(marker.id)!;
    else write(make("ROUTE"), false); // A real Next/GET navigation owns this entry.
    return current!;
  }
  function restore(entry: Entry) {
    for (const [key, participant] of participants) {
      if (participant.route === pathname() && entry.values[key]) participant.restore(entry.values[key]);
    }
  }
  return {
    ensure,
    beforeNavigation() {
      // Link navigation can wait for server data while href still names the old
      // route. Its drawer/dialog cleanup must not issue a competing history Back.
      // Scope this to existing checkpoints, not a global pending-navigation flag.
      for (const entryId of transient.keys()) {
        const entry = entries.get(entryId);
        if (entry) entry.departing = true;
      }
    },
    register(key: string, participant: Participant) {
      participants.set(key, participant);
      const entry = ensure();
      if (entry.values[key]) participant.restore(entry.values[key]);
      else entry.values[key] = participant.read();
      return () => { if (participants.get(key) === participant) participants.delete(key); };
    },
    commit(key: string, before: SemanticValue, after: SemanticValue, replace = false, route = href()) {
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      const previous = ensure();
      previous.values[key] = before;
      const values = { ...previous.values, [key]: after };
      write(replace ? { ...previous, values, marker: { ...previous.marker, route } } : make("STATE", key, values, route), !replace);
    },
    seedOrder(key: string, orderId: string, value: SemanticValue) {
      const entry = ensure();
      if (entry.marker.kind !== "ROUTE" || entry.values[key]) return;
      const url = new URL(href(), "https://nk.invalid");
      if (url.searchParams.get("order") !== orderId) return;
      const detailUrl = href();
      url.searchParams.delete("order");
      write(make("STATE", key, { ...entry.values, [key]: { ...value, selectedOrderId: null } }, `${url.pathname}${url.search}${url.hash}`), false);
      write(make("ORDER_DETAIL", key, { ...entry.values, [key]: value }, detailUrl), true);
    },
    seedRecommendations() {
      const entry = ensure();
      const url = new URL(href(), "https://nk.invalid");
      if (entry.values.recommendations || url.searchParams.get("view") !== "purchase-recommendations") return;
      const detailUrl = href();
      url.searchParams.delete("view");
      write(make("STATE", "recommendations", { ...entry.values, recommendations: { open: false } }, `${url.pathname}${url.search}${url.hash}`), false);
      write(make("STATE", "recommendations", { ...entry.values, recommendations: { open: true } }, detailUrl), true);
    },
    closeRecommendations() {
      let entry = ensure();
      let distance = 0;
      while (entry.parentId) {
        const parent = entries.get(entry.parentId);
        if (!parent || parent.marker.route.split(/[?#]/)[0] !== pathname()) break;
        distance += 1;
        if (parent.values.recommendations?.open === false) { history.go(-distance); return true; }
        entry = parent;
      }
      return false;
    },
    openTransient(key: string, close: () => void, blocked: () => boolean) {
      const entry = ensure();
      // React StrictMode's effect probe must not push another checkpoint.
      if (entry.marker.kind === "TRANSIENT" && entry.marker.key === key && !entry.departing && !transient.has(entry.marker.id)) {
        transient.set(entry.marker.id, { close, blocked });
        return entry.marker.id;
      }
      const next = make("TRANSIENT", key, { ...entry.values });
      transient.set(next.marker.id, { close, blocked });
      write(next, true);
      return next.marker.id;
    },
    retireTransient(entryId: string, consume = false) {
      transient.delete(entryId);
      if (consume && !entries.get(entryId)?.departing && readSemanticMarker(history.state)?.id === entryId) history.go(-1);
    },
    consumeRetiredTransient(entryId: string) {
      const marker = readSemanticMarker(history.state);
      if (!transient.has(entryId) && !entries.get(entryId)?.departing && marker?.id === entryId && marker.route === href()) history.go(-1);
    },
    invalidate(key: string) {
      // Completion/payload changes invalidate old Review identities, never drafts.
      for (const entry of entries.values()) delete entry.values[key];
    },
    pop(state: unknown) {
      const marker = readSemanticMarker(state);
      if (returningFromBlocked) { returningFromBlocked = false; return; }
      if (returningFromBoundary) {
        returningFromBoundary = false;
        if (marker) current = entries.get(marker.id) ?? null;
        // Back while the exit dialog is open means Continue. Both attempts
        // bounce to the existing entry, without a new sentinel or state restore.
        exitOpen = !exitOpen;
        exit(exitOpen);
        return;
      }
      const activeTransient = current && transient.get(current.marker.id);
      if (activeTransient?.blocked()) { returningFromBlocked = true; history.go(1); return; }
      if (activeTransient) {
        transient.delete(current!.marker.id);
        activeTransient.close();
      }
      if (marker?.kind === "EXIT_BOUNDARY" && !released && standalone()) {
        returningFromBoundary = true;
        history.go(1); // Reuse the existing guard; never push a sentinel loop.
        return;
      }
      beforePop();
      current = marker ? entries.get(marker.id) ?? null : null;
      if (current) restore(current); // TRANSIENT forward restores only safe state.
    },
    continueInApp() { released = false; exitOpen = false; exit(false); },
    leaveApp() {
      released = true;
      exitOpen = false;
      exit(false);
      // Attempt closing synchronously in the explicit button gesture. A runtime
      // can refuse; retain the released guard without traversing an older URL.
      // In particular, exit must never become a visit to pre-auth /login.
      if (standalone()) {
        try { requestExit(); } catch { /* Native Back remains unguarded. */ }
      }
    },
    dispose() { entries.clear(); participants.clear(); transient.clear(); },
  };
}
export type SemanticBackHistory = ReturnType<typeof createSemanticBackHistory>;
