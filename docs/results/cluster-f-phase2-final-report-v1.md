# Cluster F Phase 2 final evidence

All **9,324 pinned F variants** have native observations. **9,312 variant keys have passing evidence** across independent frozen reports; **12 remain unresolved timeouts**, each with a concrete blocker. This is a variant-key audit, not a combined execution report or a whole-suite percentage.

| Selection | Native passing keys / pinned variants | Unresolved timeout keys | Evidence |
| --- | ---: | ---: | --- |
| `language/statements/for-of` | 1442/1442 | 0 | [Report](test262-cluster-f-for-of-statements-v1.json) |
| `language/statements/for-await-of` | 2431/2431 | 0 | [Report](cluster-f-for-await-passing-variant-coverage-audit-v1.json) |
| `language/statements/for-in` | 206/206 | 0 | [Report](test262-cluster-f-remaining-small-language-v1-language-statements-for-in.json) |
| `language/statements/generators` | 510/510 | 0 | [Report](test262-cluster-f-generator-statements-v1.json) |
| `language/statements/async-generator` | 590/590 | 0 | [Report](test262-async-generator-statements-current-native-v1.json) |
| `language/statements/async-function` | 133/133 | 0 | [Report](test262-cluster-f-remaining-small-language-v1-language-statements-async-function.json) |
| `language/expressions/yield` | 123/123 | 0 | [Report](test262-cluster-f-yield-expressions-v1.json) |
| `language/expressions/await` | 44/44 | 0 | [Report](test262-cluster-f-remaining-small-language-v1-language-expressions-await.json) |
| `language/expressions/generators` | 546/546 | 0 | [Report](test262-cluster-f-generator-expressions-v1.json) |
| `language/expressions/async-arrow-function` | 108/110 | 2 | [Report](test262-cluster-f-remaining-small-language-v1-language-expressions-async-arrow-function.json) |
| `language/expressions/async-function` | 161/161 | 0 | [Report](test262-cluster-f-remaining-small-language-v1-language-expressions-async-function.json) |
| `language/expressions/async-generator` | 1212/1212 | 0 | [Report](test262-cluster-f-async-generator-expressions-v1.json) |
| `built-ins/Iterator` | 1364/1368 | 4 | [Report](test262-iterator-family-current-native-v1.json); [four separate rechecks](cluster-f-iterator-focused-rechecks-v4.json) |
| `built-ins/GeneratorPrototype` | 122/122 | 0 | [Report](test262-cluster-f-remaining-generator-async-builtins-v1-built-ins-GeneratorPrototype.json) |
| `built-ins/GeneratorFunction` | 44/46 | 2 | [Report](test262-cluster-f-remaining-generator-async-builtins-v1-built-ins-GeneratorFunction.json) |
| `built-ins/AsyncGeneratorPrototype` | 96/96 | 0 | [Report](test262-cluster-f-remaining-generator-async-builtins-v1-built-ins-AsyncGeneratorPrototype.json) |
| `built-ins/AsyncGeneratorFunction` | 44/46 | 2 | [Report](test262-cluster-f-remaining-generator-async-builtins-v1-built-ins-AsyncGeneratorFunction.json) |
| `built-ins/AsyncFunction` | 34/36 | 2 | [Report](test262-cluster-f-remaining-generator-async-builtins-v1-built-ins-AsyncFunction.json) |
| `built-ins/AsyncIteratorPrototype` | 26/26 | 0 | [Report](test262-cluster-f-remaining-generator-async-builtins-v1-built-ins-AsyncIteratorPrototype.json) |
| `built-ins/AsyncFromSyncIteratorPrototype` | 76/76 | 0 | [Report](test262-cluster-f-remaining-generator-async-builtins-v1-built-ins-AsyncFromSyncIteratorPrototype.json) |

All unresolved outcomes are timeouts: zero unresolved assertion failures, unsupported variants, harness errors or crashes. The [scope audit](cluster-f-final-scope-audit-v1.json) verifies pinned source, harness, fixture, metadata, variant and outcome identities. It preserves independent snapshots and original report totals.

For-await-of has passing evidence for 2,431/2,431 keys across three frozen snapshots, with 61 historical launch/authorization observations retained. The old 1,805-variant subset wrapper exited 1 after its complete report because its shared zsh launcher was edited in place; native runner exit was not captured separately. [The exception record](cluster-f-for-await-direct-completion-launcher-exit-v1.json) remains unchanged. The fresh 61-variant recheck exited 0.

