# Function-local array-access plans

The experiment captured 7,667 bodies after loop-invariant code motion
in the frozen 821-file self-compile. Capture SHA-256 was
`b726ed11d1c14c211dde70eee7be6c5e7eb2a33cdd6651c10824be81f61ab1cd`.
Array-access selection visited 151,212,975 work units and performed
93 rewrites. Its two largest jobs accounted for 71.1 million work units.
The Node phase profile measured 2.27 s in narrowing, 1.93 s in the
initial fixed point, 0.90 s in liveness and 0.65 s in dependency selection.

The worker produces proven instruction positions, integer-slot facts
and work counts. The coordinator applies that plan to the original
body. This preserves operand, span and instruction order, and allocates
new value IDs in the existing order. All 7,667 Node plans reproduced
the old IR, diagnostics and work totals, including the sampled bounded
runs. The plans identified 80 rewritten blocks and integer facts in
2,328 functions. The two largest jobs each used about 1.13 MB of packed
input and returned 1,572 bytes.

The first native fixture builds exposed a missing fixture entry, an
unsupported Set initializer and an unsupported cast of a string to a
host operation. The working probe used the hosted entry convention,
a typed instruction mask, and projected host descriptors. The planner
reads the operator spellings. It does not read host or foreign
descriptors. In a two-worker native replay, 128 and 160 MiB per
isolate failed to complete both jobs. At 192 MiB, both result records
matched by `cmp` in 3.21 s wall, 6.37 s CPU and 412,032 KiB peak RSS.

## Live native rotation

The compiler passed two selected bodies to the worker sidecar when
it entered the optimizer pass. The emitter and all other passes were
serial. Each run reproduced the frozen 49,771,592-byte ELF, SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.
The live build first rejected a property from a separate storage
prototype and an optional observer property read. The corrected
native compiler built, and the same executable ran both paths.

| Order | Workers | Wall (s) | CPU (s) | Peak combined RSS (KiB) | Selection (s) |
| ----: | ------: | -------: | ------: | ----------------------: | ------------: |
|     1 |       2 |  172.044 | 197.142 |               2,172,880 |         7.880 |
|     2 |  Inline |  171.277 | 196.161 |               2,148,900 |         7.982 |
|     3 |  Inline |  178.052 | 203.123 |               2,149,292 |         8.260 |
|     4 |       2 |  190.737 | 222.848 |               2,174,184 |         9.376 |

CPU and RSS include the compiler, broker and sidecar. Hardware cycle
counters were unavailable in the Linux VM. Preparing inputs took
55–62 ms. The coordinator waited 2.37–2.94 s for the first result.
The second result was available when the coordinator reached it.
The two-worker variant used more wall time and CPU in both pairs.
Aggregate peak RSS rose by 23–24 MiB. The long initial wait is the
next scheduling constraint to isolate.

Raw logs are `select-array-access-profile.log`,
`bounds-plan-equality-r2.log`, `bounds-plan-jobs.log`,
`bounds-plan-worker-resource-screen.log`,
`bounds-live-compiler-build-r{1,2}.log` and
`bounds-live-{pool2,control}-{a,b}/`.
