# Native generator implementation

Generator support uses the existing TypeScript-to-native pipeline. Suspension
stores execution state in a traced frame, and resumption calls native code. There
is no separate bytecode interpreter. The generic control primitive lives in
`@tint/js-runtime/iterators`; the Script object adapter lives in `@tint/js-runtime/objects`.

## Implemented boundary

`GeneratorRecord<Value>` stores its execution state and a native continuation.
The continuation receives next/return/throw plus the supplied value. It returns a
`GeneratorOutcome<Value>`: either an actual yielded iterator-result object or a
final return value. It can also throw. An initial next ignores its argument; an
initial return/throw completes without entering the body. Reentrant requests fail
without changing the executing record. Completion clears the continuation, which
releases its frame when no other references retain it.

`resumeGenerator` does not inspect or copy a yielded result. This is necessary for
`yield*`, where the delegate's result object can carry identity and observable
properties. Its completion-result hook runs after the continuation returns; the
Script adapter supplies the realm of the invoked method. Receiver validation uses
an internal object slot, not a named or inherited JavaScript property.

Runtime generator objects inherit shared next/return/throw methods and the iterator
identity method. GeneratorFunction and Generator prototype links and tags are
installed. Source generator functions are callable but not constructible; each has
its own writable, non-configurable instance prototype. Dynamic GeneratorFunction source construction first tries the narrow closed
profile, then compiles a general body through the shared managed Script pipeline.
The general path initializes parameters during the call, transfers the hidden
carrier's unstarted continuation, and selects the visible generator's prototype
after parameter side effects. Its [Node gate](results/generator-function-node-checkpoint-v1.json)
passes; the dedicated native fixture and unchanged constructor-group rerun are
queued, so this extension has no completed native conformance claim yet.

Synchronous generator declarations, expressions, object methods and class methods
(including static/private methods) execute natively. Calls eagerly initialize
parameters and hoisted declarations, then capture a lazy native continuation.
Methods retain their home object for super. Yield expressions split the lowered body into native closures; their retained cells keep source bindings and
temporaries alive across suspension. Resume guards consume injected next/return/
throw requests. Nested generators use independent continuation cells.

Blocks, branches, loops, conditional/short-circuit expressions and delegated yield*
suspend and resume natively. Branches rejoin shared continuations without replaying
previous statements. Delegation retains its iterator and invokes the following
continuation only on normal completion; return remains abrupt.

Try/catch handlers remain active across suspension. Finalizers retain pending
normal, return, throw, break and continue completions while yielding; a new abrupt
completion overrides the pending one. For-of uses the same routing for IteratorClose.
Labels and switch clauses also suspend, with named exits, loop backedges, clause
selection and fallthrough routed through the same continuation mechanism.

## Remaining work

- Expand unchanged Test262 selections and address semantic gaps they expose.
- Expand async-generator delegation and async iteration; Promise jobs and source
  async-generator suspension are covered in [async integration](async-runtime.md).
- Complete native validation and unchanged Test262 reruns for general dynamic
  GeneratorFunction bodies.
- Refine frame liveness. Captured lexical cells currently use conservative ordinary
  closure tracing; no native stack frame survives a yield.

Internal transfer outcomes connect native segments without recursive stack growth.
Each segment returns before its destination runs, preserving catch-scope boundaries.
Cleanup continuations capture a pending completion and share one lowered finalizer;
normal finalizer completion resumes that pending path, while a new abrupt completion
routes to the enclosing scope. This avoids duplicating the finalizer for every exit.

## Call entry and suspension boundary

The existing Script `callable` builder already emits parameter initialization,
arguments setup, body environments and hoisted declarations before body statements.
Generator creation and native body execution preserve that ordering:
defaults and destructuring run at call time, and may throw before an iterator is
returned. FunctionDeclarationInstantiation precedes selection of the generator
instance prototype. Body statements begin only on the initial next request.

The lowering separates those phases explicitly. Scope, receiver, home object and
temporaries live across yields are retained by native closure tracing. Yield returns a result from native code; resumption must dispatch
into a continuation segment without redoing call-time initialization. Parameter
defaults mutating the function's prototype, throwing parameter destructuring, and
return/throw before initial next are covered by native integration tests for this boundary.

See [EvaluateGeneratorBody](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-runtime-semantics-evaluategeneratorbody).

## Verification

Protocol tests cover lazy startup, injected completions, reentrancy, exceptions,
completed-state behavior, result identity and a return suspended by finally.
`verify-hosted-generators.ts` executes the protocol natively.
`verify-hosted-generator-objects.ts` exercises native object methods, receiver
checks, cross-realm completion results and suspended state under allocation
pressure. The existing Script fixture protects ordinary runtime behavior while
new internal slots and intrinsic methods are added.

Current regression evidence is maintained in [async integration](async-runtime.md).
The bare-yield/template parser fix passes both unchanged Test262 variants
in [its focused report](results/test262-yield-template-middle-native-v1.json). Native fixtures also compile and execute the
parser/continuation lowerer itself, exercise generator object methods and delegation
primitives, and retain a suspended source object across allocation pressure.

| Native Test262 selection                                                                        | Result                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [GeneratorPrototype.next](results/test262-generator-next-native-v1.json)                        | 28/28 pass                                                                                              |
| [GeneratorPrototype.return](results/test262-generator-return-native-v2.json)                    | 46/46 pass                                                                                              |
| [GeneratorPrototype.throw](results/test262-generator-throw-native-v1.json)                      | 44/44 pass                                                                                              |
| [Yield expressions](results/test262-yield-native-v7.json)                                       | 120/123 pass; 3 unsupported (with and RegExp)                                                           |
| [Declaration instantiation](results/test262-generator-declaration-instantiation-native-v1.json) | 2/2 pass                                                                                                |
| [GeneratorFunction baseline](results/test262-generator-function-native-v1.json)                 | 18/46 pass; 22 unsupported, 4 realm-dependent failures, 2 harness errors; predates source yield support |

Node 24.12 differs on prototype selection after parameter initialization. The
fixture retains separate Node and specified expectations, supported by the
unchanged declaration-instantiation Test262 case.

The [syntax-completion-v1 checkpoint](results/bootstrap-syntax-completion-v1.json)
self-hosted with byte-identical 55,981,610-byte images; both pass DWARF verification.
It includes the parser changes reaching 100% valid Test262 syntax acceptance, but
predates subsequent binding and runtime additions. Self-build parity does not
certify Script conformance. Use identical source-directory spellings in bootstrap
and native invocations when comparing debug images; DWARF records that spelling.

Normative reference:
[Generator abstract operations](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-generator-abstract-operations).
