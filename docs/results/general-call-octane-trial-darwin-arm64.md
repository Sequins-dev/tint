# Untyped Octane programs on Darwin arm64

All four upstream programs passed their own checks in Tint and Node
26.13.1. The paired results put Tint **135× to 855× behind Node** in the
measured trial. The gaps persist across every paired IQR.

| Program      | Warm operations | Timed operations | Node ms/op | Tint ms/op | Paired Δ IQR ms/op | Ratio of medians |
| ------------ | --------------: | ---------------: | ---------: | ---------: | -----------------: | ---------------: |
| Richards     |              48 |               48 |     0.0520 |     31.246 |   30.266 to 32.242 |             600× |
| DeltaBlue    |              32 |               32 |     0.0737 |     62.996 |   61.023 to 64.615 |             855× |
| NavierStokes |              15 |                4 |     1.9535 |    264.341 | 254.872 to 270.854 |             135× |
| RayTrace     |              12 |               12 |     0.5962 |    346.457 | 338.651 to 371.615 |             581× |

The 16 rotated pairs ran on Apple M5 Max. Each fresh process loaded the
same Script-goal sources in a shared realm. The driver resets Octane's RNG,
calls `Setup`, warms the workload, measures calls to `run` with the
monotonic host clock, then calls `TearDown`. A timed operation is one
upstream `run` invocation. In NavierStokes, warmup executes the built-in
frame-15 checksum before timing. All 16 native samples reached entry under
LLDB and exited 42. These are elapsed measurements per operation using
fixed invocation counts, independent of the upstream composite score.

The native measurement uses the fixed-argument-list, packed-array and
four-state property-cache trial image built over `6ee7418e1`. The
four-state cache was subsequently dropped because of isolated kernel
regressions. The native source snapshot is
`383103703ade16c7610ba94630bef18d0072976a2249982d4e4253fefd3114c3`.
The raw report contains both image identities and every paired observation.
[Raw paired timings](general-call-octane-trial-darwin-arm64.json)

The initial longer native smoke completed all four programs at the exact
baseline source snapshot `58b0c6b85848643289da1d4a84be1624a9aed4e650515f92f9110c14fa84f03a`.
It returned 42, which is the native Script host's success code. The wrapper
initially expected 0. That mistake was corrected before the paired run.
The baseline smoke used different iteration counts and has no paired
comparison with the trial.

## Original inputs

The fetch command retains original bytes, including the licence and
copyright notices. It verifies SHA-256 for all inputs and timing runs
perform no network access. Node evaluates the identical texts as separate
classic Scripts. Tint AOT-compiles those Scripts and the separate driver.
[Octane at pinned revision 570ad1ccfe86e3eecba0636c8f932ac08edec517](https://github.com/chromium/octane/tree/570ad1ccfe86e3eecba0636c8f932ac08edec517)

| Input              | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `LICENSE`          | `cf853177951c6de1b17c029b66edf71f8b194cca1722339a7b5def4e8165aaaa` |
| `base.js`          | `216612c2e7096a02b3e52b57e9cf9351bbaf180d60938d5c60b85fd756232733` |
| `richards.js`      | `1246a64a24b931158bf01c24640343259fa74b0226e73bad630bd1f686aa0fa7` |
| `deltablue.js`     | `6c4784e82f3e8f5c18306d289653d08b17b38838f1bac16b38611d7318fa5a36` |
| `navier-stokes.js` | `27926de809451c60b0c49a4185c08f97081310d0db166a30c1d202fb656556a2` |
| `raytrace.js`      | `64b8ff90969966dd69659100e28754976dfc3e9a4f8ee55b9232f974c66ed08c` |

The Octane tree licence and each file's notice are preserved. DeltaBlue
carries its own GPL notice and the NavierStokes source carries Oliver
Hunt's permission notice. Source is fetched into scratch storage and
the repository records only source identities, the timing driver and
results. [Tree licence](https://github.com/chromium/octane/blob/570ad1ccfe86e3eecba0636c8f932ac08edec517/LICENSE),
[DeltaBlue notice](https://github.com/chromium/octane/blob/570ad1ccfe86e3eecba0636c8f932ac08edec517/deltablue.js),
[NavierStokes notice](https://github.com/chromium/octane/blob/570ad1ccfe86e3eecba0636c8f932ac08edec517/navier-stokes.js)

```sh
mkdir "$octane_sources"
node tools/general-call-bench/benchmark.ts fetch-octane "$octane_sources"
node tools/general-call-bench/benchmark.ts prepare-octane "$node26" octane.json "$octane_sources"
export TINT_GATE_LAUNCH_LOCK="$HOME/.t3/tint-gate.lock"
/usr/bin/lockf -k "$HOME/.t3/tint-timing.lock" node tools/general-call-bench/benchmark.ts measure octane.json paired.json 16
```
