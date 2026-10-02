# Persistent Workspace State — NK PR #77

## Architecture and safety

`WorkspaceStateProvider`, keyed by the authenticated `profile.id`, owns an instance-local external store inside React. It does not keep inactive pages rendered or fetch their datasets. Existing route loaders, auth, mutations, refreshes and sidebar prefetch policy remain authoritative and unchanged. `AssistantConversationProvider` remains separate and unchanged.

The per-tab key is `nk:workspace:v1:<profile.id>`, with envelope `{ version: 1, workspaces, hrefs }`. Memory updates synchronously; sessionStorage writes debounce 300 ms, with explicit flush before navigation, confirmation and pagehide. Logout reuses `data-assistant-session-logout`, removes the user's key and prevents late writes. Storage denial, invalid/old/incomplete JSON and quota failures fall back to memory. Allowlisted fields/identities are validated; snapshots are limited to 256,000 UTF-8 bytes.

No balances, stock capacities, official descriptions, catalog datasets, auth objects, credentials, permissions, RPC responses, receipts, pending actions or mutation dialogs are persisted. New-piece descriptions are user-entered draft text, not cached catalog metadata.

## Workspace fields

| Workspace | Persisted UI/draft fields |
| --- | --- |
| Estoque | Query, status, sort, filter panel, physical groups/families as arrays, scroll |
| Entrada | Editing/review, search, minimal line identities and quantity strings, observation, payload idempotency key, new-piece form fields, scroll |
| Saída | Editing/review, search, minimal line identities and quantity strings, observation, payload idempotency key, scroll |
| Pedidos active/history | Separate search, filters, sort, filter panel, selected detail UUID, scroll; detail is fetched again |
| Aplicações | Query/category/scroll independently for each approved brand slug |
| Estatísticas / Histórico | Validated URL as resume href, plus scroll; pages remain Server Components |

## Safe sidebar destinations

- Assistente, Estoque, Entrada and Saída: fixed base routes.
- Pedidos: only `view=active|history`, never a stored arbitrary detail URL.
- Estatísticas: `periodo` parsed by the existing domain parser.
- Histórico: existing official parser/builder for type, source, calendar dates, user, query and page.
- Aplicações: base or one of the eight currently approved brand routes actually visited through the app.

External URLs, hashes, unapproved paths and extra parameters are rejected/stripped. Prefetch operates on the resolved safe href and retains intent/idle/dedup behavior. URL tracking runs after storage hydration so an explicit current URL wins over an older saved destination.

## Draft reconciliation and idempotency

Draft lines contain IDs, kind and editable quantity only (new pieces also contain submitted code/description). On return, options are resolved against current loader props and previews are rebuilt from current balances. Unavailable/duplicate identities are removed, the user is warned, review returns to editing and the key rotates. Payload edits use the existing key-rotation handlers. Unchanged navigation/retry retains the key; confirmation flushes it before calling the existing writer. Success clears the draft immediately; late scroll cleanup cannot resurrect it. Receipts stay ephemeral.

An exact, unique loose part with the same submitted description may already exist after an interrupted create response. Its draft retains the original NEW_LOOSE_PART payload/key and uses the fresh balance for display; it is never silently converted into a new ITEM receipt/request. NOTE: the pre-existing catalog writer still rejects known codes before its RPC, so recovering that particular completed-create receipt may require a separately scoped canonical-writer follow-up. This PR does not weaken that policy or modify writers.

## Scroll priority

Explicit inventory target/deep link and card actions outrank stored scroll. Restoration waits for sufficient document height, retries at most 60 animation frames, clamps at the final available height and is canceled by user interaction/navigation. Final observed scroll is saved before route change and cleanup, avoiding Next's navigation reset overwriting it. Explicit status links have a separate component key from ordinary resume navigation.

## Verification

Focused tests exercise the store/schema, debounce, user isolation/logout, fresh draft reconciliation, stale outbound preview, idempotency preservation, successful clear, official URL validation, SSR safety and integration wiring. Existing bundle/inventory/UI/search/recommendations, Assistant context, orders, applications and statistics completeness regressions are included. Source/SSR tests are not presented as authenticated browser lifecycle tests.

Authenticated Preview smoke must navigate away and return via the menu to Estoque, both draft flows (without confirmation), Pedidos, Estatísticas, Histórico and Aplicações; then reload to verify sessionStorage recovery. Validate 320/375/768/1440 px and inspect console/network errors. No stock/order mutation is needed.

## Possible PR #78 (not implemented)

Measure navigation after durable workspace state is verified. Consider Instant Navigation/Cache Components only in a separate, evidence-based change; do not use router/Activity lifetime as a substitute for drafts, enable global Cache Components here, cache operational balances, or preload all route datasets.
