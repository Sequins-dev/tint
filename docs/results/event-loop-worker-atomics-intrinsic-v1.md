# Worker stop inside the Atomics intrinsic

The typed [worker fixture](../../tools/build-worker-exit-fixture.ts) gives a
worker's Script realm the real `SharedArrayBuffer`, `Int32Array` and `Atomics`
intrinsics. A stop requested after the worker reaches an indefinite
`Atomics.wait` releases the ticket through the intrinsic's existing cleanup.
The wait carries an engine abort through the same boundary used by Script
catches. The owner receives status 1 without an error event and can reuse the
one-entry waiter table. The fixture also exercises the raw parked-waiter and
reactor stop paths.

All three LLDB inferiors stopped at entry and exited 42. The fixture used
`TZ=UTC`, `TINT_BUILD_ONLY=1`, `TINT_GENERAL_FALLBACK=0` and a 16 MiB stack.
Build manifests record 807 files with source snapshot
`b52de28355b933fbd7cba6d9c6052e9d6387d1863dbc9af764f43db386d74178`
and fixture source
`9068e97a415ce7b9f754508dac29b941797056804e0a05162e92db4bbf7fc2c5`.

| Host | Image SHA-256 |
| --- | --- |
| macOS arm64 | `befead5e75cc6c2adf0f0baf8d0a49b6de4f4418ce8a84660d2b4c3d2255b6ae` |
| Linux arm64 `dev` VM | `0fef622860cbe532094e3ead84b54a8bdc47b06c32368942eb621d4630dc365b` |
| Linux x86-64 Debian VM | `45030b179f3d77b84301ce6695c2c35be3d78a14a0b3a16a7d397e68b5d64bec` |

The first arm64 fixtures exited 70 with `UNBOUND_OBJECT_VIEW`. The final
fixture binds the ordinary object, symbol and BigInt views used by the
intrinsic and the engine-abort boundary. The first x86-64 run exited 1. The
validated run used the view bindings and increased the fixture stack to 16 MiB.
The Atomics, shared-backing and waiter tests passed 53/53. The focused native
compiler specialization check also passed.
