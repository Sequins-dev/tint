# Worker structured clone codec

The [native fixture](../../tools/build-worker-clone-fixture.ts) clones a graph
between two realms. It checks a cycle, repeated references, the target realm's
prototype, negative zero and a BigInt beyond the safe integer range. The hosted
macOS arm64 image built with `TZ=UTC TINT_BUILD_ONLY=1 TINT_GENERAL_FALLBACK=0`
stopped at entry under LLDB and exited 42.

| Build manifest field | SHA-256 |
| --- | --- |
| Source snapshot (808 files) | `b1bc5a454ffa0ac0c8a2d29c8709e0126764f86548432d623a28798b8be1299d` |
| Fixture | `5eca6d860daea6dbeaae64b52e41df10f54bc28341762e5296b611efb290250a` |
| Image | `da56591c6568d3b50bf12ddbe9e1028441bfc055b5aee876ea1a42b6f7378182` |

The [codec tests](../../packages/js-runtime/test/structured-clone.test.ts) passed
on Node and also cover lone UTF-16 surrogates, Error causes and backing
identity across cloned typed array views. The
[Worker API suite](../../tools/worker-threads-suite.mjs) passed under Node
26.13.1. The suite's native product host and transfer ownership are separate
from this codec run.
