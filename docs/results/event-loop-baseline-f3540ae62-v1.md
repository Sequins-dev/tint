# Event loop baseline on f3540ae62

Measured on Apple M5 Max, Darwin arm64, macOS 26.6.2 (25G83). Tint source
base was `f3540ae628bcee2d68fe2d3c86e60f6270aa83eb` and the build host was
Node 24.12.0. The run used `TZ=UTC`.

## AOT context startup, RSS and message round trip

[The hosted fixture](../../tools/build-event-loop-baseline.ts) starts 32
threads from one AOT image. Each thread starts its own hosted context,
copying collector and managed stack, attaches to two native mailboxes and
publishes readiness. Mailbox creation precedes the startup clock and the
initial RSS sample. The RSS delta includes the 32 live threads and their
hosted contexts. Dividing by 32 gives 293.5 KiB per context in this fixture.

RTT is the mean of 4,096 sequential 16-code-unit string echoes after 128 warmup
echoes. Both sides copy through the existing native mailbox and use a sequence
word plus a kernel wake. Timing includes message validation and native
payload mapping and release. This fixture measures the typed hosted context
and mailbox primitives before a product Worker module or JS realm is loaded.

| Run | Startup median (µs) | Startup range (µs) | Mean RTT (µs) | RSS before (KiB) | RSS with workers (KiB) |
| --- | ------------------: | -----------------: | ------------: | ---------------: | ---------------------: |
| 1   |              113.85 |       93.50–225.13 |         14.09 |            6,096 |                 15,488 |
| 2   |              110.08 |       66.21–202.63 |         14.43 |            6,096 |                 15,488 |
| 3   |              120.96 |       63.54–301.00 |         14.75 |            6,096 |                 15,488 |

All three runs stopped at entry under LLDB and exited with fixture status 42.
The image build used threaded startup, a 4 MiB managed reservation, 65,536
allocation entries and `TINT_GENERAL_FALLBACK=0`. The measurement driver
samples the inferior's RSS with `ps` while the main thread is parked.

```sh
TZ=UTC TINT_BUILD_ONLY=1 node tools/build-event-loop-baseline.ts
TZ=UTC /usr/bin/lockf -k "$HOME/.t3/tint-gate.lock" \
  node tools/measure-event-loop-baseline.ts "$image"
```

Build manifest identities:

- Workspace snapshot (796 files): `bece2c66fb89bd9359b77f927f52cdab3f633449b7bc7987e3e1af78f015c261`
- Fixture source: `8940c7ce4fb721d0355b751779b6e82b065ea9d3c6fd4bc11d882d3c009dce2a`
- AOT image: `1af3cd7fedced95a98f86e14d109611b2c451ac9b1bb8ab5531eb7155d70774f`

## Frozen v7 workload

The validated build ran from the main checkout with
`TZ=UTC node tools/frozen-workload.ts build v7 event-loop-base-f3540ae62 --runtime-tree --tree packages/abi/src/host.ts`.
The additional ABI overlay supplies `nativeAllocatorShutdownRequest` for the
current collector. The initial build with `--runtime-tree` alone exited 1 at
runtime link with `missing export: nativeAllocatorShutdownRequest`. Both
overlays affect the benchmark compiler build. The compiler reads the original
760-file v7 source tree as workload input, SHA-256
`29dbd40a46fb3783396de87745a2408e873a541672446c58dba9547f6df66cc9`
over the path-sorted `shasum -a 256` listing from inside that tree.
The benchmark image is 75,832,290 bytes, SHA-256
`965b9d6cbe2cded499dc5fe1a268e0c7af787a43e62ef722d24ea97004965619`.

Runs held `tint-timing.lock`. LLDB stopped the inferior at entry and at
Darwin's `exit`. Wall time is the elapsed monotonic time between those stops.
Cycles, retired instructions and lifetime maximum physical footprint were
sampled from the inferior with `proc_pid_rusage` and `RUSAGE_INFO_V4` just
before continuing to exit. On this SDK these are 64-bit words 32, 31 and 30
of the buffer. The instrumented commands assert the entry stop, exit
breakpoint and actual inferior exit status.

| Run | Wall (s) |          Cycles | Retired instructions | Peak physical footprint (bytes) |
| --- | -------: | --------------: | -------------------: | ------------------------------: |
| 1   |    64.28 | 311,144,356,288 |    1,620,925,120,938 |                   2,205,616,216 |
| 2   |    65.65 | 317,021,376,524 |    1,620,883,091,819 |                   2,205,059,136 |
| 3   |    65.07 | 314,086,723,565 |    1,620,794,590,513 |                   2,205,911,128 |

All three validated inferiors exited 0 and both `cmp` calls exited 0. Each
produced image SHA-256
`68c11052966f4a851b875c23b6a3413abc74262cec1460532dba09c624d17846`.
An earlier run reached the exit breakpoint and wrote the image, but the
debugger crashed before the exit assertion. Its measurement buffer held 36
64-bit words and the SDK struct requires 37. The validated runs allocated 64
words. The abandoned run is excluded from the table.
