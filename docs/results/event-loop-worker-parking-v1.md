# Worker stop while parked on a native waiter

The typed [worker fixture](../../tools/build-worker-exit-fixture.ts) starts a
worker blocked on a native Atomics waiter with no deadline. The fixture
publishes readiness at the kernel park call, then the owner requests a stop.
The worker observes the stop outcome, consumes its waiter ticket and exits
with status 1. The owner then registers another wait in the same
single-entry table, verifying release of the previous ticket. This exercises
the worker control and native wait registry. Delivery through the guest
`Atomics.wait` intrinsic and allocation and call safepoints remain open.

The fixture was built with `TINT_GENERAL_FALLBACK=0`, `TINT_BUILD_ONLY=1` and
`TZ=UTC`. Each LLDB launch confirmed the inferior stopped at entry and exited
42. All build manifests record the same source snapshot of 807 files
`c5ffe34d9198f52102e9cf5f70a40939e9681652a82008cf5763339f03a11ef0`
and fixture source
`d127ce07ab9114f1cac9cff542bfff72acf4ea88c71489b53e9e9fc4522954bb`.

| Host | Image SHA-256 |
| --- | --- |
| macOS arm64 | `77f2c294d69d028aea91357e156908193f8898da602ad2ace90d3f8331bf5283` |
| Linux arm64 `dev` VM | `6a1772e7f46338e01ab56c04864ed445afd2e22ebe43957e005c286cab7f60a2` |
| Linux x86-64 Debian VM | `5318855c44d0620d72fd0067fd63cec0d929e6deda1c25ba82a540fdd09a063b` |
