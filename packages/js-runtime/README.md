# JavaScript runtime

ECMAScript objects, environments and protocols, implemented in portable TypeScript.
The framework depends only on foundation algorithms. It does not parse source,
generate machine code, acquire host capabilities or construct an execution engine.

| Public entry                            | Responsibility                                      |
| --------------------------------------- | --------------------------------------------------- |
| `@tint/js-runtime/objects`              | Objects, realms, intrinsics and language operations |
| `@tint/js-runtime/descriptors`          | Property descriptor contracts                       |
| `@tint/js-runtime/environments/records` | Declarative and object environment records          |
| `@tint/js-runtime/environments/global`  | Global environments and reference resolution        |
| `@tint/js-runtime/iterators`            | Iterator and generator protocols                    |
| `@tint/js-runtime/jobs`                 | Job queue primitives                                |
| `@tint/js-runtime/promises`             | Promise state and reaction protocol                 |
| `@tint/js-runtime/disposal`             | Resource disposal protocol                          |
| `@tint/js-runtime/bytes`                | Ordinary byte storage                               |
| `@tint/js-runtime/bytes/shared`         | Shared byte storage contracts                       |

Byte storage and protocol entrypoints remain independently reachable; importing
them does not load the object model. Host services are injected through explicit
contracts. `@tint/js-engine` composes the runtime with compilation and publication.

Unicode/CLDR licenses and data manifests are retained at the package root.
Generated source hashes reflect the relocated license notices; pinned upstream
inputs and the unchanged conformance corpora remain recorded in those manifests.
