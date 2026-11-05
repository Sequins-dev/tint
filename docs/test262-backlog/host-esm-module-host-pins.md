# HOST-ESM M2b T1–T2: the module host gate and the v9 pins

Implementation plan for tests **T1** (capability gate) and **T2** (v9 byte
identity) of the [M2b module host plan](host-esm-test262-module-host.md) §6.
Research only. No source, test, manifest, catalog, result, queue, marker or
snapshot was changed. Nothing was built, no native binary was run, and no
process was touched. The running self-build controller, direct-eval runner
PID 67383 / child 64325 and their pause markers were left alone. Every
digest below comes from read-only Node probes in `/tmp/m2b-t1t2/`
(`probe1.ts`–`probe4.ts`, Node v24.12.0, current `dist`, `TZ` unset).
None of this says anything about native behavior or conformance.

**Baseline.** Live workspace snapshot
`2c72f4c9259c030517ee80d1c06ebcd820ab05b7f08287f9b103b39d86ec810c` (562
files). It is byte-identical in identity to
`.tint-bootstrap/node-toolchain-module-source-v1/source-snapshot.json`, which
was read only. M2a has passed `pnpm check` (4,218 tests) and
[three native fixtures](../results/module-source-native-validation-v1.json).

**Tree state at the end of research.** While this plan was being written, main
added `nativeModuleCapability` (`tools/test262-native.ts:1028-1051`) and
`tools/test262-module-host.test.ts`, which covers T1 and the T5 exits. That
gate uses the strict "any missing name throws" rule. Main has **not** yet
added T2, changed `nativeScriptAdapter` or edited the generator. The §5
digests were re-measured after main's edit and did not change. What remains
for this slice: (a) add T2 **now**, before any generator edit; (b) apply the
§1.1 gate correction, which changes one existing T1 expectation; (c) the
adapter lines, which are optional here. Neither T1 nor T2 changes
`tools/test262-native-run.ts` or the generated runtime text.

## 1. Captured export set (verified)

`capturedPublicEntry(snapshot.publicEntries, "@tint/js-runtime/modules")`
resolves to `packages/js-runtime/src/modules/index.ts` (one public entry).
`capturedModuleExports(workspaceModules([target], snapshot))` returns these 13
value exports for the live snapshot:

```
canonicalModuleRequest  createLoweredSourceModule  createSourceTextModule
evaluateModule          finishLoadingImportedModule getExportedNames
getModuleNamespace      linkModule                 loadRequestedModules
loadedModule            moduleRequestsEqual        resolveExport
settledModulePromise
```

Re-exports resolve, including the **cross-package** re-export of
`canonicalModuleRequest`/`moduleRequestsEqual` from
`@tint/foundation/modules` (`modules/index.ts:34-37`). That closes the §10
uncertainty "whether `capturedModuleExports` resolves `modules/index.ts`
re-exports". Type-only exports (`ModuleRecord`, `ModuleRequest`,
`GraphLoadingState`, …) are not in the value set, by design
(`captured-module-exports.ts:43-47`). The gate cannot and should not check them.
The compiler checks them when the gated host is built.

### 1.1 Historical snapshots carry _partial_ module contracts

This contradicts the M2b plan's §3.1 rule that "a partial set throws". The
same read-only probe over earlier frozen snapshots found:

| Snapshot (`.tint-bootstrap/node-toolchain-*/source-snapshot.json`) | Identity    | Modules public entry | Value exports                                                                                                          |
| ------------------------------------------------------------------ | ----------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `direct-eval-host-v1` (frozen conformance line)                    | `5d196757…` | **absent**           | —                                                                                                                      |
| `module-linking-v1`                                                | `6d91a472…` | present              | 6: `createSourceTextModule getExportedNames getModuleNamespace linkModule loadedModule resolveExport`                  |
| `module-loading-v1`                                                | `aad1b4bc…` | present              | 11: above + `evaluateModule finishLoadingImportedModule loadRequestedModules moduleRequestsEqual settledModulePromise` |
| `module-source-v1` (= live)                                        | `2c72f4c9…` | present              | 13 (full)                                                                                                              |

