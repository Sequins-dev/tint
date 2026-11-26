# Early mapped SSA workers and unchanged function identity

The November 22, 2026 Linux arm64 screen used the frozen 821-source
self-compile under `with-lock.sh both`, with `TZ=UTC`. Both runs used
the same instrumented native compiler, SHA-256
`52557c2a75973c789b46ab672b6b83e7058b122a215153b4d0b71f1e0069f3ce`.
The worker executable was
`99b862ce3f7ff93afcf5b5d28946ccae0472bfddc6cb6873e42fc391ca8fadb1`.
The native worker process launched before the coordinator and kept two
isolates alive for the pass. The coordinator published each packed
batch while continuing to encode subsequent batches. Each worker
mapped the published bytes read-only, decoded one body at a time, and
initialized the vocabulary on its first batch.

The worker wrote a zero-length result span for an unchanged function.
The coordinator kept the original function reference for those spans
and applied the changed bodies in function-ID order. The 27 inputs
matched the earlier frozen SSA capture. The pass visited 85,469,637
items and made 135,019 rewrites, exactly matching the control.
Of 5,665 functions, 1,492 came back as rewritten bodies. Their output
and the result directory occupied 56,210,378 bytes. The earlier
full-body protocol published 69,187,232 bytes. The frozen input
occupied 36,242,347 bytes.

Both runs produced the same 49,771,592-byte ELF by `cmp`, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
This recovers image identity after the earlier full-body protocol's
32-byte difference. The protocol change and successful comparison do
not isolate the cause of that earlier difference.

| Configuration | Self-compile wall (s) | Total CPU (s) | Peak sampled RSS (KiB) | SSA wall (s) |
| ------------: | --------------------: | ------------: | ---------------------: | -----------: |
| Serial        |               228.161 |        242.14 |              2,096,116 |        9.168 |
| Two workers   |               219.131 |        238.87 |              2,118,024 |       14.662 |

The compiler and worker CPU sum excludes the broker. Aggregate RSS
sums the two processes every 25 ms and rose by 21.4 MiB. The Linux VM
does not expose hardware cycle counters. These cells used separate
lock acquisitions. The full wall difference includes variation in
work outside SSA. The native worker pass took 1.070 s to pack,
10.938 s in handoff and wait after packing, and 2.653 s to consume
results. Its pass was 5.495 s longer than the serial pass. Worker
process wall time includes waiting at startup and the measured worker
CPU was 20.21 s.

The first fixture build referenced an unresolved primitive module.
After correcting the import, a launch without typed peer selection
ran the fallback peer, which replied before receiving a batch.
The worker host rejected that reply and stopped the compile. The
successful variant explicitly selected the typed worker entry.
The prototype stays experimental on pass time. This screen checks
one worker width at the full image boundary.

Raw logs are `ssa-identity-control/`, `ssa-identity-worker-2/`,
`ssa-identity-worker-2-r1/`, `ssa-identity-worker-build-r0.log`,
and `ssa-identity-worker-build-r1.log`.
