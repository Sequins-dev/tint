# Source and deferred module phases

Module requests retain a nondefault `source` or `defer` phase from parsing
through lowering and the runtime module protocol. Ordinary requests omit the
field. Static request entries distinguish phases; successful host loads share
resource identity across phases using the specifier and canonical attributes.
The loader checks that identity before updating its caches.

## Source imports

Source requests load their target without traversing, linking or evaluating its
dependencies. Source bindings contain the embedding-provided module source
object. A Source Text Module Record has no source representation, so its
`GetModuleSource` operation throws a realm-appropriate `SyntaxError`; dynamic
source imports reject their own promise with that error. Linking validates all
source bindings before committing importer bindings.

Each realm owns `%AbstractModuleSource%` and its prototype. Calling or
constructing the abstract intrinsic throws `TypeError`. The prototype's
`Symbol.toStringTag` getter reads an internal module-source brand. Embeddings
create concrete source objects with a concrete prototype inheriting from that
realm's abstract prototype. The native Test262 host exposes the intrinsic via
`$262.AbstractModuleSource` and supplies the suite's `<module source>` host
representation. This does not add WebAssembly compilation or a JavaScript
global constructor.

## Deferred evaluation

Linking traverses deferred edges and installs a separate cached deferred
namespace object. Its tag is `Deferred Module`. String property operations
other than `then`, and own-key enumeration, trigger synchronous evaluation.
Symbol operations and `then` use the ordinary backing store. Prototype,
extensibility and assignment operations preserve the namespace exotic contract.

Before a synchronous trigger runs any body, readiness checks the complete
non-source dependency graph. A pending asynchronous dependency or re-entrant
evaluation throws `TypeError`; completed strongly connected components can be
accessed. Evaluation failures retain their original error identity.

Static deferred edges eagerly evaluate asynchronous transitive dependencies,
while synchronous ancestors remain deferred. The dependency traversal stops at
each asynchronous module and lets the ordinary cyclic evaluator process its
graph. Dynamic `import.defer()` loads and links first, waits for those
asynchronous evaluations using intrinsic promise operations, then resolves its
deferred namespace. A graph with no asynchronous dependency needs no extra
evaluation reaction. Deferred namespaces do not assimilate an exported `then`.

## Boundaries and evidence

Text and bytes import attributes remain explicit native-host restrictions.
Source objects are embedding-owned; a source import does not imply that an
ordinary JavaScript module exposes one. Portable module algorithms use the
existing linker, cyclic evaluator, promise jobs and object internal methods.
Node tooling only prepares unchanged Test262 sources for native execution.

The semantic contracts follow the Stage 3
[source-phase imports proposal](https://tc39.es/proposal-source-phase-imports/)
and [deferred import evaluation proposal](https://tc39.es/proposal-defer-import-eval/).
Native acceptance and coverage belong in immutable reports linked from the
[Test262 dashboard](test262.md).