If current tools restored `module-loading-v1` or `module-linking-v1` through
`TINT_TEST262_SOURCES`, the run would throw at startup under both the original
rule and main's current implementation. The doc comment at
`test262-native.ts:1028-1029` ("Historical snapshots have no module entry") is
true only of the frozen direct-eval snapshot. It should run v9.
That snapshot already has all five phase functions, so only the
**lowered-record factory** marks an M2b-capable runtime.

**Rule (replaces the M2b plan's §3.1 partial-set sentence):**

1. If there is no public entry for `@tint/js-runtime/modules`, return `false`.
2. If the entry exists but `createLoweredSourceModule` is not exported,
   return `false`. This covers the M1/M2-era contracts.
3. If `createLoweredSourceModule` is exported, require `loadRequestedModules`,
   `finishLoadingImportedModule`, `linkModule`, `evaluateModule` and
   `settledModulePromise`. The first missing name throws
   `"incomplete captured module host contract: " + name`.

This follows `capturedScriptEvaluation`, where the direct-eval factory acts as
the marker and the pair members are then mandatory
(`test262-native.ts:1079-1090`). `rejectUnsupportedExecution` is already a
required object-runtime import of every generated host. It needs no new check.

The frozen direct-eval snapshot has **no** entry, so the gate cannot throw
there. Its captured Script evaluation and runtime capabilities equal the live
ones exactly (probe2). That means the T2 tuple below is the capability tuple
of the frozen conformance line. This was compared from data only. The frozen
toolchain's own generator text was not compared and is not claimed equal.

## 2. Safe snapshot copy without the module mapping

```ts
const M = "@tint/js-runtime/modules";
const withoutModules = {
  ...snapshot,
  publicEntries: snapshot.publicEntries!.filter((e) => e.specifier !== M),
};
```

- This removes exactly one entry (probe4). `mappings` stays untouched on
  purpose. The per-package import grants (`js-engine` → modules,
  `native-runtime` → modules) are graph edges that lowered module code uses
  (`js-engine/src/lowering/runtime-imports.ts:19`). Removing them would change
  graph loading, which is not the property under test.
- With the entry removed, `capturedNativeRuntimeCapabilities` and
  `capturedScriptEvaluation` are deep-equal to the live results (probe4). So
  the copy changes only the gate input.
- The copy's identity becomes `3450050e…` because `publicEntries` is hashed
  (`workspace-sources.ts:122-123`). Do not assert a report identity from it.
- A **schema-1** copy (`publicEntries: undefined`) falls back to `mappings`
  and still finds the target through the grants, so the gate is `true`.
  Main's existing test also strips `mappings` and then drops `publicEntries`
  as well. That is correct for the gate in isolation. It is unsafe only as
  input to graph-loading helpers, and the test does not use it that way.
  Keep both copies.

**Removing one export.** Main's test renames the first `\bname\b` in the
captured `modules/index.ts` to `name as hidden`. That works for all six
names, including the one-line `export { linkModule, type ModuleLinkResult }`.
Line deletion (`"  " + name + ",\n"`) would **not** work for `linkModule`
(zero matches). Keep main's approach. Probe4, using line deletion with the
§1.1 rule: `createLoweredSourceModule` removed → `false`; each of the other
five removed → throws `incomplete captured module host contract: <name>`.

## 3. The v9 capability tuple (pinned literal)

Captured from the live snapshot (probe3) and equal to the frozen line's
capabilities (§1.1):

```ts
const evaluation = {
  evaluation: "packages/js-engine/src/script-evaluation.ts",
  compile: "packages/js-engine/src/native/script-compile.ts",
  indirectEval: true,
  functionFallback: true,
  directEval: true,
} as const;
const v9 = [
  true, // disposal
  true, // asyncDisposal
  true, // sharedBuffers
  true, // atomics
  "packages/native-runtime/src/intrinsics/spin-hint.ts", // spinHint
  true, // sharedAtomics
  "packages/js-engine/src/native/code-storage.ts", // storageProvider
  "packages/js-engine/src/dynamic-function.ts", // dynamicProvider
  "packages/native-runtime/src/intrinsics/weak.ts", // weakProvider
  true, // weakRef
  true, // finalizationRegistry
] as const;
```

This is the positional order shared by `nativeTestRuntimeSource` (after the
evaluation argument) and `prepareNativeBatch` (after `cases`, before the
evaluation argument). `capturedEngineProvider` is not exported. Use the
literals, or `capturedPublicEntry(publicEntries, …)` if the test also needs to
check the live capture. **Do not** use default arguments. Default arguments
give a different text (`19bf5729…`, not the tuple's `9a544f16…`) because they
omit shared buffers, atomics and weak storage. That would pin a host no run
has used.

`directEvalSiteView: true` is an image-builder input
(`createNativeImageBuilder`), not a text input. It is not part of either
digest. Assert it in the live-capture check only.

## 4. Smallest Script corpus

Reuse the inputs already in `tools/test262-native.test.ts`. They are tiny and
already reviewed:

- **A (sync + harness):** `executionPlan("assert(true);", "strict",
{flags:[],features:[],includes:[]})` with harness `assert.js` =
  `function assert(x){if(!x)throw 1;}` and `sta.js` = `var shared=42;` (`:45-53`).
  `prepareNativeScripts(plan, "strict", harness)` gives `test262-script-0..2`.
- **B (raw):** `executionPlan("42;", "raw", {flags:["raw"],features:[],includes:[]})`
  with no harness (`:374-380`).

Cases, in order:

| #   | Scripts | `asynchronous` | `canSuspend`       | Generator branch exercised             |
| --- | ------- | -------------- | ------------------ | -------------------------------------- |
| 0   | A       | `false`        | omitted (→ `true`) | sync host; first content-key sharing   |
| 1   | A       | `true`         | omitted            | async host; **reuses** shared ids      |
| 2   | B       | `false`        | `false`            | `canSuspend=false` host; new shared id |

Resulting module ids, in order (probe3): `test262-runtime`,
`test262-shared-script-0`, `-1`, `-2`, `test262-case-0-host`,
`test262-case-1-host`, `test262-shared-script-3`, `test262-case-2-host`,
`test262-host`.

**"Harness-failing" is not a batch-level property.** A failing harness changes
runtime behavior, not the bytes of `prepareNativeBatch`. A runtime failure can
only be observed natively, which is outside this slice. The pin covers the
harness-_bearing_ case (A), not a failing one.

The case-local dependency branch (`test262-case-N-…` renaming,
`test262-native.ts:822-825`) cannot be reached from `prepareNativeScripts`
output, because lowered Scripts import only runtime modules. Leave it out. A
synthetic graph would pin a path the v9 host never takes.

## 5. Digests (measured, `TZ` unset)

```ts
const strip = (k: string, v: unknown) =>
  k === "start" || k === "end" || k === "sourceStart" ? undefined : v;
const generated = (id: string) =>
  id === "test262-runtime" ||
  id === "test262-host" ||
  /^test262-case-\d+-host$/.test(id);
const canonical = JSON.stringify(
  batch.map((m) => [
    m.id,
    [...m.dependencies],
    generated(m.id) ? m.module : "lowered-script",
  ]),
  strip,
);
```

| Pin                                                                                | SHA-256                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `nativeTestRuntimeSource(evaluation, ...v9)` raw text (19,322 chars)               | `9a544f16fb7a75b06d5883b1a60077fd302dc55e6ac77e5b53f21343486ca564` |
| batch `canonical` above, cases 0–2, `prepareNativeBatch(cases, ...v9, evaluation)` | `dba4351300b171b3753653747035a41401743ad57bc6ff853eb2052164427b31` |
| (informational) same, lowered-Script ASTs included                                 | `d207635e677ea4b487bc609f9103755510aba3218c412853126b99fa24e9717f` |
| (informational) `test262-runtime` AST only, `strip`ped                             | `76f9083f77049867b2a5466a87520255357c8778dfe5ded560292116260d9a87` |

Design choices:

- **Raw text, no `strip`, for the runtime.** M2b's §4.1 refactor into string
  fragments must reproduce the text byte for byte, so whitespace counts. That
  is stricter than the existing AST pin (`test262-script-service.test.ts:79-91`),
  and it should be.
- **Spans are metadata.** `start`/`end`/`sourceStart` are excluded only from
  the AST-bearing batch digest, as in the existing canonical host digest. They
  are source positions, not behavior.
- **Lowered Script ASTs are replaced by a marker.** M2b does not edit the
  Script lowerer. Pinning its output would turn unrelated lowering work into
  false T2 failures. Script ids, the sharing pattern and the
  `prepareNativeScripts` dependency map remain pinned through `[id, deps]`.
  Use the informational `d2076…` value only if main explicitly wants lowering
  frozen too.
- **The digests are `TZ`-sensitive.** `nativeTimeZoneData` is interpolated
  into the text (`test262-native.ts:52-63`). With `TZ=America/New_York` the
  text digest becomes `a8c4c384…` and the batch digest `a69a4247…`. The
  existing legacy digests (`test262-script-service.test.ts:347,433`) rely on the same thing without
  saying so. T2 should start with
  `assert.equal(native.nativeTimeZoneData.requested, null, "v9 pins require TZ unset")`
  so that an environment problem reads as such and not as host drift.
  `TINT_TEST262_CONTAINMENT_MS` does not reach the text.

## 6. Test deltas — `tools/test262-module-host.test.ts` (exists)

No catalog entry is needed. Test files are discovered by the `tools/*.test.ts`
glob (`package.json:12`), and nothing catalogs them.

### T2 — v9 byte identity (add now, green on arrival)

Add a test to the existing file. It needs `createHash` and `executionPlan`
imports, and the helpers `sha`, `strip`, `canonical`, `cases()`,
`evaluation`, `v9`, `metadata`, `harness` from §§3–5.

```ts
test("frozen v9 host text, batch and adapter are unchanged with the gate off", () => {
  assert.equal(
    native.nativeTimeZoneData.requested,
    null,
    "v9 pins require TZ unset",
  );
  assert.equal(
    sha(native.nativeTestRuntimeSource(evaluation, ...v9)),
    "9a544f16…",
  );
  assert.equal(
    sha(canonical(native.prepareNativeBatch(cases(), ...v9, evaluation))),
    "dba43513…",
  );
  assert.equal(
    native.nativeScriptAdapter(evaluation),
    "native-script-v9-direct-eval",
  );
  const plan = executionPlan("export {};", "module", metadata);
  assert.deepEqual(native.prepareNativeScripts(plan, "module", harness), {
    ok: false,
    outcome: {
      kind: "unsupported",
      reason: "native module execution is not implemented",
    },
  });
});
test("the live capture still yields the pinned v9 tuple", () => {
  const live = workspaceSources();
  assert.deepEqual(native.capturedScriptEvaluation(live), evaluation);
  const c = native.capturedNativeRuntimeCapabilities(live);
  assert.deepEqual(
    [
      c.disposal,
      c.asyncDisposal,
      c.sharedBuffers,
      c.atomics,
      c.spinHint,
      c.sharedAtomics,
      c.weakStorage,
      c.weakRef,
      c.finalizationRegistry,
      c.directEvalSiteView,
    ],
    [true, true, true, true, v9[4], true, v9[8], true, true, true],
  );
});
```

Write the full 64-hex digests from §5 into the test. They are abbreviated
here only for width. Keep the two tests separate. The tuple test moves
legitimately when a new runtime capability lands. The digest test only moves
when the generator changes.

**Red evidence for a characterization pin.** T2 cannot be red before the
code it protects changes. Prove that it can fail instead:

1. Run `TZ=America/New_York node --test tools/test262-module-host.test.ts`.
   The precondition fails with `v9 pins require TZ unset`.
2. In a scratch run only, never committed, temporarily comment out the guard.
   The text assertion fails with actual `a8c4c384…` against expected
   `9a544f16…`.

Save both logs under `.tint-bootstrap/` per local convention. Record the
green run **before** the first generator edit, so the baseline belongs to the
unedited generator.

### T1 — gate correction (one expectation changes, red first)

The current T1 loop expects a throw for all six names. Under §1.1, hiding
`createLoweredSourceModule` must return `false`. Change the test first:

```ts
test("snapshots without the lowered-record factory keep the v9 host", () => {
  // Same shape as module-loading-v1 (aad1b4bc…): every phase, no factory.
  assert.equal(
    native.nativeModuleCapability(
      hide(workspaceSources(), "createLoweredSourceModule"),
    ),
    false,
  );
});
// and remove "createLoweredSourceModule" from the existing throwing loop
```

`hide` is the existing `\bname\b` → `name as hidden` rewrite, extracted as a
helper. **Expected red** against the current gate:
`Error: incomplete captured module host contract`, thrown instead of
returning `false`. Then change the gate (§7 step 3). Optionally add the
missing name to the message (`…contract: <name>`). The existing
`/incomplete captured module host contract/` regex still matches if you do.

**Adapter (optional in this slice).** If main wants it here:
`nativeScriptAdapter(evaluation, false)` → v9; `(evaluation, true)` →
`native-script-v10-modules`; `({...evaluation, directEval: undefined}, true)`
throws `/module host requires the v9 Script contract/`. Expected red: TS2554
under `pnpm typecheck`. At runtime, the extra argument is ignored and both
calls return v9, so the `true` case fails `assert.equal`.

## 7. Edit list (in order)

1. **Add** the two T2 tests to `tools/test262-module-host.test.ts`. Run them
   green, record the red evidence from §6, and run `pnpm check`.
2. **Change** the T1 test as in §6. Run it and record the red.
3. **Edit** `tools/test262-native.ts:1028-1051`, `nativeModuleCapability`,
   and nothing else in the generator:
   - After `exports === undefined` → throw, add
     `if (!exports.has("createLoweredSourceModule")) return false;`. Then check
     the remaining five names in the same order as before.
   - Fix the doc comment. Snapshots _before the lowered-record factory_,
     including M1/M2-era partial contracts, keep their existing host.
   - Optional: the adapter change. Put
     `if (modules) { if (evaluation?.directEval !== true) throw Error("module host requires the v9 Script contract"); return "native-script-v10-modules"; }`
     before the existing chain, with `modules: boolean = false`.
   - Do **not** touch `nativeTestRuntimeSource`, `prepareNativeBatch`,
     `nativeTestHost`, `prepareNativeScripts` or any generated text.
4. **Do not edit** `tools/test262-native-run.ts` here.
   `test262-script-service.test.ts:213-217` asserts the literal
   `engine = nativeScriptAdapter(capturedScriptEvaluation(snapshot))`. The
   wiring slice that passes the gate must update that regex in the same
   commit.
5. Run `pnpm check`: everything green, with no catalog, manifest,
   managed-surface (128) or result change.

After this slice, every later M2b generator edit must leave both T2 digests
unchanged with the gate off. That is the condition for refactoring
`runNativeScripts` into fragments (M2b §4.1).

## 8. Assumptions and evidence limits

- The digests were measured with the **current** generator against current
  `dist`. If `test262-native.ts` changes before T2 lands, remeasure with the
  probe and do not reuse these values.
- Pinning v9 _text_ says nothing about native behavior. Whether the frozen
  toolchain at `node-toolchain-direct-eval-host-v1` emits the same text was
  **not** checked. That would require running its tools, and its snapshot was
  only read. The claim is limited to "current tools, gate off, v9 tuple".
- `TZ` unset is assumed for `pnpm test`, as the existing digests already
  assume. That was not verified on CI.
- The gate marker choice rests on four snapshots (§1.1). Other historical
  snapshots were not surveyed. Any snapshot without `createLoweredSourceModule`
  is `false` by construction, so the risk is confined to a hypothetical
  snapshot that exports the factory but lacks a phase function. It would
  throw, which is the intended outcome.
- No native, conformance, coverage or performance claim is made.

## 9. Next focused planning task

T5 already exists in main's tree. Plan the **M2b §4.1 fragment extraction**
next. That plan should cover:

- which exact substrings of `runNativeScripts` become shared TypeScript
  fragments: realm setup, `print`, `captureTestErrorPrototype`, `failure`,
  the harness loop and the post-drain checks;
- how to show, against T2's `9a544f16…`/`dba43513…`, that the gate-off text
  is byte-identical after the extraction;
- the T7 order assertions for the gated `runNativeModuleTest`
  (`anyUnsupported()` before `settledModulePromise`/`failure` in each phase).

This keeps the first generator edit behind a pin that already exists.
