# RegExp runtime

RegExp support shares a portable pattern AST between literal validation and runtime
construction. It does not delegate matching to Node or a host regular-expression
library.

## Responsibilities

- `@tint/regexp-syntax` owns flags, pattern validation, captures, Unicode property
  aliases and Unicode-set syntax.
- `@tint/regexp-engine` compiles that AST into an ordered matching program and
  executes it with explicit backtracking state and a bounded work budget.
- `@tint/js-runtime/objects` owns JavaScript RegExp objects, coercion, descriptors,
  constructor behavior, prototype operations and match arrays.
- Script lowering creates each literal through the realm's intrinsic prototype,
  independently of the mutable global `RegExp` binding.

## Current behavior and limits

The native Script fixture covers construction/copying, fresh literals, `exec`,
`test`, `toString`, source/flag accessors, species, captures and named groups,
match indices, global/sticky `lastIndex`, overridden `exec`, and observable
coercion/property-access ordering. Match positions are UTF-16 offsets. Global and
sticky failures reset `lastIndex`; zero-length matches do not advance it inside
`exec`. Non-global execution still performs the required `lastIndex` conversion.

Matching supports alternatives, repetitions, backreferences, lookaround, scoped
ignoreCase/multiline/dotAll flags, and Unicode sets with string members. Native
engine fixtures cover legacy uppercase canonicalization and Unicode simple folding,
including the distinct `u`/`v` property-complement ordering. Tables are pinned to
Unicode 17.0.0, with checked source digests and reproducible generation. General categories,
scripts, script extensions and binary character properties use the reusable
`@tint/unicode-properties` package. Unicode properties of strings use the official Unicode 17 emoji sequence and
ZWJ sequence tables, generated with checked source digests. All seven string
properties, including `RGI_Emoji`, compile through the existing Unicode-set string
matcher, preserving set intersection/subtraction, longest-first matching,
backtracking and lookbehind. Matching uses sorted, case-folded property tables
rather than scanning every string alternative. The [joined-corpus native fixture](results/regexp-indexed-string-properties-native-v1.json)
retains its pre-fix budget failure and verifies whole-corpus forward/reverse matching
and case folding after indexing. The [native red/green fixture](results/regexp-string-properties-native-red-green-v1.json)
checks the matching path; the [host corpus](results/regexp-string-properties-host-corpus-v1.json)
checks 15,812 property/union relations against the official input files. These
fixtures are separate from unchanged Test262 selection results; complete reruns
and frozen self-build acceptance remain pending.
Valid patterns outside the matching subset can still be constructed and inspected;
attempting unsupported matching reports unsupported execution. The default matching work allowance grows linearly with UTF-16 input length,
with a one-million-step floor; explicit embedding budgets remain absolute limits.
A [native red/green fixture](results/regexp-default-work-budget-native-red-green-v1.json)
covers a 1,000,001-character linear search and an explicit budget override, retaining
the initial small-fixture resource fault. Work-budget exhaustion reports unsupported
execution, never a false no-match result. Greedy single-character repetitions keep
compact backtracking checkpoints instead of cloning repeat state for every
character. A [native regression](results/regexp-compact-repetition-native-v1.json)
retains the old allocation trap and verifies 1.1-million-character matching,
zero-minimum fallback, captures, Unicode reverse matching, sets and modifiers at
the standard 256 MiB resource limit.

`Symbol.match` and `Symbol.search` now share RegExpExec, preserve overridden
`exec` results, and cover Unicode empty-match advancement and observable
`lastIndex` restoration in [native fixtures](results/native-regexp-match-focused-v1.json).
`Symbol.replace` and String match/search/replace/replaceAll pass
[native regression cases](results/native-string-regexp-focused-v1.json), including
overlapping custom matches, capture getters, callback ordering and early dispatch.
Split and matchAll also pass [native regression cases](results/native-regexp-matchall-focused-v1.json).
`RegExp.escape` covers literal-text escaping, including lone surrogates and
leading ASCII characters, with [native fixtures](results/native-regexp-escape-focused-v1.json).
RegExp string iterators preserve re-entry rejection, completion after exceptions
and creation-realm resumption; [state/realm fixtures](results/native-regexp-iterator-state-focused-v2.json)
cover the cases where Node 24.12 differs from ES2025. Full selection coverage,
remaining cross-realm cases remain incomplete. Legacy RegExp statics and `compile`
implement the [legacy-features proposal](https://github.com/tc39/proposal-regexp-legacy-features):
state belongs to the constructor realm, accessors require the intrinsic receiver,
subclass matches invalidate state, and borrowed cross-realm execution leaves it
unchanged. [Native regression cases](results/native-regexp-legacy-focused-v1.json)
cover ownership, invalidation, coercion order and compilation. The complete
[Annex B selection](results/test262-annexb-regexp-native-v1.json) passes 120/124
variants; four require unsupported dynamic eval. The full Script fixture passes natively;
that does not establish full RegExp conformance. See the [Test262 dashboard](test262.md)
for completed unchanged selections and their limitations.

The unchanged generated ASCII-property harness compiles and has
`String.fromCodePoint` available (22/22 native builtin variants pass). With the
runner's uniform 64 MiB heap, both ASCII variants time out. The earlier 4 MiB run
trapped during input construction; its failed observations remain in v3. Array
index classification now avoids general numeric-conversion scratch allocation.
Before indexed maps, a diagnostic suspension during input construction reached linear
`linked-map.findMap` through array property assignment. Reusing `key-index` for
map lookup needs the reference-array contracts introduced by helper specialization.
Runtime preparation now discovers those transitive contracts with progress checks
and the existing specialization budget. Indexed maps now use the shared key index
and pass native collision, identity, cursor and 10,000-key growth/deletion checks.
The complete generated ASCII selection still times out after this change (v5);
its remaining execution cost needs fresh diagnosis. These results do not establish
property matching failure or success. The smaller unchanged character-class
selection passes 2/2 natively.

## Initialization and native bindings

The object adapter imports pattern tables that require module initialization.
Its `RuntimeSource.retainedExports` lists only the native object/symbol/BigInt view
stubs, leaving other declarations and dependency state in normal module-instance
initialization. Explicit record bindings still authorize each native view; retaining
an export does not grant capabilities.
