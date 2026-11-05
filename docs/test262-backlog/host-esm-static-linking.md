# HOST-ESM M0/M1: static graph discovery, module records and linking

Refresh of slices M0 and M1 of the [HOST-ESM plan](host-esm.md), checked on
2026-11-05 against current source and the pinned Test262 checkout
(`.tint-bootstrap/test262`, revision `91c70759363c46557b694792bf34a2551a7af5ba`,
clean). Planning facts only: no native emission or execution, no rebuild, no
survey. Read-only probes ran in `/tmp/hostesm-static/` and are not artifacts.
Spec steps are recalled from ECMA-262 (ES2025 structure), not fetched; items
marked **unverified** must be checked against the spec text before coding.

This supersedes the M0/M1 bullets of `host-esm.md` §6 where they differ. It
corrects D1, which fails under cycles (§4.3), moves journal-identity edits out
of M0 (§3), and splits M1 so that **M1a can start now** (§6).

Current implementation: M0 graph discovery and M1a live bindings, export
resolution, namespaces and cyclic linking pass the
[4,172-test workspace gate](../results/module-linking-runtime-checkpoint-v1.json).
All four M1a native fixtures passed. Namespace imports re-exported locally are
normalized to indirect exports; namespace cells are created during linking.
The consolidated frozen native self-build is pending. Loading, evaluation and
Test262 module execution are the next slices.

## 1. Source changes since the parent plan

- Lowered Scripts now receive a `ScriptRecord` `{kind: "script", realm,
hostDefined}` (`js-runtime/src/objects/jobs.ts:15`), not an opaque `execute`
  identity. `execute($global, $script)` is emitted at
  `js-engine/src/lowering/index.ts:4884`; `scriptIdentity()` (`:249`) picks the
  identity per entry kind. Module records join it as `kind: "module"`.
- `ErrorRealm` holds embedding-owned callbacks (`evalCompiler`,
  `directEvalCompiler`, `dynamicFunctionCompiler`; `objects/errors.ts:77-82`).
  A module-loader slot follows that precedent, in M1b.
- The adapter is `native-script-v9-direct-eval` (`tools/test262-native.ts:911-920`);
  module variants are still rejected before compilation (`:190-191`). The
  async-driver refactor moves from M1 to M4 (top-level await).

## 2. Static-graph assumption: confirmed, with refinements

Pinned `INTERPRETING.md` ("Modules"): every specifier starts with `./`; the rest
names a file in the test's own directory, decoded as UTF-8 and given to
ParseModule. `.json` files are JSON; `<module source>` belongs to the
source-phase proposal. `_FIXTURE` files never run standalone and get no
Test262-defined bindings (`$262`, `print`), but share the test realm.

Probe of every `.js`/`.json` under `test/` (54,058 files, 307 `_FIXTURE`;
regex-based, counts approximate):

- **No cross-directory specifiers.** The only non-`./` static specifiers are
  `<module source>` (3) and `<do not resolve>` (5, all parse-negative).
- **Self-imports are common:** 141 references in 12 directories (e.g.
  `namespace/internals/own-property-keys-sort.js`). The root needs a module-map
  entry under its own file name.
- **A test may import another test:**
  `ambiguous-export-bindings/namespace-unambiguous-if-export-star-as-from-and-import-star-as-and-export.js`.
  Discovery accepts any sibling file, not only `_FIXTURE` names.
- **Computed `import()` arguments** occur in 137 non-parse-negative tests. 81
  contain a resolvable `./` literal; in two of them
  (`dynamic-import/assignment-expression/additive-expr.js` and
  `lhs-assign-operator-assign-expr.js`) the path is built at runtime and the
  file name appears **only in a comment**, so discovery scans raw text,
  comments included. The other 56 pass ToString-abrupt objects or non-path
  values (`"[object Object]"`, `undefined`, generator output) and must fail to
  load.