The 448-variant builtin subset finished with 442 passes and six timeouts; its launcher exited 0; all seven complete family extractions and keyed validations exited 0. All four Iterator rechecks were measured individually on freshly frozen main tools; each launch and input/status validation exited 0. No family report is synthesized by merging these separate runs.

## Remaining blockers

[The blocker index](cluster-f-phase2-final-blockers-v1.json) matches every unresolved key to its exact latest frozen source/run, native result and CPU/sample triage. The shared unchanged intrinsic harness eagerly constructs 87 Function bodies. Repeated Function preparation is a source-based hypothesis; the internal hotspot has not been symbolized. D owns eval/Function and P owns shared native preparation/performance. The next step is to profile the retained exact images with matching source symbols, fix the shared bottleneck, and rerun unchanged affected selections.

| File | Modes | Last sampled native CPU / wall seconds | Triage |
| --- | --- | --- | --- |
| `language/expressions/async-arrow-function/prototype.js` | sloppy | 286.94/296 | [Evidence](cluster-f-intrinsic-enumeration-native-timeouts-v1.json) |
| `language/expressions/async-arrow-function/prototype.js` | strict | 269.11/280 | [Evidence](cluster-f-intrinsic-enumeration-native-timeouts-v1.json) |
| `built-ins/Iterator/zip/result-is-iterator.js` | sloppy | 264.47/284 | [Evidence](cluster-f-iterator-timeout-recheck-1-v1-triage.json) |
| `built-ins/Iterator/zip/result-is-iterator.js` | strict | 260.24/279 | [Evidence](cluster-f-iterator-timeout-recheck-2-v1-triage.json) |
| `built-ins/Iterator/zipKeyed/result-is-iterator.js` | sloppy | 294.10/297 | [Evidence](cluster-f-iterator-timeout-recheck-3-v1-triage.json) |
| `built-ins/Iterator/zipKeyed/result-is-iterator.js` | strict | 268.14/287 | [Evidence](cluster-f-iterator-timeout-recheck-4-v1-triage.json) |
| `built-ins/GeneratorFunction/is-a-constructor.js` | sloppy | 184.17/207 | [Evidence](cluster-f-builtins-intrinsic-timeouts-v2.json) |
| `built-ins/GeneratorFunction/is-a-constructor.js` | strict | 284.96/292 | [Evidence](cluster-f-builtins-intrinsic-timeouts-v2.json) |
| `built-ins/AsyncGeneratorFunction/is-a-constructor.js` | sloppy | 282.11/290 | [Evidence](cluster-f-builtins-intrinsic-timeouts-v2.json) |
| `built-ins/AsyncGeneratorFunction/is-a-constructor.js` | strict | 277.63/282 | [Evidence](cluster-f-builtins-intrinsic-timeouts-v2.json) |
| `built-ins/AsyncFunction/is-a-constructor.js` | sloppy | 276.59/292 | [Evidence](cluster-f-builtins-intrinsic-timeouts-v2.json) |
| `built-ins/AsyncFunction/is-a-constructor.js` | strict | 282.48/295 | [Evidence](cluster-f-builtins-intrinsic-timeouts-v2.json) |

GeneratorFunction sloppy has no sample after 184.17 CPU / 207 wall seconds; its final CPU total is unknown. That gap is preserved. Other CPU values are measured samples, not total execution-time benchmarks. Signed exact images are retained privately in the F worktree; their paths/hashes and compressed profiles are in the triage records.

## Validation and readiness

- Full scope input/outcome/key audit: exit 0, 9,324/9,324 pinned variants. All unresolved-to-triage source/run/key matches: exit 0.
- Every new selection build/freeze completed with exit 0. Current builtin and all four focused Iterator native runners/slot launchers exited 0. Retained for-await wrapper exception is documented above.
- Workspace gates use coordinator exact-code main records for these docs-only slices; publication records and ready-F.txt identify the gate SHA and count. No redundant F check was queued.
- Portable dispose-install cleanup self-hosting evidence is closed in [phase2-ready-v3](cluster-f-phase2-ready-v3.json): frozen native stage images and smoke output match byte-for-byte, smoke exits 42, signature/DWARF checks pass. This is that slice’s frozen self-build evidence, not a claim that all later main commits share its source snapshot.
- The final audit preflight initially stopped with expected ENOENT for pending Iterator reports after validating the language keys; final complete audit passed with exit 0. No native observations were retried away or changed.

Supplemental inherited staging/sm/Iterator remains 348/348 in its own Phase 1 report; it is outside the 20-selection, 9,324-variant F denominator.

The [process audit](cluster-f-phase2-final-process-audit-v1.json) confirms no F native runner, self-build or workspace check remains; all read-only observers have completed.
