# Worker runtime, Phase 3 (macOS arm64)

25 November 2026, macOS arm64 (M5 Max), Node 26.13.1 as the reference.

- Every benchmark ran 15 rotated, paired rounds in one `both`-lock hold (`TZ=UTC`).
- Every native image ran under LLDB with stop-at-entry and exit status 42 asserted (exit 0 for Stage 2); Node exited 42. Zero observations failed.
- Base images (`a`) were built at merge base `3d77ed294` (`origin/main` `a069d8c94` merged into `perf/worker-runtime`).
- Candidate images (`b`, and `plain`/`main`/`worker`) were built at `dc022284e`.

## Changes

| Commit      | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3d77ed294` | Merge `origin/main` (`a069d8c94`, including P1 #41, P2 #34, #24) into `perf/worker-runtime`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ccb41fb68` | Defer parallel-collector workspaces (coalesced into a single `mmap`) into `start()`, remove eager `warm()`, and skip `/proc/self/cgroup` probing off Linux via compile-time `runtimeTargetOS()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `dc022284e` | Eliminate per-message allocations across `worker-messages.ts` (re-entrancy-safe 1-slot send/receive state caches, 0-grant fast paths), `agent-messages.ts` & `worker-ports.ts` (reused scratch, packet header windows, pending arrays, hoisted `deliver` closure), `shared-blocks.ts` & `shared-waiters.ts` (reused facade scratch, cached fixed-block lengths), `node/worker-threads.ts` & `worker-threads-native.ts` (`emitOne`, zero-alloc 0/1-listener dispatch, direct typed listener fast path via `listen()`), `structured-clone.ts` (lone-string / lone-shared-string fast paths), `event-loop.ts` & `event-loop-reactor.ts` & `jobs.ts` (`drainScriptJobs` empty-queue fast path, hoisted closures), `typed-array-data.ts`, and `js-engine/src/program/index.ts` |

## Typed transport (`typed-transport-pair`)

15 rounds, load median 3.24 (IQR 2.95–4.22).
[Raw rounds](worker-runtime-phase3-v1-typed-transport.json)

| Operation         |        Base (µs) |     Phase 3 (µs) | Node 26.13.1 (µs) |    Phase 3 / base |    Phase 3 / Node |
| ----------------- | ---------------: | ---------------: | ----------------: | ----------------: | ----------------: |
| typed-round-trip  | 2.53 (2.52–2.55) | 1.80 (1.78–1.81) |  7.99 (7.93–8.12) | 0.71× (0.70–0.71) | 0.22× (0.22–0.23) |
| typed-batch       | 0.47 (0.47–0.48) | 0.40 (0.40–0.40) |  0.54 (0.53–0.55) | 0.84× (0.83–0.85) | 0.74× (0.72–0.77) |
| typed-string-1KiB | 3.32 (3.29–3.35) | 2.65 (2.60–2.68) |  8.33 (8.26–8.45) | 0.79× (0.78–0.81) | 0.32× (0.31–0.32) |
| typed-counter     | 0.01 (0.01–0.01) | 0.01 (0.01–0.01) |  0.01 (0.01–0.01) | 1.03× (0.99–1.06) | 0.74× (0.68–0.77) |

Every typed transport operation is now well below 1.0× Node (0.22×–0.74×).

## Untyped transport and lifecycle (`transport-pair`)

15 rounds. [Raw rounds](worker-runtime-phase3-v1-transport.json)

| Operation           |                 Base (µs) |              Phase 3 (µs) |         Node 26.13.1 (µs) |    Phase 3 / base |       Phase 3 / Node |
| ------------------- | ------------------------: | ------------------------: | ------------------------: | ----------------: | -------------------: |
| startup             | 1334.75 (1286.83–1460.19) | 1264.67 (1233.44–1446.73) | 4908.21 (4887.33–4961.25) | 0.92× (0.85–1.09) |    0.26× (0.25–0.29) |
| terminate           |    169.21 (156.90–189.75) |    113.29 (110.58–121.40) |    266.87 (258.25–276.04) | 0.66× (0.54–0.75) |    0.43× (0.40–0.45) |
| startup-8           |    226.46 (223.99–231.20) |    218.95 (217.81–223.26) |    888.85 (874.58–931.91) | 0.96× (0.94–0.99) |    0.24× (0.24–0.25) |
| round-trip          |          6.40 (6.31–6.44) |          6.05 (6.01–6.11) |          8.63 (8.53–9.03) | 0.95× (0.94–0.97) |    0.70× (0.68–0.72) |
| clone-records-16    |       55.38 (54.86–58.22) |       53.17 (52.95–54.11) |       20.63 (20.54–21.03) | 0.96× (0.94–0.97) |    2.58× (2.56–2.61) |
| clone-records-1024  | 2588.67 (2575.81–2616.45) | 2569.83 (2562.23–2578.61) |    612.83 (611.11–617.36) | 0.99× (0.98–1.00) |    4.19× (4.16–4.21) |
| clone-numbers-1024  |       54.47 (54.21–55.00) |       53.77 (53.58–53.93) |       63.92 (63.53–64.23) | 0.99× (0.98–0.99) |    0.84× (0.84–0.85) |
| clone-numbers-65536 | 2602.76 (2590.09–2609.79) | 2569.17 (2559.08–2585.29) | 3509.96 (3474.07–3542.78) | 0.99× (0.98–1.00) |    0.73× (0.73–0.74) |
| clone-string-1KiB   |          8.51 (8.46–8.67) |          8.06 (8.00–8.14) |          9.55 (9.39–9.73) | 0.95× (0.94–0.96) |    0.84× (0.83–0.87) |
| clone-string-1MiB   |       10.48 (10.22–10.89) |        10.15 (9.93–10.56) |    154.46 (149.85–159.03) | 0.96× (0.94–1.02) |    0.07× (0.06–0.07) |
| clone-tree-4        |    120.25 (119.41–126.62) |    118.06 (117.59–119.06) |       28.42 (28.19–28.79) | 0.98× (0.96–0.99) |    4.17× (4.14–4.19) |
| clone-tree-10       | 6897.52 (6876.57–6981.04) | 6928.45 (6894.35–6945.92) | 1259.22 (1248.16–1269.96) | 1.00× (0.99–1.01) |    5.51× (5.47–5.54) |
| transfer-65536      |          9.00 (8.90–9.10) |          8.84 (8.78–9.07) |          9.84 (9.77–9.98) | 0.98× (0.97–1.01) |    0.90× (0.90–0.91) |
| transfer-8388608    |          8.85 (8.81–8.92) |          8.72 (8.62–8.87) |          9.80 (9.69–9.88) | 0.98× (0.97–1.00) |    0.89× (0.88–0.92) |
| batch               |          0.47 (0.47–0.47) |          0.36 (0.36–0.36) |          0.59 (0.54–0.60) | 0.77× (0.76–0.78) |    0.61× (0.60–0.67) |
| port-round-trip     |          3.85 (3.77–3.91) |          3.49 (3.46–3.56) |          7.96 (7.86–7.99) | 0.91× (0.90–0.93) |    0.44× (0.44–0.45) |
| wait-notify         |          7.81 (7.79–7.86) |          7.25 (7.22–7.38) |          6.31 (6.21–6.39) | 0.93× (0.92–0.95) |    1.16× (1.14–1.18) |
| wait-async          |          7.18 (7.05–7.25) |          7.15 (7.11–7.30) |          7.33 (7.29–7.44) | 1.00× (0.98–1.02) |    0.98× (0.97–1.00) |
| counter-1           |          0.26 (0.26–0.26) |          0.24 (0.24–0.24) |          0.01 (0.01–0.01) | 0.94× (0.93–0.94) | 36.27× (35.87–36.89) |
| counter-4           |          0.09 (0.09–0.09) |          0.09 (0.09–0.09) |          0.01 (0.01–0.01) | 1.03× (1.02–1.06) |    7.69× (7.52–7.83) |

- **Idle teardown (`terminate`)** dropped 34% (`169.2 µs → 113.3 µs`, 0.43× Node), removing the parallel-collector workspace `mmap`/`munmap` and helper-thread join overhead on short-lived Workers.
- **Every transport, transfer, lifecycle, string, number-array, and `wait-async` op** is at or below Node (0.07×–0.98×).
- **Remaining ops > 1.0× Node** (`wait-notify` at 1.16×, `clone-records-*`, `clone-tree-*`, `counter-*`) are bounded by the untyped object model and untyped builtin call floor (PR #12).

## Kernel placements (`placements`)

15 rounds, load median 3.81 (IQR 3.28–4.88).
[Raw rounds](worker-runtime-phase3-v1-placements.json)

| Kernel     |     tint-plain (ms) |      tint-main (ms) |    tint-worker (ms) |      main / plain |    worker / plain |
| ---------- | ------------------: | ------------------: | ------------------: | ----------------: | ----------------: |
| allocation | 14.01 (13.97–14.04) | 13.41 (13.30–13.45) | 13.17 (13.09–13.22) | 0.96× (0.95–0.96) | 0.94× (0.93–0.95) |
| numeric    | 45.27 (44.66–46.28) | 47.23 (46.73–48.48) | 44.95 (44.53–45.58) | 1.05× (1.02–1.08) | 0.99× (0.98–1.01) |
| calls      | 42.32 (41.80–42.76) | 44.36 (42.36–44.79) | 44.76 (44.17–45.60) | 1.04× (0.99–1.07) | 1.05× (1.04–1.07) |
| strings    | 23.10 (23.05–23.30) | 23.52 (23.42–23.63) | 23.41 (23.33–23.73) | 1.02× (1.01–1.02) | 1.02× (1.00–1.03) |
| compiler   | 34.65 (34.52–34.81) | 35.46 (35.35–35.53) | 35.60 (35.49–35.74) | 1.02× (1.02–1.03) | 1.03× (1.02–1.03) |

## Validation

- **Static checks:** `pnpm build`, `tsc -p tsconfig.tests.json --noEmit`, `tsc -p tsconfig.host.json --noEmit`, `pnpm boundaries`, `pnpm format:check`, `node tools/selfhost-coverage.ts` (`828/828`), and `catalog.ts` diff check all pass.
- **Unit tests:** Full package and concurrent tool suites passed (6,200+ tests, 0 failures; only `tools/test262-module-graph.test.ts` expects a local `.tint-bootstrap/test262` checkout).
- **Native Worker fixtures under LLDB (16/16 pass, stop-at-entry + exit 42):** `worker-threads-suite`, `worker-typed-entry`, `worker-typed-shared`, `worker-messages`, `worker-ports`, `worker-clone`, `worker-backing`, `worker-exit`, `worker-safepoint`, `worker-compiler`, `worker-memory-model`, `worker-port-recycling`, `worker-transfer-stress`, `worker-zlib-stress`, `worker-shared-strings-parallel`, `worker-shared-strings-serial`.
- **Self-build fixpoint under LLDB:** Stage 1 (`50,461,194` bytes) → Stage 2 exited 0 and matched bit-for-bit (`sha256 9750ce4fee88d626aecc3926434c7b4fbccf534d4058c559f666b16493ecab46`).