- **Deliberately missing files:** `./THIS_FILE_DOES_NOT_EXIST.js` (16
  `dynamic-import/catch` tests asserting only `typeof error !== "undefined"`)
  and `./missing.js` (an `import-defer` fixture).

**Conclusion.** Each test has a closed graph: the transitive closure of
bootstrap-parsed static requests and raw-text `./…` literals naming existing
siblings, plus the directory's file-name list for the policy in §5. The
over-approximation is harmless because loading is lazy.

## 3. M0: graph discovery (Node tooling only)

**Boundary.** M0 knows files, paths and hashes; it never builds records or
judges syntax (a bootstrap parse failure means only "no static edges known").
M1 knows records, requests and bindings, nothing about files. They meet in M2,
where the runner's table becomes the image's loader. Neither changes outcomes.

**Landing scope (changed).** The parent put exit codes 60–68, a `fixtures`
field in `ObservationInput` and an adapter bump in M0. Those change journal
identity and edit existing tools files while nothing new is reported. **Defer
them to M2**, which first changes outcomes. M0 becomes new files only
(`tools/test262-module-graph.ts` and its `.test.ts`): no existing tools source,
fixture hash, journal, manifest or adapter string changes, so the parent's
coordination constraint no longer applies to M0.

```ts
interface ModuleGraphNode {
  name: string;
  kind: "javascript" | "json"; // name = file in the test directory
  source: string;
  sha256: string; // fatal UTF-8 decode as test262Source; hash of the bytes
  parsed: boolean; // bootstrap parseModule accepted it (edges only, never a verdict)
}
interface ModuleGraph {
  root: string; // basename of the test file
  nodes: ModuleGraphNode[]; // sorted; the root is present iff referenced
  siblings: string[]; // sorted names of every file in the directory
}
function discoverModuleGraph(
  filename: string,
  rootSource: string,
  goal: "script" | "module",
): ModuleGraph;
```

Rules:

1. Seeds: the root's static requests (module goal, only if bootstrap
   `parseModule` accepts it) and its raw-text literals.
2. Static requests come from `Module.imports` (`syntax/model.ts:498`), filled in
   source order for `import` and `export … from` (`parser.ts:2721`, `:2784`);
   skip `typeOnly`. Values are decoded, so escaped specifiers are found. Raw
   literals match `(['"])(\.\/[^'"\s\\]+)\1` over the whole text, comments
   included, keeping names that exist in the directory.
3. `./name` with no further `/` maps to that sibling via `within()`
   (`tools/test262-checkout.ts:5`); other specifiers add no node. `.json` names
   become edgeless `json` nodes. Every `javascript` node is followed
   transitively, parsed or not (unparsed ones contribute literals only), once.
4. The root is a node only when referenced; read from disk, its hash equals the
   observation's `sha256`, and under the module goal it is the root record.

Red-first tests (temporary directories plus pinned cases): (1) cycle
`a → b → a` terminates, each node once, sorted; (2) a root self-import yields a
root node with the root's hash; (3) a literal inside a comment adds its target;
(4) a missing literal adds no node and is absent from `siblings`; (5)
`./../x.js` and `./sub/x.js` add no node and do not throw; (6) a JSON node has
no edges even if its text holds `./` strings; (7) an unparsed fixture still
contributes literal edges, `parsed: false`, no error; (8) a Script-goal root
contributes literal edges only; (9) changing one fixture byte changes only that
node's hash; (10) pinned: `instn-resolve-order-src.js` yields its three
fixtures, `additive-expr.js` yields `module-code_FIXTURE.js` and
`module-code-other_FIXTURE.js`, and the `ambiguous-export-bindings` test above
yields its sibling test.

No native validation: no image or portable code changes.

## 4. M1: module records and linking (portable runtime)

### 4.1 Placement and reuse

New internal directory `packages/js-runtime/src/modules/` behind one entrypoint,
`@tint/js-runtime/modules` (package `exports`, beside `./bytes/shared`).
`@tint/js-runtime` still depends only on `@tint/foundation`, so
`workspace-contracts.json` is unchanged. The files are catalogued compiler
sources: run `node tools/generate-compiler-catalog.ts`, then format.

