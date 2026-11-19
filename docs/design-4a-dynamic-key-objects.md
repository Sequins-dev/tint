# Typed dynamic-key objects in slice 4a

The C1 implementation uses ordinary realm objects with typed access and
enforced property contracts. The plain-object result of
`node:os.networkInterfaces()` depends on C2.

## C1 implementation status

- String index signatures, broad string `Record`, and fixed-key `Record`
  annotations have checked representations. Closed finite records dispatch
  finite string-union keys through their existing fields.
- Indexed literals, reads and writes, membership, deletion, enumeration and
  spread use the ordinary realm operations. Own enumeration returns realm
  arrays, including fixed two-position entry pairs.
- Storage contracts validate existing descriptors before enrollment. The
  general host and typed code obtain the same realm from the module instance.
  The compiler brings the helper closures into the lexical scopes that use
  them so the existing closure lowering supplies their state. A program whose
  checked graph has no dynamic objects leaves the runtime namespace unlinked.
- Mixed JavaScript callers can pass and receive typed indexed objects through
  an identity-preserving boundary. The generated adapter uses a checked
  projection at entry. The declaration resolver follows imported type aliases
  and interfaces.

Unannotated computed literals expose `unknown` reads while their storage is
open. Compound writes and updates on indexed objects, realm allocation for a
fixed record that needs ordinary enumeration, and conversions between realm
enumeration arrays and native lists still require lowering work. Numeric and
symbol index declarations and general tuple shapes remain outside C1.

## Current behavior

The diagnostics below were reproduced on `eb1d822db89f747d0ad9a76d8400352704e8732c`
with `parseModule` followed by `checkClosureModule`. The indexed-operation
probes use a finite object type because an index signature or `Record`
would fail before its operations were checked. Paths are relative to the
workspace root.

