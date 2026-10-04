# NK PR #78 — Instant Navigation & Route Shells

## Baseline collected before behavior changes

Base: `d6f20cabdd29ebc17836c1eb8e4262e1f5946ffb` (merge #77).
The #77 Preview runs `5ab0726fb0e657cb55ebc6d7840f225cc4600715`, whose tree matches this base.
Measured on 2026-10-03 in authenticated Chrome, using the existing Preview-only
`?nk_perf=1` panel. Same ordered sidebar sequence twice; the second sequence
starts from Assistant again. No stock/order confirmations. Browser clicks
registered prefetch intent on each transition. No CPU/network throttling.

These are first/repeated **observed sequences**, not controlled cold/warm cache
measurements. The initial Home load before the sequence was 1,242 ms. Only the
existing click-to-ready marker + next animation frame was measured; shell
latency was not separately instrumented before this PR. One sample per
transition/round is not enough for statistical performance claims.

| Transition | First observed ready ms | Repeated ready ms |
| --- | ---: | ---: |
| Assistant → Inventory | 1379 | 771 |
| Inventory → Inbound | 1003 | 855 |
| Inbound → Outbound | 924 | 839 |
| Outbound → Orders | 848 | 571 |
| Orders → Inventory | 887 | 839 |
| Inventory → Applications | 572 | 554 |
| Applications → Statistics | 1495 | 1229 |
| Statistics → History | 1259 | 747 |

## Implementation: stream operational data, prepare only shells

`next.config.ts` changes from an empty configuration to:

```ts
cacheComponents: true,
partialPrefetching: true,
```

Next 16.3.8 and React 19.2.4 are unchanged. No dependency was added.
All seven existing `loading.tsx` files are reused, with a recognizable title,
`aria-busy="true"` and an allowlisted `data-nk-perf-shell` marker. They contain
no balances, minimums or operational datasets. The normal ready markers remain.

The seven pages, Application brand detail, History batch detail, authenticated
layout and Home Attention explicitly wait for `connection()` before starting
runtime loaders or authorization. This is the installed Next API for excluding
work below the boundary from prerendering/runtime prefetch; it does not cache
the result. Authenticated content streams behind Suspense without changing the
profile gate, provider identities or Workspace State schema v1.

This guard was necessary, not hypothetical: intermediate A/B deployments
started operational phases during `Next-Router-Prefetch: 3` runtime requests,
including canceled phases with zero rows and long durations. After the guard,
idle requests contained static shells rather than those operational datasets.
No `use cache`, `instant = false`, experimental PPR or `staleTimes` workaround
was introduced. `lib/shared-catalog.ts` remains unchanged, including its existing
user-scoped cache, auth/RLS gate and invalidation. Stock, minimums, Orders,
recommendations, Statistics and History keep their existing fresh readers.

### Compatibility work required by the flags

- Login's runtime search parameters are behind a small Suspense boundary.
- Commercial Proposal's existing session authorization is behind Suspense;
  protected content still requires that session.
- Safisa gains a loading boundary; its authorization and writers are unchanged.
- Eight API routes lose only the unsupported `force-dynamic` declaration.
  Their authenticated handlers and explicit `no-store` headers remain intact.
- Manual article routing loses unsupported `dynamicParams = false`; static
  parameters and the existing unknown-article `notFound()` guard remain.

Webpack and the standard build were both checked: the latter caught obsolete
route options that Webpack alone did not reject. The production build pipeline
was not changed permanently.

## Prefetch comparison and decision

Tested A (existing custom idle/pointer/focus warmup) and B (native sidebar Link
prefetch), both with the new flags. Initially neither had the final runtime
guard; those exploratory timings are not an apples-to-apples final benchmark.

- A with the original five-route idle queue observed first-sequence shells
  at 20–35 ms for prepared routes, but Statistics/History at 820/338 ms when
  not yet prepared. This motivated adding those two shells to the queue.
- B observed shells at 92–116 ms initially and 100–116 ms on repetition, but
  had no reliable idle preparation for links hidden inside the mobile drawer.
- B with the runtime guard still did not establish a consistent ready-time
  advantage. A controlled, artificial 5-second network-latency experiment on
  an unprepared drawer route demonstrated waiting for network rather than an
  immediately available shell. This is a functional diagnostic, NOT a timing
  benchmark; network emulation was removed afterward.

Final choice: preserve A, add Statistics and History to its existing idle
queue, keep `Link prefetch={false}` and the existing deduplication and safe
Resume Hrefs. There are NOT two competing sidebar prefetch systems. All seven
shells can prepare even while the mobile drawer is closed; pointer/focus is
not the only preparation mechanism. This is a coverage/reliability decision,
not a statistically proven assertion that A is faster than B.

## Final measured sequence

Implementation measured: `fc413d623ebadce0532ac50cb88230ab5e103d31`.
Authenticated Chrome, 1440 × 900, same ordered sequence and two rounds as the
baseline, no CPU/network throttling. Initial Home ready was 2,019 ms.

| Transition | First shell ms | First ready ms | Repeated shell ms | Repeated ready ms |
| --- | ---: | ---: | ---: | ---: |
| Assistant → Inventory | 148 | 1341 | 118 | 2310 |
| Inventory → Inbound | 109 | 1328 | 126 | 1316 |
| Inbound → Outbound | 134 | 1316 | 109 | 1321 |
| Outbound → Orders | 128 | 1343 | 109 | 1321 |
| Orders → Inventory | 124 | 1350 | 123 | 1315 |
| Inventory → Applications | 109 | 1289 | 110 | 1339 |
| Applications → Statistics | 107 | 1334 | 107 | 1320 |
| Statistics → History | 125 | 1336 | 108 | 1322 |

The destination shell was observed before its operational content in every
measured transition. **Ready time did not improve consistently** relative to
the baseline; the repeated Inventory sample was 2,310 ms. This PR establishes
early visual destination feedback, not faster queries or a percentage speedup.
Before-PR shell time was not measured, so a numeric shell improvement ratio
cannot be calculated. The initial Home loads are not controlled comparisons.

Separate final mobile smoke: at 320 px, after idle preparation on Home, a real
CDP touch (no preceding hover) observed Inventory shell at 116 ms and ready at
2,316 ms. Touch can itself emit pointer/focus intent; the panel's intent flag
does not prove a mouse hover. No touch latency was folded into the desktop table.

### Metric boundaries and safety

Shell/ready mean first visible allowlisted DOM marker observed on the next
animation frame after a sidebar click. They do not measure pixel paint,
interaction readiness, image decode/download or time spent in a server phase.
Hidden retained Activity routes are excluded. A direct-ready navigation with
no observed shell reports `null`, not an invented zero. Query strings and IDs
are excluded from samples; only official section names are exported.

Diagnostics mount only in development/Preview and require `?nk_perf=1` or its
session-local activation. `Desligar` removes the active mode. Observers,
animation frames and event listeners are cleaned up. No external telemetry,
credential, business code, message, order detail or personal identifier is
recorded by this instrumentation. There are only 24 retained navigation samples.

## Idle Network and Vercel runtime evidence

On the final deployment, opening authenticated Home and leaving it idle caused
18 priority-route RSC requests in the captured window: seven static `__PAGE__`
shell segments (one per route) and eleven structural `_tree` requests. All had
`Next-Router-Prefetch: 1`; no operational runtime-shell `: 3` request was observed.
Counts describe that observed window, not a universal fixed request count.

Each of the seven inspected page bodies contained its shell marker, no ready
marker, and no sampled operational field names (`looseQuantity`,
`assembledQuantity`, `readyQuantity`, `ordered_quantity`, `movement_batches`).
Approximate body lengths ranged from 6,299 to 7,291 characters. These are string
lengths, NOT claimed compressed transfer bytes or a complete payload proof
independent of runtime logs.

The final Home idle runtime window (starting with the 23:26:12 UTC Home request
on 2026-10-03) recorded auth/profile, shared catalog and the existing Home
Attention readers. No navigation-page inventory/inbound/outbound/orders/
applications/statistics/history loader ran before the next click. Home's own
Attention legitimately reads current stock/minimums and pending Orders; that
is not an idle prefetch of every other page. After actual navigation, runtime
logs showed the normal fresh operational phases. An RSC resume POST is not a
stock mutation. CDN `HIT` does not mean balances were put into application cache.

The preexisting Supabase `getSession()` warning in the structural catalog
reader remains a NOTE outside this PR. No new shared auth cache was introduced.

## Workspace State and browser verification

Authenticated Preview smoke used 320, 375, 768 and 1440 px, including the drawer,
Home, Inventory, Inbound/Outbound and secondary routes. Checked responsive
layouts did not exceed the viewport width. The diagnostic panel can be disabled
and did not remain visible during normal layout checks.

- Inventory MBF015 query, open Servo group and scroll survived ida/volta.
- Inbound with two draft lines survived ida/volta and reload.
- Outbound with two draft lines survived ida/volta and reload; selected results
  remained disabled instead of duplicating cart lines.
- Recommendation deep link opened the local dialog. Browser Back/Forward
  restored its route/dialog, and X closed it without a stock operation.
- Sidebar resumes and query-parameter state remained under the #77 provider;
  no Workspace State persistence code or schema was changed.
- Statistics returned with `periodo=30`, and Orders returned with `view=history`
  after navigating away; neither action changed an Order.
- Preview browser console: 0 captured warnings/errors, including no hydration
  or React errors. This does not imply that every server reader succeeded.
- No stock/order operation was confirmed. Only our new-tab test cart was
  removed through its normal local Remove buttons after verification.

One resumed Outbound request showed the existing “Catálogo indisponível” error
state. Reload recovered, and subsequent draft/reload checks worked. Its cause
was not established; it is not presented as an error-free backend run or hidden
by changing loader error handling. Preview console checks are reported separately
from that handled server-reader failure.

Navigation Inspector was exercised locally on Presentation → Manual with Cache
Components enabled: pause, loading-shell navigation inspection and resume.
Authenticated local Inspector was blocked by missing worktree Supabase public
environment configuration/session; no secret was copied or fabricated. Principal
authenticated evidence comes from the Preview, metrics, Network and runtime logs.
No authenticated `instant()` harness exists in this repository; no new E2E
framework, account, password or dependency was introduced just to manufacture it.

## Verification

367 unique tests passed, 0 failed, 0 skipped, including 17 new tests in
`tests/instant-navigation.test.mjs`. The existing harnesses were retained:

- 149: workspace-state + bundle-inventory, using bundle-inventory-loader.
- 217: UI layout, inventory query UX, performance diagnostics, instant navigation,
  recommendations navigation, applications, supplier performance, public site,
  proposal authorization, Safisa, image components, Assistant persistence,
  statistics completeness and search input, using the Assistant alias loader.
- 1: statistics pagination, using statistics-data-loader.

Commands used `node --experimental-strip-types --experimental-loader <existing
loader> --test <focused files>`. Existing Node module-type warnings are not ESLint
warnings. TypeScript (`npx tsc --noEmit`), ESLint (`--max-warnings=0` on changed
TS/TSX/MJS), `git diff --check`, Webpack build and standard Next build passed.
The final implementation deployment passed Vercel's standard build and was READY.
Subsequent documentation-only changes do not require rerunning these suites.

## Changed files / scope

- `next.config.ts`, `components/app-sidebar.tsx`.
- `components/performance-audit-panel.tsx`, `lib/navigation-performance.ts`.
- Authenticated `layout.tsx`, Home `page.tsx`, and each of the seven priority
  route `page.tsx` / `loading.tsx` pairs.
- Application `[slug]/page.tsx`, History `[batchId]/page.tsx`.
- Login, public Proposal and Manual article pages, Safisa loading boundary.
- API route declarations only: configuration-image, recommendations, push,
  Safisa alerts, supplier detail/media/catalog/search.
- `tests/instant-navigation.test.mjs`, `tests/ui-layout-regressions.test.mjs`,
  `tests/commercial-proposal.test.mjs`, `tests/supplier-orders-performance.test.mjs`.
- This report, `docs/INSTANT_NAVIGATION.md`.

No migration, schema, RPC, RLS, writer, balance, stock calculation, AI model,
Assistant routing or remote stock operation was changed. PR #78 stays Draft;
no merge or auto-merge.

Preview: https://projeto-estoque-sp4o-git-codex-nk-p-b09da0-henrqueskms-projects.vercel.app/

## Activity lifecycle follow-up — transactional UI

Correction on reviewed `c7729e1891711c635550b7aabb1219faccf9d28e`;
implementation tested in Preview: `41df494b556faed30365df33dbe89fe8985a5777`.
Cache Components, partial prefetching, streaming, `connection()`, shell markers
and all preceding measurements remain unchanged.

The shared `useRouteTransientCleanup` returns a **layout Effect cleanup**:
React Activity calls it when hiding a retained route, not only on traditional
unmount. It also listens to the existing before-navigation event, `popstate`
and `pagehide`; mouse clicks are not the only trigger. A visit generation makes
late asynchronous UI callbacks inert even if the route has already reappeared.
This follows the installed Next preserving-UI-state guide and
[React Activity's Effect lifecycle](https://react.dev/reference/react/Activity).

- Inventory clears its action menu, mutation dialog and feedback only.
- Orders clears creation/editing, nested confirmations, finalization, stock-entry
  dialogs and feedback. The safe read-only selected Order can reopen normally.
- Inbound/Outbound clear completed receipts and transient errors, **not** the
  editing/review draft, cart, key or existing in-flight guard. A real successful
  response still clears its committed draft, but cannot revive a hidden receipt
  or scroll another route.
- Inventory/Orders keep a route-owned pending gate outside disposable dialogs.
  Closing or hiding a dialog does not release it; only the actual promise's
  `finally` does. Another submission is blocked while that operation remains
  pending in the retained route. Keys and canonical writers are unchanged.
- No Workspace State schema, persistence, query, filter, sort, accordion or
  scroll reset was introduced. Idle Inventory rows do not register cleanup
  listeners until they have transient UI to dispose.

### Authenticated Activity smoke

Chrome, existing authenticated branch Preview, Cache Components actually active.
The old ready-marker DOM remained present with zero client rects after navigating
away from Inventory, Orders, Inbound and Outbound: these were retained **hidden**
routes, not just conventional unmount/reload tests.

- Inventory Sale, Adjustment, Minimum, Assembly, Disassembly and action menu
  were opened without submitting. Back/Forward never reopened them. MBF015
  search and the open Servo accordion remained restored.
- Orders creation, editing and exclusion confirmation closed on Back/Forward.
  Search, pending status filter, oldest-first sort and active view survived.
  The real selected read-only Order detail returned after its fresh detail read;
  its editing/confirmation dialog did not.
- Inbound review with a configuration line and Outbound review with a bundle
  line survived client-side navigation to Inventory and browser Back. Inbound
  review also survived a subsequent visit from Outbound. Our test lines were
  removed afterward using local cart Remove controls only.
- No stock, Order or minimum operation was confirmed. Pending completion,
  receipt suppression and key identity are proved by controlled-promise/local
  tests, **not** by a fabricated remote mutation or remote receipt smoke.
- Browser captured warning/error logs: 0. The CDP exception/event tail also
  contained 0 errors but was truncated, so it is not a complete exception trace.
  The diagnostics panel was switched off after measurement.

### Follow-up navigation samples

Same Preview and existing panel, normal desktop viewport, no CPU/network
throttling. These are observed first/repeated visits during a functional smoke,
not controlled cold/warm cache benchmarks. Shell/ready retain the original DOM
marker/frame limitations. Initial Home ready was 2,432 ms.

| Destination | First shell ms | First ready ms | Later sequence shell ms | Later ready ms |
| --- | ---: | ---: | ---: | ---: |
| Inventory | 82 | 2168 | 58 | 1172 |
| Orders | 59 | 2144 | not observed | 1122 |
| Inbound | 59 | 2167 | 46 | 1115 |
| Outbound | 36 | 2134 | not observed | 1157 |

The observed early shells remain in the tens-of-milliseconds range; a retained
route can instead return directly to its ready marker. **One intermediate
Inbound return observed shell 1,111 ms / ready 2,134 ms**. Its cause was not
established; it is retained as a limitation, not discarded to claim consistently
instant navigation. No shell/ready instrumentation or prefetch was changed by
this lifecycle correction, and no universal latency guarantee is claimed.

### Follow-up verification

**399 unique tests passed, 0 failed, 0 skipped**: the prior 367 regressions,
18 new lifecycle/pending-promise tests in `tests/route-transient-state.test.mjs`,
7 existing Order stale-conflict tests and 7 existing Adjustment stale-conflict
tests. New tests exercise the cleanup actually returned to the layout Effect,
navigation events including popstate, preserved review/key, discarded receipts,
late completion and pending-gate ownership; source-contract assertions verify
the production hooks/dialogs. They are not presented as a React DOM E2E suite;
actual Activity hiding/restoration was verified in the authenticated smoke above.

TypeScript, changed-file ESLint with zero warnings, diff-check and Webpack build
passed. The implementation's standard Vercel build was READY. Only technical
documentation was added after that tested implementation. No migration, RPC,
writer, stock calculation, balance, AI or remote operation changed. PR #78
remains Draft, without merge or auto-merge.
