# HOST-ESM M2b: second graph selection, `language/module-code/namespace`

This plan covers the selection after
[ambiguous-export selection](host-esm-ambiguous-export-selection.md) §6. It
covers:

- a Node census with pinned fixture identity;
- a gate-off control;
- a source review of the module namespace exotic object against the current
  ECMA-262 text;
- the native run, with its blocking rules;
- the decision on whether a source fix is needed first (it is not, see §4).

This is research only. No source, test, catalog, manifest, result, dashboard,
marker or snapshot was changed. Nothing was built, and no native binary or
debugger was run. The read-only Node probes ran from `/tmp`:

- `/tmp/m2-ns-census/census.ts` and `batch.ts` import only the **frozen**
  toolchain `.tint-bootstrap/node-toolchain-module-host-v1/tools/*` and its
  `source-snapshot.json`. They read the pinned checkout
  `.tint-bootstrap/test262` (revision `91c70759…5ba`, `dirty: false`) under
  Node v24.12.0. `prepareNativeBatch` emitted module lists only; nothing was
  compiled.
- `/tmp/m2-ns-probe/probe.test.ts` imports the workspace
  `packages/js-runtime/src` portable runtime, to check algorithms that the
  unit suite does not reach (§3.2).

Node 24 was **not** used as an oracle. Expected outcomes come from the spec
(§3.1).

The ambiguous-export N1 run that is in flight
(`.tint-bootstrap/run-ambiguous-export-selection-v1.mjs`), controller 67383,
child 64325, the DirectEval pause files and the frozen conformance line were
neither touched nor inspected.

**Implementation result:** the [census](../results/module-namespace-census-node-v1.json)
and [gate-off control](../results/module-namespace-gate-off-control-v1.json) pass.
The [complete native selection](../results/test262-module-namespace-native-v1.json)
passes 38/38, with no failures, unsupported cases or infrastructure errors.
[Acceptance](../results/test262-module-namespace-acceptance-v1.json) records no
deviations. M2c native fixture early-error proof is next.

## 0. State at planning time (files only, no forecast)

| Item                  | State                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1/G2                 | recorded: `test262-module-host-script-guard-v1.json` (2/2) and `test262-module-eval-this-native-v1.json` (1/1)                                                      |
| Ambiguous P1–P3       | recorded: `module-ambiguous-export-census-node-v1.json` and `module-ambiguous-export-resume-controls-v1.json` (`journalUnchanged`, `nativeExecutions: 0`)           |
| Ambiguous N1          | **running**. There is no `…-ambiguous-export-bindings-acceptance-v1.json`. This plan makes no assumption about its outcome                                          |
| Frozen toolchain      | `frozen-node-toolchain-module-host-v1.json`, snapshot `2c72f4c9…810c`, 562 files                                                                                    |
| Preparation inventory | `module-preparation-inventory-v1.json` (`conformance: false`): all 38 `namespace/` variants are `prepared-not-executed`. That is preparation, **not** a native pass |

Everything from §5 on waits for ambiguous N1 to be **accepted** (§5.1).

## 1. Node census (frozen tools, pinned checkout)

Selection: `language/module-code/namespace`. It has **38 test files**: 2 at the
top level and 36 in `internals/`. All carry `flags: [module]`, so there are
**exactly 38 variants**, all `module`. Every route is `module` with the gate on
and `script` with it off.

- **Negatives.** None. Every variant is positive.
- **Harness.** Identical for every variant: `assert.js 206e274c…`,
  `sta.js 1930c54a…`. No variant has `includes`.
- **Preparation.** 38 `ok`, 0 unsupported, 0 thrown, no `parsed: false` node.
  The slowest preparation took 8 ms.
- **Features.** `Symbol`, `Symbol.iterator`, `Symbol.toStringTag`, `Reflect`,
  `let` and `export-star-as-namespace-from-module`. None of them belongs to a
  proposal, and none needs TLA, dynamic import, attributes or import phases.
  So nothing is excluded, and the denominator is all 38.

