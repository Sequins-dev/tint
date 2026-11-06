# Native word parking prerequisite

The explicit Darwin parking policy supplies compare/wait and wake symbols and
operation flags. Trusted native leaves accept only caller-owned aligned raw cells
and scalar arguments; no managed address is valid. Kernel returns remain advisory,
so the future waiter registry must recheck state and deadlines after every return.

The red-first host binding test rejected `word-park`. Focused host/startup tests
then passed 8/8 (exit 0), and `pnpm build` passed (exit 0).
The initial native fixture intentionally returned 2 at its mismatch assertion;
the containment adapter recorded an unexpected-exit outcome. The diagnostic
fixture returned 114, exposing raw EFAULT (-14). Both reports are retained. XNU's
locked atomic copy-in cannot fault an untouched zero mapping in. The corrected
leaf reads the caller-owned word before the kernel call.

The corrected [parking fixture](native-word-parking-v2.json) exits 42 under LLDB,
covering fresh-page mismatch, timed kernel parking, empty wake, sixteen worker
publication/wake races, both wake-one/all flags and monotonic clock access.
The [executable-isolation fixture](native-isolated-thread-lifecycle-v3.json) also
exits 42 with eight live hosted workers, distinct executable mappings, native
publication/invocation, collection stress and joined teardown. Reports retain the
build-time source graph and fixture source hash. Neither establishes Test262
agent conformance.

The slot-wrapped full gates recorded two complete passes with 4,507 tests, types,
boundaries and formatting. The shared wrapper was modified during the original
wait and emitted `command not found: ne` between those passes; this infrastructure
observation remains in `.tint-bootstrap/cluster-k/check-v2.log`. The wrapper's final
exit status was 0. Constituent success is reported separately from that anomaly.
The frozen lifecycle self-build is still running, and the expanded parking source
graph requires its own frozen comparison before this combined host ABI is
merge-ready. No complete new Test262 selection has finished yet.