Reuse `DeclarativeEnvironment`/`Binding` (`environments/records/index.ts:8-27`)
with module scope `createDeclarativeScope(createGlobalScope($global), env)`
(`environments/global/scope.ts:52`); `createExoticObject` with
`ObjectInternalMethods` (`objects/operations.ts:167`, `:315`) and the
`ordinary*` fallbacks (`:409-746`), as `proxy.ts` and `integer-indexed.ts` do;
`createRuntimeError(realm, "syntax" | "reference" | "type")` (`errors.ts:538`);
`wellKnownSymbol(realm.symbolRegistry, "toStringTag")` (`symbols.ts:59`). M1b
reuses `runScriptContext`, `enqueueScriptJob` and `createSourceExecutionContext`
(`jobs.ts:59`, `:72`, `:129`), which already carry `scriptOrModule`
(GetActiveScriptOrModule), and `newPromiseCapability(realm.promiseConstructor,
…)` (`promise-capability.ts:21`). Not reused: `@tint/typescript/modules`, the
compiler's static linker (no TDZ, cyclic evaluation or error caching).

### 4.2 Records (`modules/records.ts`)

```ts
// All fields readonly unless noted; `readonly` omitted here for brevity.
interface ModuleRequest {
  specifier: string;
  attributes: { key: string; value: string }[];
} // by key
interface ImportEntry {
  request: number;
  importName: string | undefined;
  localName: string;
} // undefined = namespace-object
interface LocalExportEntry {
  exportName: string;
  localName: string;
} // "*default*" for anonymous defaults
interface IndirectExportEntry {
  exportName: string;
  request: number;
  importName: string | undefined;
} // undefined = all
interface SourceModuleShape {
  requests: ModuleRequest[]; // deduplicated, first occurrence
  imports: ImportEntry[];
  localExports: LocalExportEntry[];
  indirectExports: IndirectExportEntry[];
  starExports: number[];
  hasTopLevelAwait: boolean;
}
type ModuleStatus =
  | "new"
  | "unlinked"
  | "linking"
  | "linked"
  | "evaluating"
  | "evaluating-async"
  | "evaluated";
interface ModuleRecord {
  kind: "module";
  realm: ErrorRealm;
  hostDefined: unknown;
  shape: SourceModuleShape;
  environment: DeclarativeEnvironment<unknown>; // allocated at creation (§4.3)
  loaded: (ModuleRecord | undefined)[]; // per request
  /* mutable */ status: ModuleStatus;
  dfsIndex: number;
  dfsAncestorIndex: number;
  /* mutable */ environmentInitialized: boolean;
  namespace: OrdinaryObject<ScriptPropertyKey, unknown> | undefined;
  instantiate: () => void; // link time: vars := undefined, hoisted functions
  // M1b adds execute, evaluationError, cycleRoot, topLevelCapability.
}
function createSourceTextModule(
  realm: ErrorRealm,
  shape: SourceModuleShape,
  hostDefined: unknown,
  declare: (env: DeclarativeEnvironment<unknown>) => void,
  instantiate: () => void,
): ModuleRecord;
```

Building shapes from syntax belongs to M2 lowering, which must apply
ParseModule's conversions; M1 tests hand-build shapes that already reflect
them. An exported import becomes an indirect entry (`import {a as x} from "m";
export {x as y}` → `{exportName: "y", request: m, importName: "a"}`); a
re-exported namespace import is also indirect, like `export * as ns`, with
`importName: undefined`. The builder rejects `defer`/`source` phases explicitly
until their proposal slices. `"new"` means loading is incomplete; M1a tests set
`loaded` and `"unlinked"` directly.

### 4.3 Import bindings (D1, corrected)