| Probe in typed code                                                                       | First result and source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ [key: string]: number }`; the same signature in an interface with a fixed field        | `SYNTAX_ERROR: expected ]` at the colon. `propertiesBody` calls `propertyName()` at `packages/typescript/src/syntax/parser.ts:1042`; the bracketed name parses an expression and expects `]` at :847–848. `expect` emits the message at :499.                                                                                                                                                                                                                                                                                                                                                                               |
| `Record<string, number>`; `Record<"a" \| "b", number>`                                    | `INVALID_TYPE: incorrect type argument count for Record`. `named` falls through to declaration arity checking at `packages/typescript/src/checker/interfaces.ts:254–264`.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `{ [key]: 1 }` with `key: string`                                                         | `UNSUPPORTED: typed dynamic object keys require dynamic layout support` at `packages/typescript/src/checker/closures.ts:2979–2989`. The parser already produces a dynamic key expression at `packages/typescript/src/syntax/parser.ts:845–865,2695`.                                                                                                                                                                                                                                                                                                                                                                        |
| `{ ["a"]: 1 }`, followed by `x.a`                                                         | Accepted. The parser folds the literal key at `packages/typescript/src/syntax/parser.ts:849–861` and the checker resolves the fixed property at `packages/typescript/src/checker/closures.ts:3297–3361`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `{ __proto__: null }`                                                                     | `UNSUPPORTED: typed prototype setters require prototype layout support` at `packages/typescript/src/checker/closures.ts:2990–2999`; the parser marks the special syntax at `packages/typescript/src/syntax/parser.ts:2703–2708`.                                                                                                                                                                                                                                                                                                                                                                                            |
| `x[key]` with `x: {a: number}` and `key: string`                                          | `TYPE_MISMATCH: expected an supported numeric typed array`. Dynamic access falls into `requireArray` at `packages/typescript/src/checker/closures.ts:3408–3419`; the message is at :1166–1168.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `x[key] = 1` with the same types                                                          | The same `TYPE_MISMATCH` through `requireArray` at `packages/typescript/src/checker/closures.ts:4903–4926`, message at :1168.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `key in x`                                                                                | `UNSUPPORTED: unsupported binary operator: in` at `packages/typescript/src/checker/closures.ts:5134–5139`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `delete x[key]` with `x: {a?: number}` and `key: string`; `delete x.a` on the same object | The first fails with `TYPE_MISMATCH: expected an supported numeric typed array` because the unary checker checks the operand as a read (:5142–5143, :3416, :1168). The second reaches `UNSUPPORTED: unary operation is unsupported` at `packages/typescript/src/checker/closures.ts:5166`.                                                                                                                                                                                                                                                                                                                                  |
| `Object.keys(x)`, `Object.entries(x)`, `Object.values(x)`                                 | `UNKNOWN_NAME: unknown value name: Object` at `packages/typescript/src/binding/index.ts:540–542`. An explicit result annotation of `[string, number][]` also needs tuple syntax, which currently reports `SYNTAX_ERROR: expected identifier` at the opening `[` (`packages/typescript/src/syntax/parser.ts:505`, type alternatives at :1118ff.).                                                                                                                                                                                                                                                                            |
| `for (const key in x) {}`; `for (key in x) {}`                                            | `UNSUPPORTED: typed for-in lowering is not implemented` at `packages/typescript/src/binding/index.ts:1160–1167`; assignment form reports `UNSUPPORTED: typed iteration assignment lowering is not implemented` at :1148–1155.                                                                                                                                                                                                                                                                                                                                                                                               |
| `{ ...x }` with `x: unknown`; with `x: {a: number}`                                       | The first reports `UNSUPPORTED: object spread requires finite object source variants` at `packages/typescript/src/checker/closures.ts:3058–3080`. Finite-record spread and a subsequent read of `a` passed the probe through that same code.                                                                                                                                                                                                                                                                                                                                                                                |
| Pass an indexed object through a module boundary                                          | The signature itself fails as above. The current bridge classifier recognizes primitives/unknown and eligible named interfaces, and returns no boundary for a function with an unrepresentable signature (`packages/compiler/src/native/general-partition.ts:117–156,284–358`). A general caller can use a checked record view for eligible fixed interfaces. A typed importer of a general module is moved to general (:405–435). Trying to return a raw `unknown` directly as a typed fixed object reports `TYPE_MISMATCH: value does not match its declared type` at `packages/typescript/src/checker/closures.ts:1189`. |

## Type checking

The reference is the workspace's TypeScript 6.0.3 (`package.json:48`) with
strict mode, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`
(`tsconfig.base.json:9–11`).
The following decisions were checked with that compiler.

- `{[k: string]: number}` and `Record<string, number>` accept `{}`,
  `{ready: 1}`, `{[name]: 1}`, and an appropriate structural source.
  An anonymous object type or alias can supply an implicit index signature
  when its known fields fit. An interface with only fixed fields lacks that
  implicit signature. Preserve that source distinction in the relation
  metadata. A locally declared or imported `Record` shadows the intrinsic.
- Both string and number expressions may index the string signature.
  Number keys go through JavaScript property-key conversion. Boolean,
  object, and symbol keys fail static indexing against the string signature.
  A symbol from general code remains an ordinary property outside that
  signature. In the pinned reference, `keyof {[k: string]: T}` is
  `string | number` and `keyof Record<string, T>` is `string`. Retain their
  origin for this distinction when `keyof` is supported. General `keyof`,
  mapped types, and numeric, symbol or pattern index declarations are
  outside this slice. Preserve the explicitly declared C numeric view path
  in `packages/native-runtime/src/c/ffi.d.ts:51`.
- A mixed object uses the precise declared field type for a known key
  (`{name: "ok"; [k: string]: string}` reads `x.name` and `x["name"]` as
  `"ok"`). Reject `{name: string; [k: string]: number}` at the declaration.
  With the workspace options, `{x?: number; [k: string]: number}`
  is accepted, while `x?: number | undefined` fails the same index
  signature unless its value type also admits `undefined`. Use the
  signature as a fallback for dot syntax under current options. Preserve
  explicit field modifiers and check interface bases and intersections.
- A read through the signature has type `T | undefined`; type-level
  `D[string]` is `T`. A write through the signature uses `T` itself and
  rejects `undefined` unless permitted by `T`. A known fixed key takes its
  declared type. The checker must compute both the read union and the
  intersection of allowed write targets for a finite key union.
  `delete d[k]` is allowed through a writable signature. `delete m.name`
  and `delete m["name"]` fail when `name` is required. Readonly indices
  reject assignment and deletion. Match TypeScript's delete check for a
  finite multi-key union, which accepts `delete pair[k]` in the pinned
  compiler even when a single known required key would be rejected. Route
  the former through runtime deletion, with required-slot handling below.
- `Record<"a" | "b", number>` resolves to two required fixed properties.
  Preserve its record layout for closed uses. `pair[k]` works for
  `k: "a" | "b"`; a broad string key and `{a: 1}` fail. For finite-key
  indexed reads/writes covering only fixed-layout records, lower a key
  dispatch over existing field operations. If the value needs ordinary
  enumeration, deletion, a prototype, or passage through a dynamic object
  boundary, select realm representation for its allocation and aliases.
  A computed name of union type does not prove that every key was supplied.
- `key in d` returns boolean. An arbitrary string and a `for…in` binding
  do not remove `undefined` from `d[key]`. A presence check with a stable
  literal key can narrow that indexed expression as in the reference.
  Invalidate that fact after writes and calls as with other property facts.
- `Object.keys(d)` has type `string[]`, `Object.values(d)` has type
  `T[]`, and `Object.entries(d)` has type `[string, T][]` for the
  index-signature overload. Use the installed library's applicable
  overload for mixed or finite cases, including the broad overload when
  appropriate. `noUncheckedIndexedAccess` still applies when indexing
  the result array. The entry's positions 0 and 1 have their tuple types
  once the entry is present. A local `Object` binding follows normal
  call checking.

Distinguish definitive type diagnostics for these constructs from unsupported
native lowering. `checkTypedProgram` currently flattens the checker result to
a message (`packages/compiler/src/native/index.ts:1041–1057`), and
`compileArm64Program` tries fallback after failure when configured (:558–574).
Carry the diagnostic kind through that boundary for this feature. In
particular, fallback must preserve a rejected explicit assignment or missing
required property. An inferred dynamic literal gives useful type facts to
typed consumers and leaves its storage open, per Tint's inferred-slot policy.

## Representation and contracts

Use the realm's existing `OrdinaryObject<ScriptPropertyKey, unknown>` value
and category-5 reference identity. The native checker type retains the
index value and fixed field types while the scalar ABI uses its existing
`general` encoding. Primitives, BigInt and realm object references use the
existing boxing and projection operations. An ordinary object retains
identity across repeated calls, aliases, upcasts, and general code.
`viewObjectValue` is the current descriptor-checked embedding entry
(`packages/js-runtime/src/objects/values.ts:67–74`); reuse that binding
rather than treating every category-5 payload as an object.

A typed dictionary could unbox T and speed a hot own-property access. It
would also need descriptor semantics, ordered string and symbol keys, live
prototypes, and a cached view whose RC/GC lifetime agrees with the dictionary
identity. The same property would then have two addressing paths and would
need shared write enforcement and invalidation. Use the ordinary object now.
A measured future specialization can accelerate proven own writable data
properties via the existing object storage and retain one identity.

**Attach explicit property contracts to storage.** Follow the precedent of
the slice 2b view's checked setters. The generated adapter projects a value
before assigning the typed field
(`packages/js-engine/src/program/index.ts:399–415`); the runtime dispatches
field definitions to that setter and restricts deletion
(`packages/js-runtime/src/objects/record-views.ts:82–103,150–173`).
For a dynamic object, keep one optional private contract field on the realm
object and keep the ordinary internal methods. An immutable contract graph,
shared per declared type within the build, describes string-index type,
explicit fixed keys, readonly/required flags, literals/unions, and nested
array or structural requirements. The runtime interprets its primitive tags
and descriptor tests without JS coercion. For a string covered by both fixed
and index rules, apply both; a widened alias cannot weaken a narrower slot.
Contractless instances incur a null check on mutation and carry no contract
graph per instance.

- **Birth and crossing.** Construct a contextually annotated literal with
  its write constraints in place from the first definition. An initialization
  phase permits initializing readonly slots, followed by required-field
  validation. Install compatible contracts at explicit local/field
  initialization or reassignment, parameter entry, explicit return and checked
  `unknown as D` projection. General-to-typed entry uses the same operation.
  For an existing object, first validate current own data descriptors and
  required fixed fields without invoking JS getters or proxy traps. Separate
  validation from publication for the whole reachable contract graph; use
  visited object/schema pairs for cycles. Conjoin additional compatible
  contracts, retain previously enrolled contracts when the value escapes,
  and reuse identical enrollment. Reject incompatible admission before
  modifying any part of the graph. Inferred slots, contextual inference
  alone, and erased aliases add no write rule. Automatic downcasts use the
  available runtime predicates or issue a specific build diagnostic for an
  unsupported contract kind.
- **Commit point.** Put the check in
  `objects/operations.ts:ordinaryDefineOwnProperty` immediately before an
  accepted descriptor becomes storage (:509–576), including absent-value
  creation, in-place updates, and the packed array branches (:515–539)
  when arrays carry element contracts. Route the contracted branch of
  `setProperty`'s direct cell and packed updates (:855–910) through that
  check; keep its existing fast paths for open objects. Validate the _effective_
  descriptor, including implicit `undefined` on a newly defined data
  property with no value. Rejected ECMAScript descriptor changes keep their
  normal completion. An otherwise permitted incompatible value throws the
  realm TypeError before mutation or nested enrollment, including for sloppy
  assignment and `Reflect.defineProperty`. As in JavaScript, operations
  with multiple individual writes can leave earlier successful writes in
  place. Prototype mutation itself changes no typed data slot.
  Supply error creation with the active realm via the runtime contract
  context, with the owning realm as the embedding fallback. Keep all
  checks and contract publication inside the individual storage operation.
- **Audit direct writes.** Disable `refreshPropertyCell` and
  `cachedPropertyCell` for contracted receivers and invalidate the epoch on
  first attachment (`operations.ts:752–791`). The global-environment
  `putBindingReference` fast path writes a cached cell directly
  (`packages/js-runtime/src/environments/global/scope.ts:236–253`).
  Leave `writePropertyCell` private to audited fast paths, or require the
  owner and key if a new direct caller needs it. Check other direct mutations
  of `properties`, descriptor values, array elements, and aliases.
  `aliasDataProperty` (:313ff.) is used for mapped arguments
  (`packages/js-runtime/src/objects/arguments.ts`). Keep
  such objects outside enrollment until their corresponding write paths
  can uphold the same invariant. Array unpacking (:578–592) and array
  length truncation (`packages/js-runtime/src/objects/arrays.ts:113–153`)
  only transfer or remove already stored elements. Verify every packed
  write, fill, push, and descriptor creation still goes through the
  contract. For proxies forwarding writes to an enrolled target, the
  target is checked where it actually stores the value.
- **Reads and prototype behavior.** Ordinary `[[Get]]` traverses the
  prototype and passes the original receiver to getters. Untyped reads
  return that raw result. Typed projections validate inherited values,
  values from open objects, and any slots lacking a proof. If a typed
  consumer relies on T and finds an incompatible inherited value, raise a
  realm TypeError at the required typed projection; absence yields
  `undefined` where admitted. An inferred read that can continue in general
  representation retains the actual value, with a guard and general
  operation when the speculative type fails. A contracted own data slot can
  eventually use its proven type without rechecking, provided the owning
  property and the applicable contract are both proven.
- **Declared-slot policy.** Protected own keys represent data slots. Reject
  accessor installation at covered keys and reject admission when an own
  covered accessor already exists. Inherited setters still run with the
  original receiver when ordinary Set selects them. Check any data write
  they actually make. Protect required declared fixed fields against
  deletion by a widened or untyped alias; optional and index-only keys
  remain deletable under ordinary descriptor rules. A required fixed field
  admitted from general code must currently be an own data property.
  Put the deletion policy in `ordinaryDeleteProperty` (`operations.ts:650`),
  including calls forwarded by ordinary internal methods.
  These deliberate Tint restrictions make contract validation free of
  user-code effects and preserve named-slot guarantees. Admit ordinary
  objects and the explicitly supported realm arrays for nested element
  types. A contract admission on a proxy or otherwise unsupported exotic
  is an explicit boundary TypeError. Open objects and unannotated
  JavaScript retain descriptor, proxy and prototype semantics.

**C1 value representations.** Dynamic objects carry values whose general
representation preserves identity. C1 admits primitives, BigInt, unknown,
string-literal unions, nested dynamic objects and optional forms of these.
Native lists and fixed records report `UNSUPPORTED: <type> values in
dynamic-key objects need slice 2b list/record views`. A copy or raw box of
a native aggregate would lose ordinary property behavior or identity.

**C2 follow-up.** Function-local allocation can choose realm arrays and
ordinary records for literals whose references only flow into dynamic
properties. C1 has no allocation-site worklist across calls or joins.
The Node OS consumer below needs C2 because each interface-name property
holds an array of structural records.

**Mixed modules.** General callers pass the same object as an argument to a
typed export and receive it back directly. Add a boundary descriptor for
the realm representation in `general-partition.ts` and adapter generation
in `js-engine/src/program/index.ts`. Resolve inline signatures,
`Record<string, T>`, aliases and indexed interfaces through imported type
names, including optional values. Expand the generated adapter's
`toGeneral`/`fromGeneral` paths (:479–519) to forward a single object
and enroll at typed entry using the shared projection. Apply the same
rules to returned values and admitted immutable exports. The
descriptor must remain distinct from a slice 2b view witness.
The first mixed fixture has a JS caller exercising inputs and outputs of
typed exports in both directions. A typed module directly importing a
general module remains a slice 3 partition limitation. This plan requires
neither that import direction nor evaluation of general source from a
typed program.

## Observable semantics and lowering

| Operation                    | Required behavior and existing runtime path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Literal definition           | Evaluate source entries in order. Evaluate and run `ToPropertyKey` on a computed name before evaluating its value. `["__proto__"]`, a dynamic expression yielding it, and shorthand named `__proto__` create data. Bare colon `__proto__` is the special prototype setter. Reuse `createObject`, `createDataProperty` (`operations.ts:289,594`), `propertyKeyValue` (`coercion.ts`), and `setObjectLiteralPrototype` (`values.ts:27`). [Object initializer evaluation](https://tc39.es/ecma262/#sec-object-initializer-runtime-semantics-evaluation).                                                                                                                                                                                                                                                                                                 |
| Read, assignment             | Check base and evaluate receiver/key once, preserving optional chaining and short-circuiting. For simple assignment, evaluate the base and key expression, evaluate RHS, then convert the key for PutValue and store. Return the original RHS; abrupt completion stops the operation. Use `readObjectValueProperty` and `setObjectValueProperty` (`values.ts:224,250`) with lexical strictness and realm errors. `obj["__proto__"] = v` uses ordinary setter lookup, including the inherited legacy setter if installed. [Computed reference evaluation](https://tc39.es/ecma262/#sec-evaluate-property-access-with-expression-key), [OrdinaryGet](https://tc39.es/ecma262/#sec-ordinaryget), [OrdinarySet](https://tc39.es/ecma262/#sec-ordinaryset).                                                                                                |
| `in`, `delete`               | Evaluate both operands of `in` before testing the RHS object and converting the key. `[[HasProperty]]` includes prototypes and does not invoke getters. Delete operates on the receiver's own key and returns true if absent; a failed deletion in strict code throws. Use `objectValueHasProperty` (`membership.ts:9`) and `deleteObjectValueProperty` (`values.ts:311`), independently of getter-based reads. [Relational operators](https://tc39.es/ecma262/#sec-relational-operators-runtime-semantics-evaluation), [delete](https://tc39.es/ecma262/#sec-delete-operator), [OrdinaryHasProperty](https://tc39.es/ecma262/#sec-ordinaryhasproperty).                                                                                                                                                                                              |
| `Object.keys/values/entries` | The current realm's Object methods apply the shared own-enumerable traversal. Snapshot keys once, then recheck each descriptor. Only values and entries get the values, in that order and with that receiver. Own keys use array indices 0 through 2³²−2 in numeric order, other strings in creation order, then symbols in creation order. These three methods skip symbols. Updates retain order; deleting and re-adding a non-index string gives it a new position. Reuse `ownPropertyList` (`object-intrinsics.ts:313–385`) and `ownKeys`/`ordinaryOwnKeys` (`operations.ts:935–981`); classifier at `enumeration.ts:19–30`. Return actual realm Arrays, including entry pairs. [OrdinaryOwnPropertyKeys](https://tc39.es/ecma262/#sec-ordinaryownpropertykeys), [EnumerableOwnProperties](https://tc39.es/ecma262/#sec-enumerableownproperties). |
| `for…in`                     | Reuse `enumerateObjectValue` (`values.ts:45`) and `nextEnumerableProperty` (`enumeration.ts:51–73`). Visit own enumerable strings first, then each prototype in order. A visited nonenumerable own key shadows a prototype key. Skip a deleted unvisited key and ignore symbols. Nullish inputs do not enter the body. Preserve distinct captured lexical bindings per iteration, the assignment form, labels and abrupt completion. Respect the specification's latitude under mutation. [EnumerateObjectProperties](https://tc39.es/ecma262/#sec-enumerate-object-properties).                                                                                                                                                                                                                                                                      |
| Spread                       | Reuse `copyObjectProperties` (`spread.ts:9`), which applies nullish/ToObject handling and calls `copyDataProperties` (`copy.ts:16–35`). Copy own enumerable strings and symbols by Get and CreateDataProperty. Source getters can throw or delete a later key. The destination keeps its prototype and its own contract, and copied values go through its write check. Preserve the finite existing specialization where equivalent. [CopyDataProperties](https://tc39.es/ecma262/#sec-copydataproperties).                                                                                                                                                                                                                                                                                                                                           |

## Implementation map

1. **Syntax and type store.** In `typescript/src/syntax/model.ts`, give
   object types and interfaces an optional index-signature member with
   name, key/value type, span and readonly declaration. In
   `syntax/parser.ts:propertiesBody`, distinguish a bracketed parameter
   and colon from a computed named property. Thread the member through
   `syntax/rewrite.ts:rewriteModule`, `syntax/key.ts:encodeSyntax`,
   linker type rewriting in `ts-native/src/modules/index.ts:linkModules`,
   specialization in `modules/specialization.ts:specializeModule`, and
   `typescript/src/reify/{index,print}.ts`. Verify erasure and type walk
   consumers preserve traversal. Retain absent-member syntax keys for
   existing sources where possible. Extend `types/index.ts`'s object
   kind with optional string-index metadata. Update graph validation and
   copying (`graphDepth`, `append`, `copyType`), relations
   (`objectRelation`, `solveRelation`, `exactShape`), and
   `computeProperty`, `writeProperty`, and contextual `object`.
   Include the edge in recursion, hashing, interface memoization and
   reification. In `checker/interfaces.ts`, extend `named`, `object`,
   `resolve`, `intersect`, and `indexed`. Reduce finite `Record` to
   existing fixed properties and retain index origin separately from its
   runtime layout. Add just fixed tuples for entry pairs as a distinct
   array-like type and matching AST/reifier case; general tuple rest,
   optional tuple elements and variadic inference can follow separately.
2. **Bind and check operations.** Update the typed global allowlist in
   `checker/closures.ts:checkClosureModule` for `Object`. Remove the `for-in` gates in
   `binding/index.ts` for the forms implemented here. In
   `checker/closures.ts`, add indexed access and enrollment facts to the
   object construction, member, index, assignment, call, unary and binary
   branches, and add loop checking for both `for-in` forms. Factor key
   selection and write-target checking across dot, bracket and delete.
   Type contextual computed values and spread entries in source order.
   Record `intrinsics.set` tags for the realm operations and entry
   projections, with `checker/index.ts:ExpressionInfo` carrying the
   runtime target and the separately resolved static result type.
   Treat the raw property result as general until projected, including
   union optionality and literal-string tests. Reuse the checking path
   for compound/logical assignment and updates wherever supported, or
   fail those unimplemented forms explicitly while the slice is staged.
3. **Shared realm and runtime wiring.** Extract the object/hooks/realm
   core of the generated `programRealm`
   (`js-engine/src/program/index.ts:605–623`) to a public, lazily initialized
   `js-runtime/src/objects/program-realm.ts` module. The generated host
   uses it to add its global environment, module loader and installer
   set. Typed calls use the same realm, including any module execution
   context selected by the agent. Feed typed intrinsic needs into installer
   selection (`js-engine/src/program/intrinsics.ts` for the mixed host);
   install Object and any required Array functions once, with the same
   global properties and identities. Typed calls to mutable realm methods
   resolve the actual method and receiver. Native fast calls require
   proof of builtin identity. Depend on the defining modules through
   public package exports. Add a thin `native-runtime/src/values/dynamic-object.ts`
   adapter for general-value ABI, key conversion, ordered call wrappers
   and realm errors, and one `dynamic-object` runtime namespace using
   the BigInt pattern. Register it in `compiler/src/project.ts:runtimeSources`,
   resolve helpers in `ts-native/src/runtime/index.ts`, and visit the
   callable IDs in `runtime/function-ids.ts`. In
   `compiler/src/native/index.ts:linkTypedProgram`, retain/import helpers
   when the linked feature uses them and wire descriptor-checked object
   views into pure typed builds using existing record bindings. The
   existing view registrations are general-host requests
   (`js-engine/src/program/index.ts:57–77`,
   `compiler/src/native/index.ts:592–619`). Deduplicate them in mixed
   builds. Root no general host, module evaluator, or unrelated installer
   merely because the program knows the type name. Update the runtime's
   export map and regenerate the compiler catalog for new sources.
4. **Select layout and emit.** In `closure/lowering/records.ts`, make
   `entryType` and `createRepresentationMemo` select `general` for
   realm-backed aliases and their carrying unions. Exclude those from
   `createRecordContracts` layout discovery, `indexObjects`, `record`,
   and closed-record construction/spread plans. Carry representation
   choices across ABI arguments/results, list elements, cells and
   captures. In `closure/lowering/index.ts:lowerEntries`, validate
   adapter signatures, wire checked contract data, map intrinsics to
   typed call targets and traverse both loop forms for captures. In
   `ts-native/src/scalar.ts:expressionValue`, lower object, member/index,
   assignment, binary, unary and call cases to existing call and
   boxing/projection operations. Use temporaries for evaluation ordering;
   preserve reference and RHS results, narrow on the result edge, and
   reuse the optional chain branches. In `statement`, use the existing
   CFG loop structure with a runtime enumerator state and
   `string | undefined` exhaustion sentinel. Implement fresh lexical
   cells for captured loop bindings, and use ordinary reference writes
   for assignment-form targets. For realm arrays and entry pairs reuse
   realm indexing, method dispatch and iteration; leave native-list
   lowering in place for proven native lists.
5. **IR and codegen.** Plan uses existing calls, branches, record
   construction for immutable contract metadata, checked downcasts and
   the `general-record-is` descriptor check
   (`ts-native/src/scalar.ts:2225–2257`,
   `ir/src/scalar/model.ts:37`). No new IR opcode, storage codec entry,
   or AArch64 instruction/emitter path is expected. If an implementation
   step discovers a missing primitive, review it first, then add the
   model, exhaustive storage opcode table and
   `packages/ir/test/function-store.test.ts` round-trip sample together
   with the backend handling.

## C2 consumer

`packages/native-runtime/src/node/os.ts:245–248,279–284` currently allocates
a typed Map, gets a group by name, and sets a new array for a missing
group. `os-darwin.ts:160–162` and `os-linux.ts:160–162` expose that
return type. The fixture substitutes Node's own reported names for
enumeration and asserts `.size`, `.has` and `.get`
(`tools/native-os-fixtures.ts:55–75`). The defect is recorded at
`docs/native-ffi.md:1476`.

- Return `Record<string, NetworkInterfaceInfo[]>` from `shapeInterfaces`
  and both platform wrappers. The result starts at `{}` with the realm
  Object prototype. Construct entries in their current order and retain
  the conditional own IPv6 `scopeid` at `os.ts:265–278`. The
  representation demand flows back through `existing.push(entry)` and
  `[entry]`, so these are actual realm Arrays of ordinary realm entries.
- Group on own names. For an existing own group, read by `result[item.name]`
  and push. For a new name define an own enumerable, configurable,
  writable data property. Use the shared realm `Object.hasOwn` and
  `Object.defineProperty` path (limit the typed descriptor surface to
  data descriptors for this consumer). The same mutation guard checks
  the array value. Node 24.12.0 uses `result[name]` and assignment;
  using an own-only grouping definition deliberately handles synthetic
  names such as `__proto__` and `constructor` without touching the
  prototype. The normal OS interface output has Node's plain-object
  shape. [Pinned Node implementation](https://github.com/nodejs/node/blob/v24.12.0/lib/os.js).
- Update the typed fixture to enumerate using `Object.keys` and read
  groups by name. Compare its order, values, missing group and own-field
  shape to Node; add deterministic synthetic grouping coverage and a
  mixed general caller that observes `Array.isArray`, record fields,
  mutation through aliases, and stable identity. Preserve FFI reads,
  platform wrappers, address formatting and the existing allocator
  variants. Remove the known-defect references once both consumers pass.

## Validation and risks

- Add `tools/build-typed-dynamic-object-fixture.ts`,
  `tools/typed-dynamic-object-fixture-source.ts` and
  `tools/typed-dynamic-object-fixture.test.ts`. The typed-only JS-parity
  fixture uses `TINT_GENERAL_FALLBACK=0` and `TINT_BUILD_ONLY=1`,
  returns 42 or the first numbered failure, and runs under Node as
  well as LLDB. Include computed keys and duplicate creation, numeric
  key conversion, keys `"2"`, `"10"`, `"4294967294"`, `"4294967295"`,
  `"01"` and `"-0"`, overwriting vs deleting/re-adding, `"__proto__"`
  in all literal forms, inherited reads and setters, `in` without
  getters, strict deletion, enumeration shadowing and loop mutations,
  `keys/values/entries` and pair types, abrupt completion in spread
  operands, and once-only receiver/key/value evaluation. Run symbol-key
  enumeration and spread with a getter that deletes a later key or
  throws using a general-created source in the mixed fixture.
- Add `typed-dynamic-object-contracts` (native-only) and
  `typed-dynamic-object-mixed` (separate mixed build). Import typed
  exports from general code the way
  `tools/verify-hosted-general-trusted-import.ts` exercises a boundary;
  verify partition evidence that the producer stays typed. Check
  incompatible typed writes through a checked projection, foreign
  writes through index/upcast/aliases, JS assignment/Reflect/
  `Object.defineProperty` and `Object.assign`, missing-value descriptors,
  required/readonly modifiers, rejected enrollment without partial
  effects, sloppy foreign assignment, packed array element mutation,
  prototype behavior on inherited mismatch, and liveness across
  collections. Check unchanged values and property order following
  failures. Also check a separate unannotated object's foreign writes
  stay open and that numeric-looking keys need the same contract as
  other strings. Node reference covers only JavaScript-parity cases;
  the native-only fixture records the deliberate contract restrictions.
- Add accept/reject and inferred-type tests in
  `packages/typescript/test/checker-closures.test.ts`, parser/rewriter/key
  tests for signatures and entry tuples, and through-compiler diagnostics
  for type failures with fallback enabled. Test declaration scope that
  shadows `Record` and `Object`, type aliases and import rewriting,
  narrow fixed-name reads, missing keys and values, readonly checks,
  reserved prototype syntax, finite key unions and interface bases.
  Use pinned tsc as the static reference for both positive and negative
  cases. Add runtime unit tests for define/set guards, array fast paths
  and property-cell cache invalidation.
- In `tools/unified-pipeline/corpus.ts`, add typed/untyped pairs
  `dynamic-object-literal`, `dynamic-object-index`,
  `dynamic-object-in-delete`, `dynamic-object-own-enumeration`,
  `dynamic-object-for-in`, `dynamic-object-spread` and
  `explicit-dynamic-property-contract`. Run each typed construct with
  `TINT_GENERAL_FALLBACK=0 TZ=UTC` and check both modes against the
  prior ledger. Existing `object-records` (:92), `spread` (:229),
  `object-reflection` (:584), and `explicit-field-contract` (:769)
  provide regression comparisons; update scoped expectation only when
  the feature already covers the construct.
- **Self-hosting.** At the base SHA, a tracked-source scan for
  `Record<` and `[identifier: string/number/symbol]` found no use in
  `packages/*/src` besides the numeric declaration in
  `packages/native-runtime/src/c/ffi.d.ts:51`. Host tools and tests
  do use `Record`. Keep bootstrap implementation sources in the
  established subset, including runtime helpers, even when test inputs
  exercise the new feature. Pre-existing helpers are themselves typed
  over `unknown`; ensure AST and type graph changes remain compatible
  with cached linker and specialization signatures.
- **Size and speed.** A design-only baseline built with
  `verifyHostedFixture` from `export function run(): number { return 42; }`
  at the base SHA is **595,389 bytes**, with stopped-at-entry and final
  exit 42 asserted under LLDB. Hosted manifest source snapshot SHA-256
  `bce2423fd229130fed9cb666bb0c049324fcc6485122596570d5c21d84d6adfb`
  (769 files), image SHA-256
  `2e34d9dff0dcd25b3e3a9ff060a6f43889a8896d965bc665e693fcd13cd189e2`.
  The slice 1 examples measured about 4.2 MB for a pruned objects
  import and 9.8 MB with only error/object/function installers
  (`docs/unified-pipeline.md:450–459`). These are historical examples,
  not predictions. Measure the same control on both revisions, then
  variants for create/read/write, keys, entries and the OS consumer,
  recording bytes, contributing modules, startup and fixture manifests.
  Check a pure typed program with no dynamic feature for byte equality.
  Benchmark own hits, inherited/missing reads, writes to existing keys
  vs new keys, enrollment and realm enumeration. Primitive projection
  and normal existing-key update should allocate no object; the two
  likely costs are generic descriptor dispatch and pulling in the
  current coarse realm installers (`errors.ts:625–630`). Measure
  frozen v7 cycles on both sides with `--runtime-tree` if existing
  generated code changes. Do not introduce cache or representation
  optimizations until the performance counters identify a cost.
- **Boundaries.** Normal typed records and arrays already provide GC
  tracing for an optional graph field and metadata. This design assumes
  no new pointer encoding, stack-map change, startup rule, image layout,
  image writer, spill-file machinery, or FFI implementation change.
  A need in any of those areas requires coordinator review before work
  proceeds. The largest open feasibility question is how much realm and
  Array machinery the pure typed link retains. The size gate must measure
  actual helper selection before broader adoption.

## Ordered implementation gates

1. Land index-signature AST and type relations, finite `Record` and
   diagnostic classification. Gate parser/rewrite/reifier, pinned tsc
   comparisons and focused checker tests. Existing source keys and the
   native subset check must pass.
2. Land the ordinary-object contract primitive and shared lazy realm.
   Gate runtime mutation-path tests, existing JS object tests,
   the native subset check and pure typed control size. Keep it
   independently testable before emitting typed object syntax.
3. Wire realm layout selection and literal/member/index assignment,
   reads, `in` and `delete` through scalar lowering. Gate typed-only
   and Node parity fixtures and the new core corpus cases. Include
   compiled negative diagnostics with fallback enabled.
4. Add enumeration, spread and entry tuples. Gate owned/inherited
   enumeration, mutation and shadowing, prototype semantics,
   lexical capture and abrupt completion in the typed-only parity
   fixture and typed corpus.
5. Complete C1 dynamic module boundary adapters. Gate native-only contracts and the mixed
   JS/typed fixture with identity and partition evidence. Exercise existing 2b record adapters as a regression.
6. In C2, convert `node:os` and run its platform fixture with both
   existing allocators. Gate plain-object shape for typed and general consumers.
   Update the convergence section and mark the gap removed after the
   evidence is available.
7. Before merge, run `pnpm build`, the complete native compiler subset
   test, `env -u TZ pnpm check`, frozen source capture and LLDB stage2
   and stage3 with successful inferior exits and byte-equal `cmp`.
   Run both Test262 pre-merge host smoke linking modes and the gap ledger
   against the latest full slice 4a baseline. Preserve LLDB admission
   failures in the report and use a separately labelled recheck. Record
   timing and image measurements as described above. Verify every exit
   status, retain immutable evidence, and keep the tree fixed during
   long gates.
