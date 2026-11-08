G completion: every one of the 21,619 pinned variants in the 37 assigned built-in families has a passing observation in valid complete native evidence. There are no remaining failures, unsupported variants, crashes, timeouts, harness errors or unmeasured variants.

Branch: `test/builtins-native-coverage`. Final evidence SHA range is recorded in `~/.t3/tint-briefs/ready-G.txt` after rebasing and committing this report. All implementation changes are already on main.

This is deduplicated evidence across separate immutable complete native reports and frozen toolchains, not a new uniform-toolchain 21,619-variant execution or a full-suite percentage. Date’s 543-gap recheck explicitly uses UTC; the 645 previous passes and historical Manila failures remain separate. Array’s earlier broad survey remains interrupted, with its complete child/file extracts preserved. The final gap runs repeat only unresolved keys.

[Full evidence audit](cluster-g-final-scope-audit-v1.json) validates pinned source/harness/metadata identities and outcome judgements, reproduces every original ledger-v18 G-family total, and identifies all 296 complete candidate inputs by hash and provenance. [Reproduction script](g-final-evidence-audit-v1.mjs) uses the existing ledger implementation and public committed inputs. Its [independently repeated output](g-final-audit-reproduction-v1.json) matches the final audit, apart from generation time.

| Selection | Pass / total | Fail | Unsupported | Crash / timeout / harness error |
| --- | ---: | ---: | ---: | ---: |
| `built-ins/AggregateError` | 50 / 50 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Array` | 6,119 / 6,119 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/ArrayIteratorPrototype` | 46 / 46 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/BigInt` | 154 / 154 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Boolean` | 101 / 101 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Date` | 1,188 / 1,188 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Error` | 186 / 186 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/FinalizationRegistry` | 94 / 94 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Infinity` | 10 / 10 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/JSON` | 332 / 332 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Map` | 405 / 405 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/MapIteratorPrototype` | 22 / 22 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Math` | 654 / 654 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/NaN` | 10 / 10 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/NativeErrors` | 188 / 188 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Number` | 680 / 680 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Object` | 6,802 / 6,802 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Promise` | 1,458 / 1,458 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Proxy` | 607 / 607 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Reflect` | 306 / 306 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Set` | 764 / 764 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/SetIteratorPrototype` | 22 / 22 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/Symbol` | 192 / 192 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/ThrowTypeError` | 28 / 28 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/WeakMap` | 281 / 281 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/WeakRef` | 58 / 58 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/WeakSet` | 170 / 170 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/decodeURI` | 110 / 110 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/decodeURIComponent` | 112 / 112 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/encodeURI` | 62 / 62 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/encodeURIComponent` | 62 / 62 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/global` | 56 / 56 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/isFinite` | 30 / 30 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/isNaN` | 30 / 30 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/parseFloat` | 108 / 108 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/parseInt` | 110 / 110 | 0 | 0 | 0 / 0 / 0 |
| `built-ins/undefined` | 12 / 12 | 0 | 0 | 0 / 0 / 0 |

The root-family rows above are deduplicated totals; the following are the actual final complete executions:

| Native selection | Pass / requested | Non-passes | Report |
| --- | ---: | ---: | --- |
| Remaining Array gap set | 63 / 63 | 0 | [Canonical report](test262-array-ledger18-gaps-native-v1.json), [completion audit](g-array-ledger18-gaps-completion-audit-v1.json) |
| Remaining G stragglers | 16 / 16 | 0 | [Canonical report](test262-g-stragglers-native-v1.json), [completion audit](g-stragglers-completion-audit-v1.json) |

The Array run resolves 58 unsupported cases and five debugger crashes, following 20 earlier resolved Array gaps. The straggler run resolves eight debugger crashes, two Boolean unsupported cases, two BigInt failures and four URI timeouts. Original outcomes remain in their original reports and [the straggler baseline](g-stragglers-ledger18-original-outcomes-v1.json). No native failure was retried away.

All four million-scalar URI variants pass under the unchanged 300,000 ms containment budget. Sloppy decodeURI emitted one advisory STALL at 164,147 ms; the passive observer immediately sampled the CPU-active inferior. [Raw heartbeat, observer, CPU and sample evidence](g-stragglers-progress-evidence-v1.json) retains that observation. This is conformance evidence, not a comparative runtime benchmark.

Validation:

- Both final native runners: exit 0, exactly one terminal `complete`, all requested variants observed exactly once, canonical/journal/compilation records equal.
- Both completion audits: exit 0; pinned source/harness/fixture and absent-sibling identities, outcome judgements and frozen toolchain files verified.
- Final scope audit and independent public-script reproduction: exit 0; 21,619 pass, zero remaining; all 37 family denominators verified.
- Fresh `pnpm build` for the final straggler toolchain: exit 0. Source snapshot `965201d6a712009f7ab7d9662f625a9372ebf90951fcca2036dd7e9134b45031` (603 files), frozen-run identity `e3fc30141f0b697b080d308d7c99ecfd19c102084fbd1195bc99f64c29f8fd92`.
- Docs-only final slice reuses the covering main gate: `8be365f21f4a8b4d0677d21f2c584f0b7dcb1825`; 8be365f2: 4950/4950 (C2 Stage 3 decorators; gate at c9299ad9 on code-identical base). No new compiler/runtime code changed in this final evidence slice.
- The earlier implemented [Error stack feature acceptance](error-stack-native-compiler-acceptance-v1.json) retains semantic tests, seven native fixtures, 186/186 Test262 passes, passing workspace gates and a byte-identical frozen native self-build. The [Promise keyed acceptance](promise-keyed-native-compiler-acceptance-v1.json) similarly retains its semantic/native/self-build evidence.

Remaining blockers: none in G’s assigned scope. [Final process check](cluster-g-final-process-check-v1.json): zero live G native runners, inferiors, observers or build jobs. No held G work needs resumption. Other clusters retain ownership of their scopes.
