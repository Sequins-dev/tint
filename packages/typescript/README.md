# TypeScript framework

Portable syntax, binding, finite type contracts, reification and contextual checking.
The framework exposes direct compiled entrypoints without a root barrel:

- `@tint/typescript/syntax`: scanning, parsing, AST types, rewriting, source hashes,
  binding-pattern helpers and dynamic Function fragment parsing.
- `@tint/typescript/binding`: value-name binding, closure/receiver captures,
  JavaScript declaration validation and Script/module declaration rules.
- `@tint/typescript/types`: structural type graphs, assignability, property/call/
  construct operations, narrowing and relation storage.
- `@tint/typescript/reify`: reachable type graphs to named AST type aliases,
  preserving recursion and the caller's generated-name prefix.
- `@tint/typescript/checker`: existing scalar and closure-aware contextual checkers,
  checked metadata, intrinsic requirements and completion analysis.
- `@tint/typescript/checker/closures` and `/checker/interfaces`: direct access to
  those existing stages without loading the scalar checker facade.
- `@tint/typescript/modules/model`: the parsed `SourceModule` data contract shared
  by loading and linking, independent of either implementation.
- `@tint/typescript/modules/exports`: resolve supplied declaration identities through
  named and star exports in value/type namespaces, without native composition or
  module execution. Shared metadata collection consumes real binding results and
  explicit caller identity maps; per-declaration collection lets native callers
  retain their policy/error order. Binding patterns fail explicitly in this
  metadata subset. Named and star resolution also accepts supplied metadata.
- `@tint/typescript/modules`: source graph loading from supplied bytes, exact import
  grants and root IDs, without filesystem access or module evaluation.

The parser consumes `@tint/source/text` views and returns spanned ASTs or precise
first-failure diagnostics. Spans remain half-open UTF-16 offsets. Binding resolves
identities independently of checking or execution. Type IDs remain local to their
finite graph; completed relation proofs and budgets retain their existing contracts.
Reification chooses neither runtime encoding nor target ABI.

The production native pipeline currently links and prepares whole programs before
contextual checking, including native-global rewriting and generic specialization.
The checker retains native-shaped storage/intrinsic metadata and explicit support
restrictions; this consolidation does not turn it into a general per-module,
parametric TypeScript checker. The legacy `checkModule` and closure-aware
`checkClosureModule` APIs remain available for their current consumers.

There is no TS-to-JS printer, transform pipeline or declaration emitter here yet.
Module graph loading uses the same parser and lower data contract; native-oriented composition
and specialization remain in `@tint/ts-native/modules`. The frontend has no dependency on
IR, native code generation, executable formats or the execution runtime.

All original language suites remain flat under `test/`, prefixed by their layer.
TypeScript is the pinned conformance guide; JavaScript parsing/binding and runtime
behavior are validated separately, with native execution required for native claims.

`loadSourceGraph` decodes and catalogs all supplied inputs, then resolves and parses
reachable modules in deterministic breadth-first order. Type and runtime imports
both contribute source dependencies; unreachable inputs are not parsed. Diagnostics
distinguish decoding/catalog/resolution/parsing and byte/UTF-16 offsets. Each loaded
module retains its source-position callback for diagnostics and native debug info.
Physical package ownership stays in `SourceInput.packageId`; host grants and module
evaluation remain separate contracts.
