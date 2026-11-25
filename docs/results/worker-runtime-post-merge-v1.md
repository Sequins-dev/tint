# Worker runtime, post-merge optimization pass (macOS arm64)

26 November 2026, macOS arm64 (M5 Max), Node 26.13.1 as the reference.

- Every benchmark ran 15 rotated, paired rounds in one `both`-lock hold (`TZ=UTC`).
- Every native image ran under LLDB with stop-at-entry and exit status 42 asserted (exit 0 for Stage 2); Node exited 42. Zero observations failed.
- Images were built from `25b9682ff` (all runtime/compiler/codegen changes on top of `origin/main` `c0d6fe1d1`, including PR #44, PR #18 one-byte/sliced strings, and PR #12 general runtime optimizations; `6a1c821b5` updates only `tools/` test global lists and Script runtime surface assertions).
- Comparison reference for Phase 3 (`dc022284e`, pre-#12/#18) is [worker-runtime-phase3-v1.md](worker-runtime-phase3-v1.md).

## Changes since Phase 3

| Commit      | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4a4a24214` | Merge `origin/main` (`45633f020`, post-#42) into `perf/worker-runtime`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `085d2393f` | Bind `runtimeTargetOS` in `tools/native-host-facts.test.ts` `factBindings`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `8621536b7` | Narrow `unknown` to `SharedArrayBuffer` and project realm `SharedArrayBuffer`s in typed code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `61513c5ef` | Merge `origin/main` (`c0d6fe1d1`, including PR #44, PR #18 one-byte/sliced strings, and PR #12 general runtime) into `perf/worker-runtime`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `602233785` | Update `tools/build-worker-clone-fixture.ts` to use `exoticSlots`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `2b9a31c39` | Fix `SharedArrayBuffer` flow recursion in `packages/ts-native/src/scalar.ts` and flatten sliced strings in `string-copy` on AArch64 and x86-64                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `25b9682ff` | Shape-aware structured clone with zero-exotic cycle marks, pooled scratch tables, unrolled 1–4 slot fast paths, direct packed array decode, and 32-slot short Latin-1 string cache (`structured-clone.ts`, `operations.ts`); missing-property IC caching (`operations.ts`); inline + loop-hoisted `Atomics.add`/`load`/`store` lowering (`atomics-access.ts`, `atomics.ts`, `typed-array-data.ts`, `js-engine/src/lowering/index.ts`); AArch64 ARMv8.1 LSE `ldaddal` for `array-atomic` add on Darwin arm64 (`aarch64/isa.ts`, `aarch64/scalar/index.ts`); self-hosting fixes (`call-targets.ts`, `x86_64/scalar/index.ts`); serial shared-string fixture churn adjustment |
| `6a1c821b5` | Add `"Atomics"` to tool globals lists, filter new `Atomics` fast-path helpers for historical snapshots, and update Script runtime surface count assertions (`192 → 196`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Image identities

| Image                    |      Bytes | SHA-256                                                            |
| ------------------------ | ---------: | ------------------------------------------------------------------ |
| `worker-bench-plain`     |    859,619 | `b4baf2706ff4f0c42bd21b324df2c848faede80664c1bb32a8d086cba4302fbc` |
| `worker-bench-main`      | 25,049,794 | `f952ccc2d5e7de7ba9470a78194b543d2ebcb0b2cbf1a9706be3377ff88bcdf1` |
| `worker-bench-worker`    | 25,049,796 | `5fd551e8c6f98a009e7b958734d29c2c8ffc74d634c1c7c372191b39cb693c03` |
| `worker-bench-transport` | 26,634,951 | `2c56ad2c770f1f8c5cd951ec97c10ecd3236f3007b393d15e8c3e097420d3a22` |
| `worker-bench-typed`     | 25,000,269 | `2f56b2b1fed554b3765b523bb5b6f0cfe7eb1c5ee8f597fd8789715cbd6a5a46` |

## Typed transport (`typed-transport`)

15 rounds, load median 3.14 (IQR 2.97–3.20).
[Raw rounds](worker-runtime-post-merge-v1-typed-transport.json)

| Operation         |        Tint (µs) | Node 26.13.1 (µs) |       Tint / Node | Phase 3 / Node |
| ----------------- | ---------------: | ----------------: | ----------------: | -------------: |
| typed-round-trip  | 1.73 (1.72–1.74) |  7.93 (7.88–8.06) | 0.22× (0.21–0.22) |          0.22× |
| typed-batch       | 0.37 (0.37–0.37) |  0.54 (0.51–0.56) | 0.69× (0.67–0.74) |          0.74× |
| typed-string-1KiB | 2.16 (2.16–2.17) |  8.26 (8.21–8.31) | 0.26× (0.26–0.26) |          0.32× |
| typed-counter     | 0.01 (0.01–0.01) |  0.01 (0.01–0.01) | 0.55× (0.53–0.56) |          0.74× |

Every typed transport operation is well below 1.0× Node (0.22×–0.69×). One-byte strings cut `typed-string-1KiB` from 2.65 µs to 2.16 µs (0.26× Node), and AArch64 LSE `ldaddal` cut `typed-counter` from 0.74× to 0.55× Node.

## Untyped transport and lifecycle (`transport`)

15 rounds, load median 2.70 (IQR 2.57–2.76).
[Raw rounds](worker-runtime-post-merge-v1-transport.json)

| Operation           |                 Tint (µs) |         Node 26.13.1 (µs) |       Tint / Node | Phase 3 / Node |
| ------------------- | ------------------------: | ------------------------: | ----------------: | -------------: |
| startup             | 1421.00 (1383.44–1450.23) | 4856.54 (4809.81–4886.17) | 0.29× (0.29–0.30) |          0.26× |
| terminate           |     101.71 (96.52–111.54) |    252.50 (240.71–262.90) | 0.41× (0.38–0.44) |          0.43× |
| startup-8           |    253.55 (251.70–258.48) |    885.92 (878.42–904.49) | 0.29× (0.28–0.29) |          0.24× |
| round-trip          |          5.44 (5.40–5.58) |          8.54 (8.47–8.65) | 0.64× (0.63–0.65) |          0.70× |
| clone-records-16    |       18.41 (18.30–18.54) |       20.45 (20.30–20.60) | 0.90× (0.89–0.91) |          2.58× |
| clone-records-1024  |    694.71 (691.40–699.02) |    605.68 (601.57–611.90) | 1.15× (1.14–1.15) |          4.19× |
| clone-numbers-1024  |       42.78 (42.68–42.85) |       63.41 (63.25–63.75) | 0.67× (0.67–0.68) |          0.84× |
| clone-numbers-65536 | 2195.85 (2182.42–2211.65) | 3475.57 (3457.69–3493.05) | 0.63× (0.63–0.64) |          0.73× |
| clone-string-1KiB   |          5.24 (5.21–5.28) |          9.38 (9.36–9.46) | 0.56× (0.55–0.56) |          0.84× |
| clone-string-1MiB   |          5.78 (5.75–5.85) |    153.83 (150.25–162.67) | 0.04× (0.04–0.04) |          0.07× |
| clone-tree-4        |       30.62 (30.46–30.83) |       28.26 (28.09–28.68) | 1.08× (1.07–1.10) |          4.17× |
| clone-tree-10       | 1574.86 (1564.65–1586.55) | 1250.84 (1243.71–1260.00) | 1.26× (1.25–1.27) |          5.51× |
| transfer-65536      |          6.13 (6.06–6.18) |         9.87 (9.78–10.00) | 0.62× (0.61–0.63) |          0.90× |
| transfer-8388608    |          6.00 (5.98–6.06) |          9.72 (9.54–9.91) | 0.62× (0.61–0.63) |          0.89× |
| batch               |          0.39 (0.38–0.39) |          0.59 (0.55–0.62) | 0.66× (0.62–0.70) |          0.61× |
| port-round-trip     |          3.28 (3.21–3.29) |          7.87 (7.80–7.98) | 0.42× (0.40–0.42) |          0.44× |
| wait-notify         |          5.81 (5.75–5.87) |          6.30 (6.18–6.35) | 0.93× (0.92–0.95) |          1.16× |
| wait-async          |          4.76 (4.47–4.85) |          7.42 (7.25–7.49) | 0.64× (0.62–0.66) |          0.98× |
| counter-1           |          0.00 (0.00–0.00) |          0.01 (0.01–0.01) | 0.50× (0.50–0.51) |         36.27× |
| counter-4           |          0.01 (0.01–0.01) |          0.01 (0.01–0.01) | 1.01× (1.00–1.01) |          7.69× |

- **16 of 20 untyped transport operations are now below 1.0× Node** (0.04×–0.93×), including `wait-notify` (1.16× → **0.93×**), `clone-records-16` (2.58× → **0.90×**), and `counter-1` (36.27× → **0.50×**, a 72× speedup).
- **`counter-4`** dropped from 7.69× to **1.01×** (IQR 1.00–1.01×), at parity with Node.
- **Large structured clones** dropped 3.7×–4.4× across the board: `clone-records-1024` 4.19× → **1.15×**, `clone-tree-4` 4.17× → **1.08×**, and `clone-tree-10` 5.51× → **1.26×**. Remaining gap above 1.0× Node is bounded by untyped JS construction/fingerprinting (`fingerprint(tree(10))` and `makeRecords(1024)`) and boxed `ElementCell` storage in the general runtime.

## Kernel placements (`placements`)

15 rounds, load median 2.46 (IQR 2.09–3.76).
[Raw rounds](worker-runtime-post-merge-v1-placements.json)

| Kernel     |     tint-plain (ms) |      tint-main (ms) |    tint-worker (ms) |      main / plain |    worker / plain |      plain / Node |
| ---------- | ------------------: | ------------------: | ------------------: | ----------------: | ----------------: | ----------------: |
| allocation | 13.44 (13.39–13.49) | 13.06 (13.02–13.14) | 13.06 (13.04–13.10) | 0.97× (0.97–0.98) | 0.97× (0.97–0.98) | 3.02× (2.94–3.05) |
| numeric    | 45.13 (44.84–45.59) | 43.17 (42.77–44.34) | 45.04 (44.68–45.84) | 0.96× (0.94–0.98) | 0.99× (0.99–1.00) | 4.54× (4.50–4.62) |
| calls      | 38.39 (38.34–38.51) | 38.41 (38.39–38.44) | 38.48 (38.41–38.52) | 1.00× (1.00–1.00) | 1.00× (1.00–1.00) | 2.06× (2.05–2.08) |
| strings    | 11.02 (10.93–11.09) | 11.21 (11.18–11.23) | 11.31 (11.23–11.34) | 1.02× (1.00–1.03) | 1.02× (1.01–1.03) | 0.92× (0.91–0.93) |
| compiler   |    6.96 (6.93–7.03) |    7.47 (7.42–7.51) |    7.67 (7.63–7.74) | 1.06× (1.05–1.08) | 1.10× (1.09–1.11) | 0.75× (0.73–0.77) |

## Validation

- **Static checks:** `pnpm build`, `tsc --noEmit -p tsconfig.tests.json`, `tsc --noEmit -p tsconfig.host.json`, `pnpm boundaries`, `pnpm format:check`, `node tools/selfhost-coverage.ts` (`846/846`), and `node tools/generate-compiler-catalog.ts` diff check all pass.
- **Unit tests:**
  - Package unit tests: **5,761 / 5,761** passed (0 failures).
  - Concurrent tool tests: **592 / 592** passed (1 skipped; `tools/test262-module-graph.test.ts` requires a local `.tint-bootstrap/test262` checkout).
  - Memory tool tests (including `script-runtime-surface`, `test262-dynamic-import-host`, `test262-module-host`, `test262-script-service`, `test262-top-level-await`, `test262-units`, `managed-*`, `selfhost-linked`, `fixture-cache`, `date-time-native-service`, `typescript-conformance`): **100% passed** (0 failures).
- **Native Worker & memory-release fixtures under LLDB (18/18 pass, stop-at-entry + exit 42):** `memory-release`, `worker-backing`, `worker-clone`, `worker-compiler`, `worker-exit`, `worker-memory-model`, `worker-messages`, `worker-port-recycling`, `worker-ports`, `worker-safepoint`, `worker-shared-strings-parallel`, `worker-shared-strings-serial`, `worker-shared-strings-stress`, `worker-threads-suite`, `worker-transfer-stress`, `worker-typed-entry`, `worker-typed-shared`, `worker-zlib-stress`.
- **Targeted native `node --test` suites under LLDB (19/19 pass, 1 Linux-only skip, 0 failures):** `native-atomics`, `native-general-elements`, `native-general-intrinsics`, `native-general-property-caches`, `native-host-facts`, `native-one-byte-strings`, `native-realm-array-projection`, `native-sliced-strings`, `native-string-transfer`, `native-typed-array-buffer`, `native-typed-atomics`, `native-typed-shared-buffer`.
- **Self-build & cross-target images:**
  - **Darwin arm64 fixpoint under LLDB:** Stage 1 (`60,682,122` bytes) → Stage 2 stopped at entry, exited 0, and matched bit-for-bit (`sha256 02784fa5d92dbbcc4d204cb65adec8c21fb13c40890356b105c2a1dabea8d591`).
  - **Linux arm64 (`linux-aarch64`) Stage 1:** built cleanly (`60,345,720` bytes, `sha256 3301149614fe2460b9603ab9bf207fbd9053ea7ef982a2cd5fecb3548bbe5a86`).
  - **Linux x86-64 (`linux-x86_64`) Stage 1:** built cleanly (`260,917,744` bytes, `sha256 38f99af80c7b99e3c9eea39daf796f2585d7b9fc02dd144c78fa9b6e262db209`).
