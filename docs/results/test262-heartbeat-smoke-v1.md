# Native Test262 heartbeat smoke v1

UTC run: 2026-11-06T16:03:34.827000+00:00 to 2026-11-06T16:16:42.671000+00:00.
Host: macOS arm64, Node v24.12.0. Host was heavily saturated during this run.
The unmodified pinned checkout was used at revision 91c70759363c46557b694792bf34a2551a7af5ba.
This is a two-variant runner smoke test, not whole-suite conformance evidence.

Command (exit 0):

```sh
TINT_TEST262_HEARTBEAT_MS=1000 TINT_TEST262_STALL_MS=10000 \
node tools/test262-native-run.ts \
  /Users/stephenbelanger/Code/nodejs/tint/.tint-bootstrap/test262 \
  language/comments/S7.4_A1_T1.js 8 > native.json 2> native.stderr
```

The normal debugserver-connected LLDB adapter passed both sloppy and strict
variants. The adapter requires an initial stopped state and an expected final
exit state; shell success alone is not its verdict. Compilation took
754078.599 ms. No retry was performed.
All 795 heartbeat/transition lines went to stderr; the largest measured gap
was 1.046 seconds. STALL was intentionally exercised with a ten-second advisory
threshold; compilation continued without changing the execution timeout.

[Original stdout report](test262-heartbeat-smoke-v1.json), SHA-256
`cb388ea8d3e84c37815618d6f915eb3a421c0d15c82839bd1bab2a8ba09127db`, retains the captured compiler source
identity. The runner was not frozen; this run began before the implementation
commits. During the run, progress bookkeeping was refined from rescanning prior
observations to incremental counters; the observer and phase hooks were unchanged.
The final implementation passed all workspace checks.

JSON inspection (exit 0) parsed stdout as one JSON document, asserted the existing
schema-1 top-level and observation field sets, and checked two completed/pass
outcomes. No heartbeat settings or events appear in the JSON. The report
construction and journal schema/resume checks were not changed.

## Stderr excerpt

The following lines are verbatim; intervening heartbeat lines are omitted.

```text
2026-11-06T16:03:34.827Z [Test262] selection="language/comments/S7.4_A1_T1.js" phase="initializing" elapsed=1ms done=0/0 pass=0 fail=0 unsupported=0 infra=0
2026-11-06T16:03:59.381Z [Test262] selection="language/comments/S7.4_A1_T1.js" phase="compiling batch 0 (2 variants)" elapsed=0ms done=0/2 pass=0 fail=0 unsupported=0 infra=0
2026-11-06T16:03:59.908Z [Test262] selection="language/comments/S7.4_A1_T1.js" phase="compiling batch 0 (2 variants)" elapsed=527ms done=0/2 pass=0 fail=0 unsupported=0 infra=0
2026-11-06T16:04:09.926Z [Test262 STALL] selection="language/comments/S7.4_A1_T1.js" phase="compiling batch 0 (2 variants)" elapsed=10545ms done=0/2 pass=0 fail=0 unsupported=0 infra=0 waiting runner=9737 child/inferior=none
2026-11-06T16:16:33.106Z [Test262 STALL] selection="language/comments/S7.4_A1_T1.js" phase="compiling batch 0 (2 variants)" elapsed=753725ms done=0/2 pass=0 fail=0 unsupported=0 infra=0 waiting runner=9737 child/inferior=none
2026-11-06T16:16:33.478Z [Test262] selection="language/comments/S7.4_A1_T1.js" phase="staging batch 0" elapsed=0ms done=0/2 pass=0 fail=0 unsupported=0 infra=0
2026-11-06T16:16:33.511Z [Test262] selection="language/comments/S7.4_A1_T1.js" phase="executing language/comments/S7.4_A1_T1.js [sloppy; flags=] (launching debugger / awaiting LLDB)" elapsed=0ms done=0/2 pass=0 fail=0 unsupported=0 infra=0
2026-11-06T16:16:37.553Z [Test262] selection="language/comments/S7.4_A1_T1.js" phase="executing language/comments/S7.4_A1_T1.js [strict; flags=] (launching debugger / awaiting LLDB)" elapsed=0ms done=1/2 pass=1 fail=0 unsupported=0 infra=0
2026-11-06T16:16:42.671Z [Test262] selection="language/comments/S7.4_A1_T1.js" phase="writing report" elapsed=0ms done=2/2 pass=2 fail=0 unsupported=0 infra=0
```

## Validation

- `pnpm install`: exit 0.
- `pnpm build`: exit 0.
- `node --test tools/test262-native-heartbeat.test.ts`: exit 0, four tests
  (including a worker continuing during synchronous child waits and closing on errors).
  The initial missing-helper and worker argument-inheritance failures were fixed
  before this successful run.
- `pnpm typecheck`: exit 0.
- First `pnpm check`: exit 1; 4481 passed, one existing module-graph fixture
  test could not find the worktree-local `.tint-bootstrap/test262`.
- Added an ignored symlink to the supplied pinned checkout without modifying it;
  `node --test tools/test262-module-graph.test.ts`: exit 0, ten tests.
- Second `pnpm check`: exit 0; all 4482 tests passed, as did type checking,
  dependency boundaries and formatting.
- Native command and JSON/heartbeat inspection above: exit 0.

These checks finished before the coordinator requested machine-wide slots.
Future workspace checks use `~/.t3/tint-slots/tint-check`; future focused tests
use `node --test --test-concurrency=2 <files>`.

Default deployment settings for other agents:

```sh
TINT_TEST262_HEARTBEAT_MS=30000 TINT_TEST262_STALL_MS=150000
```

The five-interval default provides several visible progress observations before
an advisory stall warning and leaves compiler/execution outcomes and budgets alone.
Set `TINT_TEST262_HEARTBEAT_MS=0` to disable observer output.