**Flaw.** The parent's D1 shares the exporter's `Binding` object with the
importer. InnerModuleLinking runs InitializeEnvironment in DFS post-order, so
in `A ↔ B` (root A) B is initialized while A is still `linking`: A's
environment does not exist yet and B's import has nothing to point at. The
spec avoids this with indirect bindings looked up as `(module, name)` on each
access.

**Decision D1′.**

- **Declare early, initialize at link.** `createSourceTextModule` allocates the
  environment and calls `declare(env)` at once, creating every top-level var,
  let, const, class, function and `*default*` binding uninitialized. At link
  time `instantiate()` initializes vars to undefined and instantiates hoisted
  functions, as InitializeEnvironment does. Early creation is unobservable: no
  module code runs before Link completes.
- **Share the `Binding` object.** The importer's map holds the exporter's
  binding, so values are live and TDZ needs no copy; `getBindingValue` already
  reports `"reference"` when uninitialized.
- **Reject writes per environment.** Add `importNames: Set<string> | undefined`
  to `DeclarativeEnvironment`, set only by `createDeclarativeEnvironment` (its
  single construction site). `setMutableBinding` checks it **before** the
  initialized check and returns `"type"`: import bindings are initialized and
  immutable from the importer's side, so assignment throws TypeError even while
  the target is in TDZ.
- Other `setMutableBinding` callers (`global/function.ts:87`, `scope.ts:150`,
  `eval-declarations.ts:133`, `:309`, `arguments.ts:62`, `record.ts:94`) are
  unchanged; Script environments keep `importNames: undefined`.

Rejected: a per-`Binding` target field (a word and branch per binding); static
TypeError lowering (strict direct eval in modules writes dynamically, M7). D1′
costs one field per environment and one branch per write on a hot layout:
measure image size and keep self-build stage images identical.

### 4.4 Resolution (`modules/resolve.ts`)

`resolveExport(module, name, resolveSet?)` returns `{module, bindingName}`
(`bindingName: undefined` = NAMESPACE), `"ambiguous"`, or `undefined` (null):

1. `(module, name)` already in the set → null (circular request).
2. A local export entry → `{module, localName}`.
3. An indirect entry with undefined `importName` → target as NAMESPACE;
   otherwise recurse into the target.
4. `default` → null.
5. Star exports: `"ambiguous"` propagates; two non-null results differing in
   module or binding name (namespace versus named included) → `"ambiguous"`.

`getExportedNames(module, starSet?)` returns `[]` when the module is already in
the set; otherwise local and indirect names in order, then each star target's
names minus `default` and duplicates. An unset `loaded[request]` or a `"new"`
module throws `"MODULE_LOADED_INVARIANT"` (internal, not a JS exception).

### 4.5 Linking (`modules/linking.ts`)

`link(module)` follows Link/InnerModuleLinking: start from `unlinked`, `linked`,
`evaluating-async` or `evaluated`; walk `requests` depth first in index order,
lowering `dfsAncestorIndex` while a dependency is `linking`; run
InitializeEnvironment in post-order; mark an SCC `linked` when its root
finishes. On abrupt completion, every module left on the stack becomes
`unlinked` and the error is rethrown.

InitializeEnvironment (runtime part):

1. Each indirect export must resolve; null or `"ambiguous"` → SyntaxError.
2. **Resolve every import entry before mutating anything:** namespace-object →
   `getModuleNamespace(target)`; named → `resolveExport`, null or
   `"ambiguous"` → SyntaxError; a NAMESPACE result →
   `getModuleNamespace(resolution.module)`.
3. Commit: namespace bindings via `createImmutableBinding(local, true)` and
   `initializeBinding`; named bindings via
   `env.bindings.set(local, target.environment.bindings.get(name))` plus
   `importNames.add(local)`; an absent target binding throws
   `"MODULE_BINDING_INVARIANT"`.
4. Call `instantiate()` once, guarded by `environmentInitialized`.