In the table, "E" is the number of `prepareNativeModuleProgram` entries.
"Self" means that the only graph node is the root, through a self-import.
`_F` abbreviates `_FIXTURE.js`.

| #   | Test (`sha256` prefix)                                             | E   | Fixtures (`name@sha`)                                                                                                 |
| --- | ------------------------------------------------------------------ | --- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | `Symbol.iterator.js` `03082b2bf4a1`                                | 1   | self                                                                                                                  |
| 2   | `Symbol.toStringTag.js` `6315c6f95c2c`                             | 1   | self                                                                                                                  |
| 3   | `internals/define-own-property.js` `490086320b7c`                  | 1   | self                                                                                                                  |
| 4   | `internals/delete-exported-init.js` `989744c43f64`                 | 1   | self                                                                                                                  |
| 5   | `internals/delete-exported-uninit.js` `ead3d19b68a4`               | 1   | self                                                                                                                  |
| 6   | `internals/delete-non-exported.js` `5549137de62e`                  | 1   | self                                                                                                                  |
| 7   | `internals/enumerate-binding-uninit.js` `e3749a663a14`             | 1   | self                                                                                                                  |
| 8   | `internals/get-nested-namespace-dflt-skip.js` `9a7eac932840`       | 5   | `…dflt-skip-named-end_F@4f1ecf3ed333`, `…-named_F@ce8799937a66`, `…-prod-end_F@b9af329375f3`, `…-prod_F@f4b066890b60` |
| 9   | `internals/get-nested-namespace-props-nrml.js` `74fd6103875b`      | 4   | `…props-nrml-1_F@11c902ba608e`, `-2_F@87b004638b12`, `-3_F@fc4a16120836`                                              |
| 10  | `internals/get-own-property-str-found-init.js` `bba174e662b5`      | 1   | self                                                                                                                  |
| 11  | `internals/get-own-property-str-found-uninit.js` `367055bde6f3`    | 1   | self                                                                                                                  |
| 12  | `internals/get-own-property-str-not-found.js` `722c22fdceee`       | 1   | self                                                                                                                  |
| 13  | `internals/get-own-property-sym.js` `5daefc7f5e48`                 | 1   | self                                                                                                                  |
| 14  | `internals/get-prototype-of.js` `1a49c3befc8b`                     | 1   | self                                                                                                                  |
| 15  | `internals/get-str-found-init.js` `ddd4e6b68b40`                   | 1   | self                                                                                                                  |
| 16  | `internals/get-str-found-uninit.js` `fba153a816cf`                 | 1   | self                                                                                                                  |
| 17  | `internals/get-str-initialize.js` `eb293f29acf9`                   | 1   | self                                                                                                                  |
| 18  | `internals/get-str-not-found.js` `00adb485df5f`                    | 1   | self                                                                                                                  |
| 19  | `internals/get-str-update.js` `4acedca4f7c6`                       | 1   | self                                                                                                                  |
| 20  | `internals/get-sym-found.js` `954376d03885`                        | 1   | self                                                                                                                  |
| 21  | `internals/get-sym-not-found.js` `383f50910a92`                    | 1   | self                                                                                                                  |
| 22  | `internals/has-property-str-found-init.js` `24244c2ffd67`          | 1   | self                                                                                                                  |
| 23  | `internals/has-property-str-found-uninit.js` `27471a2bf678`        | 1   | self                                                                                                                  |
| 24  | `internals/has-property-str-not-found.js` `5ea28c74bfe9`           | 1   | self                                                                                                                  |
| 25  | `internals/has-property-sym-found.js` `6572cf48501d`               | 1   | self                                                                                                                  |
| 26  | `internals/has-property-sym-not-found.js` `277e068c61a8`           | 1   | self                                                                                                                  |
| 27  | `internals/is-extensible.js` `c500c5b92cfd`                        | 1   | self                                                                                                                  |
| 28  | `internals/object-hasOwnProperty-binding-uninit.js` `e80c6a04e4f1` | 1   | self                                                                                                                  |
| 29  | `internals/object-keys-binding-uninit.js` `4d1566016d20`           | 1   | self                                                                                                                  |
| 30  | `internals/object-propertyIsEnumerable-binding-uninit.js` `d7c6…`  | 1   | self                                                                                                                  |
| 31  | `internals/own-property-keys-binding-types.js` `a3819b67e5dc`      | 2   | `own-property-keys-binding-types_F@3b4098e5e9b8` (it imports the root back, a two-node cycle)                         |
| 32  | `internals/own-property-keys-sort.js` `b0eae14038b0`               | 1   | self                                                                                                                  |
| 33  | `internals/prevent-extensions.js` `c0ee6e57a97c`                   | 1   | self                                                                                                                  |
| 34  | `internals/set-prototype-of-null.js` `9c63575fc884`                | 1   | self                                                                                                                  |
| 35  | `internals/set-prototype-of.js` `3de9551554ee`                     | 1   | self                                                                                                                  |
| 36  | `internals/set.js` `4cfe9d8bfa3d`                                  | 1   | self                                                                                                                  |
| 37  | `internals/super-access-to-tdz-binding.js` `b7e148ec17f2`          | 1   | self                                                                                                                  |
| 38  | `internals/super-set-to-tdz-binding-with-accessor.js` `f957cc29…`  | 1   | self                                                                                                                  |

