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

## Implementation and verification

In progress. Do not treat flags, a passing build or unit tests alone as proof
of instant authenticated navigation. Shell and ready measurements, idle
prefetch checks and Workspace State regression smoke must be recorded below
before completion. No operational data or authentication will receive a new
cache directive.