Resolve-then-commit makes relinking after failure idempotent. The spec builds a
fresh environment per attempt; reuse is unobservable because a failed link runs
no code and resolution is deterministic after loading. The only earlier side
effect is a cached `[[Namespace]]`, which the spec also keeps.

**Unverified:** link errors use the current realm
(`agent.activeContext?.realm ?? module.realm`). Test262 is single-realm here;
module tests using `$262.createRealm` exist only under ShadowRealm.

### 4.6 Namespace objects (`modules/namespace.ts`)

`getModuleNamespace` returns the cached `module.namespace`, or builds one: keep
exported names whose resolution is a binding, sort them in **UTF-16 code-unit
order**, create `createExoticObject(undefined, methods)`, and define an ordinary
own `@@toStringTag` `"Module"` (non-writable, non-enumerable, non-configurable).
Each name's target is cached as a `Binding`, or a module for NAMESPACE;
unobservable, since resolution is fixed after linking and D1′ guarantees target
bindings exist.

Methods (P a string unless noted; every Symbol key uses ordinary behavior):

- `getPrototype` → undefined (null); `setPrototype(V)` → `V === undefined`;
  `isExtensible` → false; `preventExtensions` → true; `set` → false;
  `hasProperty` → membership in exports; `deleteProperty` → false if exported,
  else true; `ownKeys` → exports, then ordinary symbol keys.
- `get`: not exported → undefined; NAMESPACE target →
  `getModuleNamespace(target)`; else the binding value, or ReferenceError while
  uninitialized. `getOwnProperty`: not exported → undefined; else `[[Get]]` (may
  throw) as `{value, writable: true, enumerable: true, configurable: false}`.
- `defineOwnProperty`: read `current` (may throw); false if it is undefined or
  the descriptor is configurable, non-enumerable, an accessor or non-writable;
  with a value, SameValue against the current value; else true.

**Unverified:** native string comparison must be code-unit ordered. Compare
`"￿"` with `"\u{10000}"`; the surrogate pair (D800 DC00) must sort first,
otherwise use an explicit comparator. Pinned `own-property-keys-sort.js` covers
only BMP characters.

### 4.7 M1b: loading and synchronous evaluation

Superseded by the spec-verified [M1b plan](host-esm-loading-evaluation.md),
which also corrects §4.2's namespace re-export rule and the M1a link-retry contract.

Add `moduleLoader: ModuleLoader | undefined` to `ErrorRealm`, initialized in
`createErrorRealm` (`errors.ts:217`) beside `dynamicFunctionCompiler`;
JavaScript cannot replace it. It must return the same record for the same
referrer and request.

```ts
type ModuleLoader = (
  referrer: ModuleRecord | ScriptRecord | ErrorRealm,
  request: ModuleRequest,
  hostDefined: unknown,
  finish: (
    r: { ok: true; module: ModuleRecord } | { ok: false; error: unknown },
  ) => void,
) => void;
```

- `loading.ts`: GraphLoadingState, InnerModuleLoading,
  FinishLoadingImportedModule, ContinueModuleLoading. It settles through a
  callback; M3 adds the promise adapter because ContinueDynamicImport observes
  loading through `PerformPromiseThen`. Requests load depth first in source
  order; the first error stops loading; modules move `new` → `unlinked` only on
  full success. An unsupported attribute key fails loading with SyntaxError
  (AllImportAttributesSupported as recalled from ES2025, **verify**), settling
  the parent's open question 1 for static imports; dynamic imports reject the
  same way in EvaluateImportCall (M3/M5).
- `evaluation.ts`: synchronous Evaluate/InnerModuleEvaluation. Repeated calls
  return the same `topLevelCapability` promise; post-order execution; SCC root
  as `cycleRoot`; on error every stack member becomes `evaluated` with the same
  `evaluationError`, rethrown by later imports without re-running. `execute()`
  runs under `runScriptContext(agent, {realm, scriptOrModule: record}, …)`.
  `hasTopLevelAwait`, or an async dependency, calls `rejectUnsupportedExecution`
  until M4.

