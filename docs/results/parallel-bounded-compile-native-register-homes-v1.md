# Native register-home workers and self-compile integration

On November 21, 2026, the Linux arm64 `dev` VM ran the native AArch64
register-home kernel against 5,910 captured frame-planning inputs
from the frozen compiler. The capture SHA-256 is
`c11f580618e8aa265cef77ebded4813704920f7b22f406ba4d7f63f163356b4f`.
Each input includes a function body, its integer-slot and sharing
facts, and the no-safepoint summary for its calls. Hardware cycles
were unavailable in this VM.

The worker fixture used `node:worker_threads` and 31 packed batches.
Every result batch matched the serial result at one, two, and six
workers. The SHA-256 over the batch hashes in filename order was
`1ea91e30d4b4a0d91893dfda7f3b421d981b82cbba03bd18268470ff85a59017`.

| Run order | Workers | Wall (s) | CPU (s) | Peak RSS (KiB) |
| --------: | ------: | -------: | ------: | -------------: |
|         1 |  Serial |   100.51 |   69.31 |      1,596,696 |
|         2 |       2 |    57.85 |   71.02 |      3,188,300 |
|         3 |       6 |    39.78 |   64.10 |      4,672,660 |
|         4 |       1 |    99.33 |   76.39 |      1,602,680 |
|         5 |       1 |   106.69 |   82.66 |      1,602,680 |
|         6 |       6 |    41.93 |   81.59 |      4,578,660 |
|         7 |       2 |    53.34 |   65.89 |      3,188,252 |
|         8 |  Serial |    87.00 |   71.73 |      1,596,696 |

Median kernel wall time fell from 93.76 s serial to 55.60 s with two
workers and 40.86 s with six. The successful fixture allowed 1,536 MiB
of managed memory per isolate. The earlier 512 MiB serial fixture died
after publishing four batches, at 540,312 KiB RSS and 19.13 s wall.

## Live compiler screen

An instrumented native compiler produced the actual register-home
requests while compiling. The sidecar consumed the requests in the
same run. The 31 input batches matched the earlier capture. The
compiler subsequently decoded the worker result table and linked
the complete frozen source image. Both outputs matched the preceding
Linux self-compile by `cmp`, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.

| Full native self-compile | Wall (s) | CPU (s) | Peak sampled RSS (KiB) | AArch64 emission (s) |
| ------------------------ | -------: | ------: | ---------------------: | -------------------: |
| Serial control           |  329.297 |  282.98 |              2,096,536 |              154.931 |
| Two-worker sidecar       |  395.132 |  459.57 |              4,971,804 |              236.957 |

CPU sums the coordinator and sidecar process times. RSS is their
maximum contemporaneous sum sampled every 25 ms. This was a single
control-first screen. Request discovery and packing took 18.925 s
after the first request, worker handoff and wait took 40.539 s, and
result decoding took 0.155 s. The integrated screen lost on wall,
CPU, and peak RSS, so the sidecar remains experimental.

A separate typed worker fixture wrote a completion cell through
Tint's existing native shared-memory host bindings. It woke a parent
parked on that cell and exited 42. That verified the handoff with
one word of data.

Raw logs are `native-register-home-large-{a,b}-*/run.log`,
`register-home-sidecar-{control,pool}-a`, and
`native-compiler-mapped-wait-run.log`.

## Typed streaming compiler fixed point

The separate packed-IR prototype that built the identical Object
image also reproduced its own Linux arm64 image at stages 2 and 3.
Each file was 49,909,480 bytes, with SHA-256
`46aca6d1a18ecd7c28dd1afdae7b00f2135e70a874b8a70a1e125a62feb42989`.
The logs are `typed-store-linux-stage{1,2,3}.log`.

A further Object screen released the prior checker observation before
helper specialization when the module transform used no managed surface
bindings. At 2,176 MiB V8 old space, it exhausted the heap before
packed lowering began. Its last full collection left 2,122.7 MiB
in use. Peak RSS was 3,133,784,064 bytes, with 178.10 s wall, 222.73 s
CPU, and 548.013 billion cycles. The log is
`object-packed-typed-release-observed-2176.log`.
