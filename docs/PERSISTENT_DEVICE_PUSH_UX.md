# NK PR #85 — Persistent device push & Assistant UX

Base: `771988c7ea3ecca3dc0f327d3af008b592414bae` (main after #84).

## Official device policy

- Opt-in is persistent for this browser/device **and origin**. Logout only runs the existing local Auth sign-out and redirects to `/login`; it does not DELETE a subscription, unregister Firebase, change preference, or remove device/FID identity.
- Minha Conta owns explicit disable. The existing disable worker persists device-wide opt-out before cleanup, uses the canonical authenticated RPC through the same-origin API, and preserves uncertain FIDs for retry. Initialization/cross-tab reconciliation may finish an **already explicitly requested** disable; login does not originate an opt-out.
- The bell uses `PushNotificationControl mode="activate-only"`: compact activation copy while inactive; no configuration block while granted. Minha Conta retains the default `full` mode, including “Desativar notificações”.
- A activates → A logs out: remote ownership stays A and delivery remains enabled. B logging in is not consent to transfer ownership. Only B's explicit activation invokes the existing canonical device/FID reassociation writer. No ownership comes from a client-supplied API user ID.

## Returning login without duplicate registration

The preference key stays `negocios-k:push-preference`, device-global, never keyed by profile. The existing `negocios-k:push-confirmed-registration` key now records a small, versioned acknowledgement of a successful canonical POST: profile UUID, device UUID and FID. It contains no token/cookie/credential and **is not authorization**; Auth/RLS/RPC remain authoritative.

Same owner + device + FID reuses that acknowledgement without another POST or permission prompt. A changed FID/device can renew only an acknowledged owner. Another or unknown owner requires explicit activation. Reassociation invalidates the old acknowledgement before POST, so an uncertain response cannot leave the previous owner eligible for automatic renewal. Registration and disable retain queues, Web Locks, convergence and late-POST cleanup protection.

Legacy records without a valid ownership acknowledgement cannot safely identify the prior owner. They require one explicit activation (without another permission request if already granted), rather than guessing ownership from the login. Clearing browser storage also loses this acknowledgement. The local record does not constitute a fresh server read or guarantee delivery if a provider/administrator independently disables a subscription; no new reader, grant or migration was introduced to pretend otherwise.

## Same-tab drawer and actual Assistant pickup flow

The active sidebar section prevents ordinary same-tab navigation and only closes the drawer. Its marker also avoids the capture-phase workspace departure event, preserving open workspace state. The existing Semantic Back coordinator consumes only the drawer's own transient checkpoint, not the underlying filter/detail. Modified/new-tab clicks remain normal links. Workspace State schema v1 is unchanged.

“Itens prontos na Safisa” → existing local chat response listing Pedidos → reused `SafisaBulkPickupAction` → fresh server preview → existing confirmation boundary. The chat CTA is limited to `SAFISA_READY_PICKUP`, not pending stock entries. The #84 RPC, stale check, atomicity, idempotency, pending/uncertain gates and refresh remain unchanged. Chat snapshots never supply pickup quantities to the writer.

## Validation and reproducibility

Focused coverage includes acknowledgement reuse/rotation, legacy fail-closed handling, A/B explicit reassociation, device-wide disable/re-enable, full vs activation-only controls, no logout cleanup, same-section cancellation and the chat CTA. Existing push delivery/#82, opt-out failure/retry, Semantic Back, Activity, Workspace State, Instant Navigation, bulk and UI regressions were run.

Local browser fixture commands (existing locked CLI; no new dependency):

```powershell
node tests/persistent-device-push.visual.mjs
npx --no-install playwright-cli -s=nk85 open http://127.0.0.1:3085/estoque --browser=chrome
npx --no-install playwright-cli -s=nk85 run-code --filename=tests/persistent-device-push.smoke.js
```

The fixture compiles the real provider/control/logout form, sidebar, Workspace State, Semantic Back, Attention cards, structured chat renderer and bulk dialog. Only Auth/Firebase/network boundaries are simulated; all records are sanitized. It proves activation → logout → relogin without DELETE/unregister/disabled/duplicate POST/new permission, explicit disable and reactivation, B login vs B activation, drawer same-tab preservation, and fresh chat preview without confirming a pickup.

Viewports: 320, 375, 768, 1440 px. No horizontal overflow, console error, JS exception or failed request observed in the local fixture. This is **not** a real FCM delivery/Android/PWA test or a real authenticated remote logout test. Browser artifacts remain ignored; no session was copied/exported.

Results: 120/120 push/alerts/Semantic Back/device regressions (10 new cases); 80/80 Workspace State/Activity/Instant Navigation/Attention UI; 18/18 bulk; 13/13 layout. Additional Attention suite: 23 passed and 1 pre-existing source-contract failure below. Aggregate: **254 passed, 1 pre-existing failure**, no skips. TypeScript, scoped ESLint with zero warnings, `git diff --check` and Webpack production build passed.

NOTE: the pre-existing `Home streams Attention without blocking the Assistant shell` source-contract in `tests/assistant-attention.test.mjs` expects `loadAssistantAttention()` directly, but base main already calls the `connection()`-gated `loadAttentionOnNavigation()`. The two files are untouched. The remaining Attention cases pass; no unrelated correction was made.

No migration, RPC, queue/dispatcher, stock writer, IA, remote configuration, subscription or inventory operation changed/executed by this PR's validation. Draft; no merge/auto-merge.

## Correction 4 — PWA exit is not logout

`leaveApp()` releases the existing guard, closes its dialog and synchronously
requests `window.close()` through the provider **only in standalone**, inside
the explicit Sair gesture. This is a best-effort immediate exit attempt, not
logout. A refusal/exception leaves the guard released for native Back; there is
no blind `history.go(-2)`, navigation, Auth, push or Workspace cleanup. No new
sentinel, external destination or repeated exit loop is introduced.

The [HTML close algorithm](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-window-close)
restricts script-closable windows. Chromium Android delegates a permitted close
to its host through
[closeContents](https://chromium.googlesource.com/chromium/src/+/aeb90d3b4cea27d4ec96bf849e013d4addacef07/chrome/android/java/src/org/chromium/chrome/browser/tab/TabWebContentsDelegateAndroid.java).
Neither source guarantees that every installed Android PWA host accepts it.
No standard web API universally minimizes a PWA. Physical Android remains the
mandatory gate; a successful simulated close call is not proof of closure.

The successful login Server Action explicitly uses `RedirectType.replace`
(Next defaults Server Actions to push). The login form's existing Suspense
boundary now checks verified Supabase claims and the active internal profile.
An already authorized user visiting `/login` redirects to `/` without sign-out;
anonymous/invalid claims and inactive/missing/error profiles retain login access
without a Home/login redirect loop. Authorization is not cached or weakened.
Explicit logout remains `signOut({ scope: "local" })` → `/login`, with no push cleanup.

Additional local regressions: 9 Auth/exit cases execute the real Server Action
and login page with mocked network/navigation boundaries. Combined focused
push/alerts/Semantic Back/device/Auth suites: **129 passed, 0 failed/skipped**.
Workspace State/Activity/Instant Navigation/Attention UI: **80 passed**.
Scoped ESLint (zero warnings), TypeScript, diff-check and Webpack build passed;
Cache Components and Partial Prefetching remain enabled.

```powershell
node tests/persistent-device-push.visual.mjs
npx --no-install playwright-cli -s=nk85exit open http://127.0.0.1:3085/login?standalone=1 --browser=chrome
npx --no-install playwright-cli -s=nk85exit run-code --filename=tests/pwa-exit-auth.smoke.js
```

Browser fixture: real coordinator/provider, History API and exit dialog;
standalone detection emulated, Auth/Firebase boundaries simulated. Login replace,
repeated Back/Continue, second Back to cancel, Escape, Exit without traversal,
released native Back, explicit logout preserving push passed at **320/375/768/1440**.
Zero console errors, JS exceptions, failed requests or horizontal overflow.
The previous device push/drawer/chat-preview smoke also passes all four sizes.
These results do **not** prove a real authenticated session survives reopening on
physical Android, or that Android closes/minimizes the installed window.

### Required human Android/PWA gate — pending, not approved

Use the new Preview installed/opened as standalone on a physical Android:

1. Login normally; Back at the app boundary opens the exit dialog.
2. Continue retains page/scroll/state; repeat Back, then Back again to cancel.
3. Open the exit dialog again and select Sair: record the immediate close/minimize attempt; no login form, logout or push change.
4. If the runtime refuses closing, native Back must remain unguarded (record the actual fallback).
5. Reopen: the existing valid session still opens the authenticated app.
6. Explicit menu logout alone shows login; enabled notifications remain enabled.
7. Login again without another permission prompt; direct `/login` returns to Home.

No remote login/logout, push mutation or stock operation was executed by the
automated validation. This mandatory physical gate remains open for the user.

## Mobile Minha Conta — pending navigation cleanup

An authenticated Preview reproduced a mobile-only race: the drawer closed before
Next committed `/minha-conta`, and its transient checkpoint cleanup issued
`history.go(-1)`, cancelling the pending navigation. Desktop and direct account
navigation worked normally; account authorization was not the cause.

The central Semantic Back coordinator now listens to the existing
`nk:workspace:before-navigation` event. Only transient checkpoints already open
at navigation intent are marked as departing **in memory**. Their manual/effect
cleanup cannot traverse history, even while the URL still names the old route.
No Next history fields, Workspace State schema, drawer animation, Auth or push
behavior changed. No global pending flag or second popstate listener was added.

Ordinary manual/Escape/Back closes still consume the drawer checkpoint. A fresh
drawer after an abandoned navigation gets its own consumable checkpoint. Pending
mutation Back blocking remains active; Forward cannot resurrect a closed dialog.

Five added regressions cover both cleanup paths during a slow account navigation,
safe Back/Forward, an abandoned navigation, the pending mutation gate and central
event registration/cleanup. Focused Semantic Back, Workspace State, Activity,
Instant Navigation, device push, PWA/Auth and UI layout suites: **168 passed,
0 failed/skipped**. No credentials or browser session were saved to the repository.
TypeScript, scoped ESLint with zero warnings, diff-check and Webpack production
build passed with Cache Components and Partial Prefetching still enabled.

## Lead review gates on reviewed HEAD 9745e32

- **Live chat CTA:** a small child reads the actual Safisa alert provider. It
  enables the canonical #84 action only when `hasConfirmedData && !error &&
  alertCount > 0`. A positive historical chat snapshot cannot enable it. The
  action remains mounted with `enabled=false`, so its existing uncertain retry
  survives a zero/failed read. RPC, preview and idempotency are untouched.
- **Same-route account:** the footer now reuses `NavigationLink` with its current
  markers/cancel behavior and original compact appearance. Desktop click is a
  no-op; mobile consumes only the drawer checkpoint, never an underlying one.
- **Account runtime gate:** `AccountPage` awaits `connection()` before
  `requireActiveProfile()`. Parent layout suspension does not serialize child
  execution; the page's own auth fetch previously remained eligible for runtime
  prefetch. Auth's React request cache and claims/profile validation are unchanged.

### HANGING_PROMISE_REJECTION investigation

Exact reviewed deployment: `dpl_AevciDZ9aFtrJVMcnmqi8DMfW4os` / HEAD `9745e32`.
The historical error supplied by the Lead is outside the available Hobby log
retention (the historical query was rejected, not returned as an empty success).
Fresh authenticated focus/prefetch → account navigation on that deployment on
2026-10-06 around 21:06 UTC succeeded; browser errors were empty and a scoped
recent Vercel query contained no error/fatal, only the separate Supabase warning
about trusting `getSession().user` on GET `/`.

Installed Next 16.3.8 `server/lib/patch-fetch.js` creates a dynamic hanging promise
for no-store fetch in `prerender-runtime`; `server/dynamic-rendering-utils.js`
supplies this exact digest/message when the prerender render signal aborts.
That identifies the mechanism, **not the particular historical fetch**. We cannot
prove the old incident was harmless or assign a unique cause without its stack.
The minimal page gate removes account profile IO from that prefetch context,
following the existing operational-page pattern and the installed `connection`
guide. A direct test keeps connection unresolved and proves profile IO has not
started; resolving it renders the account. Cache Components, Partial Prefetching
and authorization stay enabled/intact. Controlled new-Preview smoke/log results
are recorded in the PR; no broader Auth rewrite is part of this correction.

### Focused validation of this delta

Eight added cases: immediate exit attempt and refusing-runtime fallback, ordinary
browser no-close, real provider zero/positive/error/unknown with old chat, shared
account links, and account connection/auth sequencing. A local browser fixture
now uses the actual Safisa provider with sanitized GET responses to test live
zero → pickup without replacing the hook; simulated close is counted without
closing the audit window. Existing push cycle and operational confirmation gates
remain. Standard Next/Turbopack and Webpack builds both pass with CC/PPR enabled.

No migration, RPC, writer, Auth cleanup, remote stock/subscription mutation or
Workspace schema change. The previous Attention source-contract NOTE remains;
the physical Android gate and historical-stack limitation are not waived.

## Same-tab drawer — asynchronous history consumption

The previous synchronous History test double hid a race: toggling a transient
closed requests Back immediately, while effect cleanup schedules another request
on the next animation frame. If `popstate` has not arrived yet, both paths saw the
same drawer marker and could consume an underlying filter or route as well.

Consumption is now reserved once per checkpoint **in memory, before** requesting
`history.go(-1)`. Both cleanup paths use the same guard; Activity/departing-route
protection and StrictMode reattachment remain intact. A consumed identity is not
reused when a drawer is reopened after Forward. No new listener, history field,
sentinel, route navigation, Workspace reset or mutation gate is introduced.

Three regressions use deferred history traversal: both cleanup orders preserve
the current route/search/filter/group and leave native Back available for the
previous useful state; reopening a consumed Forward checkpoint gets a new
consumable identity. All three fail before the fix and pass after it.

Focused validation: **193 passed, 0 failed/skipped**, including Semantic Back,
Workspace State, Activity, Instant Navigation, drawer lifecycle, persistent
device push, PWA/Auth and UI layout. TypeScript, scoped ESLint with zero warnings
and `git diff --check` pass, as does the Webpack production build with CC/PPR
enabled. Browser validation on the actual local sidebar/coordinator at
320/375/768/1440 px preserves the current route/filter on the active-tab click;
the following native Back restores the previous filter. Zero console errors.
Auth/API boundaries are simulated locally; this does not claim a physical
Android test. No migration, RPC, writer, remote stock/subscription operation,
Auth or push behavior change.
