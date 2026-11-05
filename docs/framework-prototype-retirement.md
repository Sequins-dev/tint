# Retired tracing and value-layout prototypes

`trace-plan`, `gc-tracing`, `closure-tracing` and `value-layout` had no production
consumers. Their callers were prototype tests and four test-only composition
fixtures. The production emitter and collector already used a different compact
descriptor contract, so keeping both abstractions obscured the actual runtime.

| Retired concern                                            | Production verification retained                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tagged values trace only reference categories              | Native-runtime scanner tag/offset validation and emitted tagged-record descriptor integration                      |
| Closure environments and captured cells retain exact roots | Production closure-layout tests, codegen function/environment descriptor tests, and emitter-to-scanner integration |
| Reachable cycles survive; failed scans cannot sweep        | Native-runtime collector, heap and nursery failure/relocation suites                                               |
| Target layout bounds and scalar/reference widths           | Foundation layout tests and native record/class lowering tests                                                     |
| Actual word64 code has viable native storage               | `tools/word64-native.test.ts` checks, lowers and emits every word64 function                                       |

The new `tools/production-descriptor-contract.test.ts` reads actual emitted record
and shadow-root descriptor bytes through the production scanner, including visitor
failure and tagged-reference filtering. It replaces parallel prototype integration
with a check on the real producer/consumer boundary.

Thirty tests of the obsolete APIs and their six implementation files are retired.
This intentionally changes the workspace unit-test count; it changes no Test262
population or conformance result. Original files and the caller audit are retained
in the local frozen retirement artifacts. Native validation remains a separate gate.
