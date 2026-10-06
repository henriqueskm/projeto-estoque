// Per-instance UI lifecycle only. Never contains stock, payloads or credentials.
export function createRouteVisit() {
  let active = false;
  let generation = 0;
  return {
    activate() { active = true; },
    invalidate() { generation += 1; },
    deactivate() { active = false; generation += 1; },
    capture() {
      const captured = generation;
      return () => active && generation === captured;
    },
  };
}

export function attachRouteVisit(visit: ReturnType<typeof createRouteVisit>, reset: () => void, target: EventTarget) {
  visit.activate();
  const beforeNavigation = () => { visit.invalidate(); reset(); };
  const events = ["nk:workspace:before-navigation", "nk:semantic:before-pop", "pagehide"];
  events.forEach(event => target.addEventListener(event, beforeNavigation));
  return () => {
    // React calls this when Activity hides the route, including router navigation.
    visit.deactivate();
    reset();
    events.forEach(event => target.removeEventListener(event, beforeNavigation));
  };
}

// The route owns this lock, not a dialog that navigation can destroy.
export function createRouteMutationGate() {
  let pending = false;
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach(listener => listener());
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    isPending: () => pending,
    acquire() {
      if (pending) return null;
      pending = true;
      publish();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        pending = false;
        publish();
      };
    },
  };
}

export function startRouteMutation(
  gate: ReturnType<typeof createRouteMutationGate>,
  visit: ReturnType<typeof createRouteVisit>,
  startTransition: (action: () => Promise<void>) => void,
  action: (isCurrentVisit: () => boolean) => Promise<void>,
  onInactiveSettled?: () => void,
) {
  const release = gate.acquire();
  if (!release) return;
  const isCurrentVisit = visit.capture();
  startTransition(async () => {
    try { await action(isCurrentVisit); }
    finally {
      try { if (!isCurrentVisit()) onInactiveSettled?.(); }
      finally { release(); }
    }
  });
}