## 5. Phases, goals and host policy

**Negative phases** (Test262 unchanged). Parse/early stay on `nativeSyntaxHost`
with the module goal, routed before discovery (`test262-native-run.ts:235-243`).
Resolution: load or link fails before any module code runs, codes 60–68 (M2);
fixture syntax errors come from native `parseModule` plus
`validateJavaScriptBindings` at load time, never the bootstrap parser, and
`$DONOTEVALUATE()` stays a live guard. Runtime: an Evaluate rejection maps to
30–38; `eval-rqstd-abrupt.js` needs its first requested fixture's TypeError with
the second never evaluated.

**Source goals.** Module roots get no `"use strict"` prefix (`executionPlan`).
Fixtures always load as modules (a Script test importing itself gets a separate
module record); harness Scripts run first in the same realm, fixtures get none.

**M2 loader policy (decided).** `./name` in `nodes` → that record, lowered once
per content key as `test262-shared-script-*` is today. `./name` not in
`siblings` → TypeError (host-defined; tests check only rejection). `./name` in
`siblings` but not `nodes` → `unsupported` (exit 10), never a rejection.
`<module source>` → `unsupported` until P-SOURCE. Any other specifier →
TypeError.

**M2 journal identity.** Add `fixtures: {name, sha256}[]` (sorted, root
excluded) to `NativeObservationInput` only when `nodes` is non-empty; extend the
projection in `sameNativeObservationInput` (`native-run-journal.ts:237-248`);
bump the adapter to `native-script-v10-modules`. Script-only variants keep
identical inputs.

## 6. M1a: first independently implementable slice

**Scope:** D1′ in `environments/records/index.ts`; `modules/records.ts`,
`resolve.ts`, `linking.ts`, `namespace.ts`, `index.ts`; the package export;
catalog regeneration. No loader, evaluation, lowering, runner or realm slot.

**Red-first Node tests.** Build realms as `ordinary-object-jobs.test.ts` does
(`createErrorRealm` with plain hooks). Records are hand-built: `declare` creates
bindings; `instantiate` is a closure that logs its order and initializes them.

- `environment-record-index.test.ts` (extend). B1: writing an import name
  returns `"type"` whether or not the shared binding is initialized, never
  `"reference"`. B2: an exporter write is visible through the importer (same
  `Binding`). B3: an uninitialized shared binding reads as `"reference"`. B4:
  ordinary environments have `importNames === undefined`; existing assertions
  are unchanged.
- `modules-resolution.test.ts` (new). R1 local export; R2 three-module indirect
  chain; R3 circular re-export → null (`instn-iee-err-circular` shape); R4 stars
  reaching different modules → ambiguous; R5 a diamond to one binding is not;
  R6 `default` never through a star; R7 `export * as ns` → NAMESPACE; R8 mutual
  `export *` terminates; R9 GetExportedNames de-duplicates, drops star
  `default`, tolerates cycles; R10 string names (`""`, `"π"`, `"*"`) are exact.
- `modules-linking.test.ts` (new). L1 `instantiate` runs in DFS post-order, in
  request order. L2 in `A ↔ B`, B holds A's `Binding` before A instantiates, and
  after linking calls A's hoisted function through it. L3 an unresolvable
  indirect export → SyntaxError (realm prototype identity); stack modules end
  `unlinked`, already-`linked` ones stay. L4 a named import not found or
  ambiguous → SyntaxError with the importer's environment untouched. L5
  relinking after L3 throws a fresh SyntaxError without a second `instantiate`.
  L6 relinking a linked graph is a no-op. L7 a `new` status or unset `loaded`
  slot is an invariant throw, not a JS error. L8 a namespace import binding is
  immutable and strict (writes → `"type"`).