What the census establishes:

- **Graph shapes.**
  - 35 variants are one-node self-import graphs. Preparation gives them
    `fixtures: []` because the root is excluded. The native report omits the
    field (§5.3), and their identity is the root `sha256`.
  - #8 and #9 are acyclic chains with no self-import, so the root is not a
    graph node.
  - #31 is a root↔fixture cycle with `export *`, so the root _is_ a graph node
    and is excluded from `fixtures`.
- **No sibling-test quirk.** Unlike ambiguous #6, no root imports another test.
- **Batch composition (batch size 64).** No variant is unsupported, so nothing
  flushes early. There is **one execution batch** of 38 variants.
  `prepareNativeBatch` emits **88 modules**:
  - 48 shared: 2 harness, 38 roots and 8 fixtures;
  - 38 hosts;
  - the runtime;
  - the selector.

  That is 2.7× ambiguous batch 0 (33 modules). Its compile time and success
  are unknown (U1).

- **Gate off.** All 38 route to `script` and are rejected as
  `native module execution is not implemented`, with no `fixtures`.

## 2. Spec-derived expectation per test (not Node, not a forecast)

Every variant is positive, so the required outcome is `completed` → `pass`.
The table records **which semantics each test exercises**, so that any
deviation maps to a clause. Clause references are to ECMA-262 §10.4.6 (module
namespace exotic objects) and §16.2.1.10 (GetModuleNamespace).

