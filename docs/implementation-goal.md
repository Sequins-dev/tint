# Active implementation goal

Implement broad JavaScript and TypeScript language coverage while preserving
native self-hosting. The eventual conformance target is **over 90% of the complete
pinned Test262 suite passing through Tint's native execution pipeline**, with
coverage comparable to established runtimes on the same test population.

The current user-directed work combines Test262 behavior expansion with
[incremental framework consolidation](framework-consolidation.md).
Keep the compiler running through each migration slice, preserving native
self-hosting and conformance evidence. This reorganizes the system supporting the
coverage goal; it does not replace its eventual completion criteria.

## Priorities

The current user-directed priority is foundational `language/*` execution
semantics: bindings, scope, evaluation order, calls, control flow, classes and
iteration. Object/Array internals are addressed when a reproduced language failure
requires them; broad built-in API coverage follows the language work. The
[core focus](test262-backlog/core-language-object-array.md) tracks this sequence.
Full-suite measurement and compiler-performance work remain deferred.

Use Test262 gaps to select independently verifiable implementation slices:

**Syntax gate completed:** all 103,264 pinned Test262 variants pass native
acceptance/early-error validation; see the [coverage dashboard](test262.md).
The active phase is execution semantics and standard APIs, targeting over 90%
whole-suite native behavior passes. Preserve the syntax gate throughout.

1. Complete JavaScript syntax **and execution semantics**, including early errors,
   Script/module environments and strict/sloppy behavior. Bring forward standard
   APIs when unchanged test harnesses require them.
2. Finish object and class semantics, destructuring/rest, iterator protocols,
   generators, Promise/jobs, and async functions, iterators and generators.
   These remain feature families to complete, not declarations that earlier
   implementation slices cover every case.
3. Expand TypeScript checking and native lowering, including generic inference
   and class contracts. Keep intentional strict-profile restrictions explicit;
   do not confuse missing implementation with a soundness restriction.
4. Complete missing standard APIs and host facilities required for broad suite
   execution. Run the full pinned suite to establish the actual pass rate.

Adopt supported language features in compiler code when they improve structure.
Use classes for suitable stateful owners; keep independent algorithms and immutable
syntax data separate. Preserve shared compiler infrastructure and native output
throughout. Working practices and validation rules live in [AGENTS.md](../AGENTS.md).

## Completion criteria

- The full pinned Test262 run exceeds 90% native passes under a recorded variant
  policy. Unsupported cases, failures, harness errors, crashes and timeouts remain
  in the denominator. Compare other runtimes only on matching populations.
- Implemented feature paths preserve language semantics, including evaluation
  order, abrupt completion and resource/lifetime behavior, with semantic tests
  and native execution evidence. Parser acceptance and Node reference results
  are separate measurements, not native conformance passes.
- TypeScript features have checked native execution paths and explicit documented
  restrictions. Preserve native self-builds against frozen sources, stage-image
  comparisons, and debug-information verification for debug builds.

The previous self-build performance goal is complete. Build time is not the
completion criterion for this goal. A completed feature slice or status update
is not completion of the overall objective.

## Where details belong

| Information                                          | Document                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Feature inventory, gaps and specification baseline   | [Language coverage](language-coverage.md)                                                    |
| Measured native selections and syntax inventory      | [Test262 dashboard](test262.md)                                                              |
| Runner contract, commands and limitations            | [Test262 runner](test262-runner.md)                                                          |
| Immutable run evidence                               | [Results](results/)                                                                          |
| Strict/live behavior and type restrictions           | [Language profiles](language-profiles.md)                                                    |
| Class representation and lowering                    | [Native classes](native-classes.md)                                                          |
| Sloppy block-function binding and var copies         | [Web legacy bindings](annex-b-bindings.md)                                                   |
| JSON grammar, serialization and reviver contracts    | [JSON runtime](json-runtime.md)                                                              |
| Numeric algorithms and Math intrinsic boundaries     | [Math runtime](math-runtime.md)                                                              |
| Date and shared calendar boundaries                  | [Date runtime](date-runtime.md)                                                              |
| Locale identifiers and internationalization services | [Intl runtime](intl-runtime.md)                                                              |
| Duration relative arithmetic, rounding and precision | [Duration runtime](duration-runtime.md)                                                      |
| Disposal ownership and cleanup completion            | [Resource management](resource-management.md)                                                |
| Unicode normalization algorithms and String API      | [String normalization](string-normalization.md)                                              |
| RegExp parser, matching and object adapters          | [RegExp runtime](regexp.md)                                                                  |
| Suspension and asynchronous execution                | [Generators](generators.md), [async runtime](async-runtime.md)                               |
| Runtime source parsing and native code publication   | [Native code loading](native-code-loading.md), [managed linking](managed-runtime-linking.md) |
| Bootstrap and self-hosting architecture              | [Bootstrap](bootstrap.md)                                                                    |

Keep this document limited to the objective, priorities and completion criteria.
Update current status in its owning document rather than appending a progress log.
Older chronological notes are retained in the [historical archive](archive/implementation-progress-through-generators.md)
for targeted investigation, not routine context loading.