- `modules-namespace.test.ts` (new). N1 sorted keys incl. the astral case; N2
  null prototype, `setPrototype(null)` true, `setPrototype(obj)` false; N3 not
  extensible, `preventExtensions` true; N4 `getOwnProperty` ReferenceError in
  TDZ, specified descriptor after; N5 each `defineOwnProperty` rule; N6 `has`
  for symbols and strings, found and missing; N7 `get` undefined when missing,
  throws in TDZ, live; N8 `set` false; N9 `delete` exported false, missing
  true, `@@toStringTag` false; N10 `ownKeys` strings then symbols; N11 the
  `@@toStringTag` descriptor; N12 namespace cached; N13 ambiguous names
  omitted; N14 nested `export * as ns` returns the other namespace.

**Native fixture.** `tools/verify-hosted-module-records.ts`, a
`verifyHostedFixture` like `verify-hosted-environment-record.ts`, with
dependencies `modules` → `js-runtime/src/modules/index.ts`, `environment` →
`environments/records/index.ts` and `objects` → `objects/index.ts`. One exit
code per check, 42 on success, covering L2, L3, R3, R4, B1, N1 (astral), N4,
N7, N9 and N12. Between link and the namespace reads, churn allocations to
force collections (as at `verify-hosted-jobs.ts:37`), then assert the importer's
binding is the exporter's object, the namespace identity is unchanged, and a
later update is visible. **Unverified:** whether the generic exotic-method
closures need `retainedExports` or record bindings; follow
`verify-hosted-promise-objects.ts` if the build reports them missing.

**Validation order:** focused Node tests red then green; `pnpm build`, then
`pnpm check`; regenerate and format the catalog; build the fixture with
`TINT_BUILD_ONLY=1` and run it serially under LLDB, asserting stopped-at-entry
and exit 42 with pre-entry failures kept separate; rerun
`verify-hosted-environment-record.ts` and `verify-hosted-global-environment.ts`;
frozen native self-build with stage-image comparison, recording image size
before and after D1′. No Test262 rerun: no adapter path changes.

**Coordination.** M1a edits catalogued `js-runtime` sources. Do not rebuild
`dist`, the catalog or self-build images while the active native async-body and
finalizer lane (GF17, then AGF17) depends on the current build; drafting source
and Node tests in isolation can proceed. M0 adds only new tools files and can
land independently.

## 7. After M1a

1. **M1b** (§4.7). Node: E1 post-order evaluation; E2 in a cycle a hoisted call
   succeeds and a TDZ read throws; E3 identical cached error across the SCC;
   E4 the `eval-rqstd-abrupt` order; E5 repeated Evaluate returns one promise;
   E6 `scriptOrModule` during `execute` and in jobs it enqueues; G1 depth-first
   load failure (`instn-resolve-order-src`/`-depth`); G2 idempotent loaded
   cache; G3 unsupported attribute → SyntaxError. Extend the native fixture
   with E2, E3 and E6.
2. **M0** at any time; then **M2**: shape building and `lowerModule` (`declare`,
   `instantiate`, `execute`), runner wiring (loader table, 60–68, journal
   identity, v10), native re-parse, and the parent's §6 complete reruns.

## 8. Evidence and unknowns

**Evidence** (read, not run): the source locations cited above; pinned
`INTERPRETING.md` "Modules"; the `/tmp/hostesm-static/scan*.mjs` probes behind
§2; pinned tests `instn-iee-err-circular`, `instn-resolve-order-src`/`-depth`,
`instn-resolve-empty-import`, `instn-resolve-err-syntax-1`,
`eval-rqstd-abrupt`, `own-property-keys-sort`, `delete-exported-uninit`,
`top-level-import-catch-file-does-not-exist` and `eval-code/direct/import`.

**Unverified:** exact ES2025 step text, including where
AllImportAttributesSupported applies and which realm creates link errors;
code-unit ordering of native string comparison; accuracy of the regex probes;
whether the bootstrap parser accepts every non-negative fixture (M2 keeps the
native re-parse fallback); D1′'s image cost; fixture build options for generic
exotic methods.