| Group                              | Tests                           | Spec requirement                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prototype and extensibility        | #14, #27, #33–#35               | `[[GetPrototypeOf]]` is null. `[[SetPrototypeOf]]` is SetImmutablePrototype: `null` → true, otherwise false, so `Object.setPrototypeOf` throws TypeError. `[[IsExtensible]]` is false. `[[PreventExtensions]]` is true                       |
| Symbols                            | #1, #2, #13, #20, #21, #25, #26 | Symbol keys use the Ordinary\* algorithms. `@@toStringTag` is `"Module"` `{W:false,E:false,C:false}`. There is no `@@iterator`                                                                                                               |
| Descriptors and TDZ                | #10–#12, #28, #30               | `[[GetOwnProperty]]` calls `? O.[[Get]](P, O)` and so throws ReferenceError for an uninitialized binding. The descriptor is `{W:true,E:true,C:false}`                                                                                        |
| `[[Get]]`                          | #15–#19                         | A live binding read. An uninitialized target throws ReferenceError (GetBindingValue). #19 observes mutation after link; #17 observes `let` and `export default` initialization                                                               |
| `[[HasProperty]]`                  | #22–#24                         | String keys test membership in `[[Exports]]` and **never** read the binding, so there is no TDZ                                                                                                                                              |
| `[[Set]]`                          | #36                             | Always false, for every key, symbols included. Strict assignment throws TypeError                                                                                                                                                            |
| `[[Delete]]`                       | #4–#6                           | An exported name → false, so strict `delete` throws TypeError and there is no TDZ read. A non-exported name → true. `@@toStringTag` → false                                                                                                  |
| `[[DefineOwnProperty]]` and freeze | #3                              | Rejects a configurable, non-enumerable, accessor, non-writable or SameValue-changing request. SetIntegrityLevel(frozen) asks for `writable:false` → TypeError, every time. TestIntegrityLevel(frozen) is false                               |
| `[[OwnPropertyKeys]]` order        | #31, #32                        | `[[Exports]]` sorted by code-unit order (`$ $$ A Z _ __ a aa az default z za zz λ μ π`), then the symbol keys. No `[[Get]]`, so there is no TDZ for #31's uninitialized names. `μ` is an escaped IdentifierName export (`μ`)                 |
| Enumeration under TDZ              | #7, #29                         | for-in and `Object.keys` must obtain attributes through `[[GetOwnProperty]]`, which throws ReferenceError before the body or the result is reached                                                                                           |
| Receiver path                      | #37, #38                        | `super.foo = v` with `this === ns`: OrdinarySetWithOwnDescriptor reaches `Receiver.[[GetOwnProperty]]`, so ReferenceError under TDZ (#37). A setter found on `A.prototype` is called with receiver `ns` and does not touch the binding (#38) |
| Nested namespace and identity      | #8, #9                          | `export * as x from` is an indirect entry with `importName` _all_. `ns.x` is GetModuleNamespace(target), which is a cached, unique object. `export *` omits `default`, but an `export * as` namespace _contains_ `default`                   |

Pinned-test notes, recorded rather than patched:

- **#30 has an ambiguous title.** It is
  `object-propertyIsEnumerable-binding-uninit.js` and uses
  `Object.prototype.propertyIsEnumerable`, which goes through
  `[[GetOwnProperty]]`.
- **#3's freeze loop is order-sensitive in principle.** It is not
  order-sensitive in practice: the first exported key (`indirect`) already
  rejects.

## 3. Source review against the spec

### 3.1 The exotic object: `packages/js-runtime/src/modules/namespace.ts`

| Spec step                                  | Code                                                                                                                                     | Verdict                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `[[Exports]]` = unambiguous names, sorted  | `:43-64`. The skip at `:46` covers `null` and `"ambiguous"`. `compareModuleNames` (`foundation/src/modules.ts:33`) compares `charCodeAt` | matches. Code-unit order, not code-point order                                                                    |
| `[[Get]]` for a namespace binding          | `:69`, `getModuleNamespace(target)`, cached through `module.namespace` (`:39,187`)                                                       | matches. Identity is stable                                                                                       |
| `[[Get]]` TDZ                              | `:72-77`, a ReferenceError in the **active** context's realm                                                                             | matches. Unit test `modules-namespace.test.ts:245`                                                                |
| `[[GetOwnProperty]]`                       | `:81-92`. `read()` runs before the descriptor is built                                                                                   | matches. Throws before any descriptor exists                                                                      |
| `[[DefineOwnProperty]]`                    | `:123-152`, with `current = descriptor(key)` first                                                                                       | matches, including the TDZ throw from `current` (spec step 2 is `? O.[[GetOwnProperty]]`)                         |
| `[[HasProperty]]`, `[[Delete]]`, `[[Set]]` | `:100-104`, `:119-122`, `:118`                                                                                                           | matches. The symbol `[[HasProperty]]` uses the own lookup only, which is equivalent because the prototype is null |
| `[[OwnPropertyKeys]]`                      | `:153-168`: names, then the ordinary symbol keys                                                                                         | matches                                                                                                           |
| Prototype and extensibility                | `:94-99`. `setPrototype` accepts only `undefined` (null)                                                                                 | matches                                                                                                           |
| `@@toStringTag`                            | `:174-186`. Installed before `extensible = false`                                                                                        | matches                                                                                                           |

