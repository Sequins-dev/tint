# Node FFI benchmark on macOS arm64

Tint source at `f40ca39a0c08b4e3e48242496e27d80080f2fdab`, Node v26.13.1 and Apple M5 Max.
The same C library and JavaScript call loops ran on both engines. Each case
warmed up with 1,000 calls and measured 5 rounds of
5,000 calls using each host's monotonic clock. Every round
verified its result checksum. Both Tint images exited 42 after LLDB
confirmed entry.

Node used its default public `node:ffi` path. The Tint literal image passed
literal definitions to `dlopen`. The Tint runtime image passed definitions
from a variable. The benchmark ran alongside builds on the shared Mac.

| Case     | Node ns/call | Tint literal ns/call | Tint runtime ns/call |
| -------- | -----------: | -------------------: | -------------------: |
| arity-0  |           98 |                  881 |                 1404 |
| arity-1  |          260 |                  926 |                 1497 |
| arity-2  |          188 |                 1035 |                 1911 |
| arity-4  |          301 |                 1282 |                 2296 |
| arity-8  |          296 |                 1555 |                 3283 |
| arity-12 |          386 |                 1947 |                 4571 |
| arity-24 |          721 |                 2942 |                 6812 |
| buffer   |          155 |                 6581 |                 2942 |
| callback |          277 |                20881 |                18838 |

Tint's literal signatures improved scalar call time over runtime definitions
in all seven arities. Node had the lowest median in every case. The raw
observations include the samples, output checksums, and image and manifest
hashes. [Benchmark observations](node-ffi-benchmark-darwin-arm64-f40ca39a0-v1.json).

Reproduce with `TZ=UTC node tools/node-ffi-benchmark.ts /path/to/node-v26.13.1 /tmp/new-ffi-report.json 5000`.
