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

The active sidebar section prevents ordinary same-tab navigation and only closes the drawer. Its marker also avoids the capture-phase workspace departure event, preserving open workspace state. The existing Semantic Back coordinator consumes only the drawer's own transient checkpoint, not the underlying filter/detail. Modified/new-tab clicks remain normal links. Workspace State schema v1 and the coordinator are unchanged.

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

`leaveApp()` now only releases the existing guard and closes its dialog. It
does **not** call `history.go(-2)` or perform any navigation, Auth, push or storage
cleanup. The next native Back is unguarded; the runtime owns leaving/minimizing
the PWA. We cannot delete arbitrary older browser history or guarantee physical
closure from web code. No new sentinel, external destination or close-window hack.

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
3. Open the exit dialog again and select Sair: no login form, logout or push change.
4. Use native Back to leave/minimize (record the runtime's actual behavior).
5. Reopen: the existing valid session still opens the authenticated app.
6. Explicit menu logout alone shows login; enabled notifications remain enabled.
7. Login again without another permission prompt; direct `/login` returns to Home.

No remote login/logout, push mutation or stock operation was executed by the
automated validation. This mandatory physical gate remains open for the user.