**One divergence of form that is not observable.** The spec resolves bindings
lazily in `[[Get]]`. Tint resolves them once, when the namespace is
constructed (`:45-56`). That is equivalent only if every binding cell exists
at construction time. It does:

- `createSourceTextModule` (`records.ts:67-68`) runs `declare(environment)`
  eagerly, before any link.
- `initializeEnvironment` (`linking.ts:61-67`) can build a self-namespace
  before `instantiate` without hitting `MODULE_BINDING_INVARIANT`.
- `ResolveExport` results are stable after link.

All 35 self-import variants exercise this path natively for the first time.
Ambiguous #5/#7/#9 cover it too, if N1 is accepted.

### 3.2 Generic algorithms the tests reach (portable runtime)

| Path                                                            | Code                                                                                                           | Probe (`/tmp/m2-ns-probe`, Node, source runtime)                                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Object.freeze` / `isFrozen` / `seal` / `isSealed`              | `object-intrinsics.ts:443-455` → `integrity.ts:17-60`, which dispatches `defineOwnProperty`. False → TypeError | freeze `false`, isFrozen `false`, seal `true`, isSealed `true`. freeze and seal with an uninitialized binding → ReferenceError. All green |
| for-in                                                          | `values.ts:45` → `enumeration.ts:50-75`: `ownKeys`, then `getOwnProperty` per string key                       | a `default` in TDZ → ReferenceError. Green                                                                                                |
| `Object.keys` / `getOwnPropertyNames` / `getOwnPropertySymbols` | `object-intrinsics.ts:313-366`. `getOwnProperty` only when `enumerableOnly`                                    | by inspection: Names and Symbols never read bindings (#31, #32); `keys` does (#29)                                                        |
| `hasOwnProperty` / `propertyIsEnumerable`                       | `object-prototype.ts:154-179` → `ownProperty`                                                                  | by inspection, through `getOwnProperty` dispatch (`operations.ts:401-407`)                                                                |
| Super/receiver set                                              | `operations.ts:641-686`: `setProperty` → `writeReceiverProperty` → `getOwnProperty(receiver)`                  | TDZ → ReferenceError; initialized → `false` (no define). Green                                                                            |

The symbol-order sub-probe failed only because it assumed `typeof` of a
runtime symbol. Runtime symbols are objects in the portable model, so that
failure is a probe artifact, not a finding.

**No gap was found.** The existing unit coverage is
`modules-namespace.test.ts:65-263`. The five green probe cases cover what it
does not reach. Because they are green, they are **not** red-first tests and
are not proposed as pre-run work. Whether they become regression tests is
main's decision, and that can happen after N2.

## 4. Decision: is a preparatory source fix needed? **No.**

| Possible gap                                          | Evidence                                                                 | Verdict |
| ----------------------------------------------------- | ------------------------------------------------------------------------ | ------- |
| Eager binding capture before `instantiate`            | `declare` runs at creation (`records.ts:68`)                             | none    |
| Freeze or seal dispatch bypassing the exotic object   | `integrity.ts` uses `defineOwnProperty`/`getOwnProperty` dispatch; probe | none    |
| Enumeration skipping `[[GetOwnProperty]]`             | `enumeration.ts:66`; probe                                               | none    |
| Receiver `[[GetOwnProperty]]` skipped on ordinary set | `operations.ts:670`; probe                                               | none    |
| Key order by code point instead of code unit          | `compareModuleNames` uses `charCodeAt`; #32 has no astral names          | none    |
| A single 88-module batch                              | compile risk, not a defect. Batch size stays 64 (§5.4)                   | observe |

**Minimal edit list: empty.** There are no source, test, catalog or manifest
edits. The only new files are the census and controller scripts in
`.tint-bootstrap/` and the `wx` results that §5 lists.

### 4.1 Native unknowns (first observed by N2)

1. **U1: batch size.** One batch of 88 modules and 38 hosts. Its compile time
   and success are unknown.
2. **U2: `super.foo = v` lowering.** Does the derived-constructor lowering pass
   `this` as the `[[Set]]` receiver (#37, #38)?
3. **U3: strict failures on exotic objects.** Does a false `[[Set]]` or
   `[[Delete]]` surface as TypeError through the native member-assignment and
   `delete` lowerings (#4–#6, #36)?
4. **U4: for-in.** Does the native for-in lowering call `enumerateObjectValue`
   (#7)?
5. **U5: escaped export names.** Do they reach native module shape decoded
   (#32)? `test262-native-module-name-unicode-v1.json` covers parsing only.
6. **U6: live-binding writes.** Is a module-local write visible through the
   namespace cell (#19)?
7. **U7: `export default <expr>` TDZ.** Is it uninitialized until evaluated
   (#5, #7, #11, #17, #29)?
8. **U8: the harness error constructors.** Is a namespace ReferenceError
   `instanceof` the harness-realm `ReferenceError`? `assert.throws` checks the
   constructor.

## 5. Commands (main executes, strictly serial)

### 5.1 Preconditions (checked once, from files only)

1. Ambiguous N1 has exited. These exist, and the first has
   `result: {code: 0, signal: null}`:
   - `docs/results/test262-module-ambiguous-export-bindings-controller-v1.json`
   - `docs/results/test262-module-ambiguous-export-bindings-native-v1.json`
   - `docs/results/test262-module-ambiguous-export-bindings-acceptance-v1.json`,
     with **`accepted: true`** and `deviations: []`

   **Any other state blocks this plan.** That includes a missing file,
   `accepted: false`, structural assertion failure or a debugger launch
   failure. There is no rerun, no `-v2` of N1 by this plan, and no
   reinterpretation of a deviation.

2. `workspaceSourceIdentity(workspaceSources())` is still `2c72f4c9…810c` with
   562 files. The checkout is at `91c70759…`, clean.
3. Neither `direct-eval-conformance.pause` nor its `.ack` exists. N2 acquires
   the pause itself (§5.3). Nothing signals 67383 or 64325.

The environment is the same as ambiguous N1, passed per process:

```sh
T=.tint-bootstrap/node-toolchain-module-host-v1
ENV="TINT_TEST262_SOURCES=$T/source-snapshot.json TINT_TEST262_DEBUGGER_LAUNCH=debugserver-direct TINT_TEST262_DEBUGGER_TRACE=1 TINT_TEST262_CONTAINMENT_MS=300000"
# never set: TINT_TEST262_RESUME, TINT_TEST262_CAPTURE_SOURCES
```

### 5.2 Node-only phase (no image, no debugger, `batches: []`)

**P1: census pin.** Write `.tint-bootstrap/census-namespace-v1.mjs` by copying
the ambiguous census script. Change only the selection. It emits the same case
schema as `module-ambiguous-export-census-node-v1.json`: `path`, `sha256`,
`variant`, `metadata`, `harness`, `route`, `prepared`, `fixtures`, `entries`,
with full hashes. It must assert all of the following:

- 38 variants, 38 `prepared`, no throw;
- every graph node is `parsed: true`;
- exactly 35 variants have `fixtures: []`;
- #8/#9/#31 carry 4/3/1 fixtures with the §1 hashes;
- `prepareNativeBatch` over all 38 yields 88 modules, 48 of them shared.

It writes `docs/results/module-namespace-census-node-v1.json` (`wx`). It never
compares against Node 24.

**P2: gate-off control (pinned checkout, Node only).**

```sh
set -o noclobber; mkdir .tint-bootstrap/module-namespace-v1   # must not exist
O=.tint-bootstrap/module-namespace-v1
env $ENV TINT_TEST262_JOURNAL=$O/p2-gate-off.jsonl \
  node $T/tools/test262-native-run.ts .tint-bootstrap/test262 \
  language/module-code/namespace 64 > $O/p2-gate-off.json 2> $O/p2-gate-off.log
