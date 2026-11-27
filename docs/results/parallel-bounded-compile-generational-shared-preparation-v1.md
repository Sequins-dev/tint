# Typed shared preparation on the generational Worker runtime

November 27, 2026. These probes used PR #4 at `2912951cf` and the
generational Worker implementation from main. They followed the
[runtime audit](parallel-bounded-compile-recheck-v2.md) and tested the
prepared-input path in smaller pieces.

- A typed shared-buffer fixture copied ordinary bytes into a
  `SharedArrayBuffer` and validated both subarray windows. It exited 42
  natively on macOS arm64.
- A typed preparation fixture decoded a 120-byte header and 91-byte
  body window from the same shared buffer. It opened the preparation,
  read all three function bodies lazily and released each body. It
  exited 42.
- A persistent Worker fixture published the shared buffer to two
  generational Workers. Each opened the preparation once, served two
  requests carrying only function IDs, and returned the expected names.
  The coordinator observed both successful Worker exits, and LLDB
  observed inferior exit 42.

The full tiny emission fixture stopped at an `EXC_BREAKPOINT` in the
main thread before completing. This is separate from the passing shared
preparation and body reads. A diagnostic rebuild containing the emitter
was stopped after 14m43s of active preparation to free the host for the
new native optimizer measurements.

The 7,846-function outlined workload was also captured as 33
cost-ordered ranges, with 2,668,846 bytes of preparation and 45,430,413
bytes of bodies. Node produced all 33 reference packets and the capture
reproduced the reference signed compiler image. The first typed native
fixture drafts hit a closure-narrowing check and a duplicate clock
binding. The first explicit Worker-entry builds exhausted the default
V8 old space. With a 12 GiB host heap, both cross-builds stayed CPU-active
and produced no replay executable before they were stopped. Splitting
the coordinator, Worker entry and shared engine into three modules also
kept the Node builds CPU-active for 15m38s before termination. Those
cells give preparation evidence. Native end-to-end time, aggregate RSS
and final fragment placement remain open for this replay.

The raw logs and generated fixture sources are under
`.tint-bootstrap/outline-v2.CaPaRsha`, including
`actor-preparation-worker.log`, `generational-actor-smoke.log`,
`stage-node-reference.log` and `replay-r6-preparation-stop.txt`.