```

The report must equal all of the following:

- exit 0 and adapter `native-script-v9-direct-eval`;
- 38 observations in census order, each `unsupported` with the reason
  `native module execution is not implemented` and no `fixtures`;
- `batches: []`;
- a scope byte-equal to the G0 scope.

If it differs, it blocks N2.

**There is no resume drill.** `module-ambiguous-export-resume-controls-v1.json`
proved resume identity, with in-graph fixture rejection and v9/v10 separation,
for this frozen runner. N2 runs the same bytes (`$T`), so that result carries
over. Repeating the drill would add no evidence.

### 5.3 Native phase: N2, one run

Write `.tint-bootstrap/run-namespace-selection-v1.mjs` by copying
`run-ambiguous-export-selection-v1.mjs` **unchanged**. That includes the
frozen-toolchain read, the snapshot assert, the handshake, `wx` outputs, the
deleted `RESUME`/`CAPTURE_SOURCES`, `TINT_TEST262_PAUSE`, and `rmSync(pause)`
in `finally`. Then make these changes:

- **Preconditions.** Before the handshake, assert §5.1.1 by reading the
  ambiguous acceptance file (`accepted === true`), and assert P1 and P2
  (§5.2).
- **Pause text.** `M2b unchanged namespace graph selection`.
- **Run.** One spawn: `[frozen.toolchain.entry, '.tint-bootstrap/test262',
'language/module-code/namespace', '64']`. It writes
  `.tint-bootstrap/test262-module-namespace-v1.{json,jsonl,log}` and
  `docs/results/test262-module-namespace-controller-v1.json`.
- **Structural asserts.** These decide whether the evidence is valid. On
  failure, nothing is copied:
  - adapter `native-script-v10-modules`, and a scope equal to G2's;
  - `revision 91c70759…`, `dirty: false`;
  - `sourceSnapshot` and `frozenToolchainSha256` equal to G2's;
  - 38 observations in census order. `path`, `sha256`, `variant` and
    `harness` deep-equal the P1 pin;
  - `fixtures` is **present** on #8, #9 and #31 and deep-equals the pin
    there. It is **absent** on the 35 self-only graphs, because the frozen
    runner drops an empty list (`$T/tools/test262-native-run.ts:241`). For
    those 35, the root `sha256` is the whole graph identity;
  - `compilation.batches` equal to `[[0, 38, 'execution', 'compiled']]`, and
    every observation carrying `batch: 0`;
  - `resumption.restoredVariants: 0`, and the journal ending in `complete`.
- **Copy.** When the structural asserts hold, copy the report to
  `docs/results/test262-module-namespace-native-v1.json` (`COPYFILE_EXCL`),
  whatever the statuses are.
- **Acceptance (spec-derived, §2).** Every variant must be `completed` →
  `pass`. Each other status is a `deviation` with `path`, `status`, `outcome`
  and the §2 group. Write
  `docs/results/test262-module-namespace-acceptance-v1.json` (`wx`), with
  `accepted`, `deviations` and `totals`. The controller exits nonzero when
  `accepted` is false.

The acceptance file records **measurement**. This plan states only the
requirement, and it forecasts no counts.

### 5.4 Blocking rules (no automatic retry, no resume by default)

- **A structural failure blocks.** The report stays in `.tint-bootstrap`.
  Diagnose from the journal and the log.
- **A batch outcome other than `compiled`** blocks widening. So do exit 69, a
  timeout, an unexpected exit and a debugger launch failure (U1). Diagnose with
  a single-case selection, batch size 1, into **new** `-v2` files, under the
  same `$T`, env and handshake. Never resume or overwrite `-v1`. Do not change
  the batch size of N2 itself to work around U1. If 64 fails to compile, that
  is the observation.
- **A ReferenceError test that completes without throwing** fails. These are
  #7, #11, #16, #29, #30 and #37, the `uninit` reads in #5, and #28. The
  failure names a native lowering that bypasses exotic dispatch (U2–U4).
  Diagnose the lowering. Do not touch the runtime first, because §3 shows the
  runtime is correct.
- **A TypeError expectation met by ReferenceError**, or the reverse, fails.
  Examples are #5's `delete` and #37 against #38. Do not reclassify.
- **Exit 10 (`native runtime reached an unsupported operation`)** is recorded
  as `unsupported`. It blocks widening until the operation is named.
- **Node 24 is not a justification.** Never cite Node behaviour to accept or
  reject a native outcome. Cite the §2 clause.
- **An interrupted N2 is not resumed automatically.** If main chooses to
  resume, it uses the same `$T`, env, selection, size 64 and journal, with
  `TINT_TEST262_RESUME=1`, through the same handshake.
- **Never delete or reuse a path.** Each attempt gets the next `-vN`.

## 6. Out of scope

- Every other directory, the whole-suite survey, batch-size tuning and compile
  performance.
- Namespace tests outside `language/module-code/namespace`. Examples are
  `instn-star-*`, `eval-gtbndng-*`, and `language/import` / `language/export`.
- Turning the `/tmp` probes into workspace tests before N2.
- The in-flight ambiguous N1, its controller, the DirectEval pause and its
  ack, the frozen conformance line, and the snapshot.

## 7. Next slice (proposal only): M2c fixture early-error native proof

The implementation-ready plan is
[fixture syntax proof](host-esm-fixture-syntax-proof.md).

**Choose M2c, not M3.** The inventory (`module-preparation-inventory-v1.json`)
gives these reasons:

- **M2c.** Exactly 6 variants are blocked by
  `fixture syntax verdict requires native re-parse (M2c)`. They are
  `instn-resolve-empty-export`, `-empty-import`, `-err-syntax-1`,
  `-err-syntax-2`, `-order-depth` and `-order-src`. All are `resolution`
  /`SyntaxError` negatives with 1–3 fixtures, and no other blocker.
- **M3.** Its 9 hits carry other blockers:
  - 5 sit under `top-level-await/` (M4);
  - 3 are `import-defer` (proposal slice);
  - only `verify-dfs.js` is standalone.

  M3 alone would unblock at most 1 variant.

The M2c plan would:

1. Census the 6 graphs, recording which fixture holds the syntax error. Use
   the native parser's verdict on the pinned fixture bytes. The verdict must
   not come from Node or from executing any module.
2. Define the D-rule: a fixture early error yields `error/resolution/
SyntaxError` before any module body or `$DONOTEVALUATE()` runs.
   `instn-resolve-order-*` additionally requires that the syntax error wins
   over the resolution failure, per the spec's load-then-link order.
3. Write red-first tests for the re-parse path in the routing/preparation
   layer, only where source analysis shows the current
   `UNSUPPORTED("…M2c")` short-circuit has a missing implementation behind
   it.
4. Run under the same frozen-toolchain discipline. If the re-parse changes
   tool source, that discipline requires a **new** frozen toolchain, because
   the current `$T` cannot exercise it.

It starts only after N2 is accepted.
