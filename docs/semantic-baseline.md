# Semantic baseline and implementation freedom

Status: agreed design principle.

## Start from the specification

ECMAScript defines Tint's baseline observable language behavior. TypeScript is the
guide for additional syntax and static typing. Consult the relevant specification
algorithms and requirements before proposing different behavior. Existing engines
are useful implementation references and differential-test targets, not authorities
that override the specification.

Dynamic mode preserves JavaScript behavior even when TypeScript's static contracts
are violated. Strict/native mode may reject explicitly identified unsound constructs;
accepted programs retain the applicable JavaScript behavior. A different storage
layout is not permission to silently change arithmetic, identity, evaluation order,
coercion, closure behavior, or exceptions.

Tint's strict profile is distinct from ECMAScript strict mode. Its additional
compile-time restrictions must be documented separately.

## Separate semantics from mechanisms

For each design decision, classify it as:

1. Specified behavior: implement it and identify the relevant requirements/tests.
2. Explicit host/implementation latitude: choose within the specification's bounds
   and document that choice.
3. Internal mechanism: select an implementation that preserves observable behavior.
4. Tint extension or strict-profile restriction: state its scope and rationale
   explicitly, using closely related specification concepts where possible.

The specification's abstract records, environments, and execution contexts describe
semantics; they need not become identically shaped runtime objects. Physical layouts,
register assignments, GC root publication, and internal calling conventions remain
implementation work. Use the simplest mechanisms consistent with the required
semantics and self-hosting goals, and evolve them without changing the language.

## Application to the next design work

- Memory/lifetime: preserve observable identity, aliasing, and liveness requirements,
  including weak-reference/finalization semantics when supported. Collector strategy,
  moving versus non-moving storage, and root encoding are implementation choices.
  Internal arenas must not free values still observable outside their phase.
- Calls/closures: preserve argument evaluation, binding, receiver, lexical environment,
  return, and construction behavior as applicable. Registers, frame layouts, closure
  environment storage, and entry adapters implement those behaviors.
- Exceptions: follow completion propagation and cleanup semantics, including finally
  and iterator cleanup where applicable. Explicit result propagation or native
  unwinding is a mechanism choice, not a different exception language.
- Numbers/strings: preserve specified numeric and string behavior. Unboxing and
  alternate internal encodings must not introduce different overflow, negative-zero,
  indexing, or code-unit behavior.
- Concurrency: distinguish agents/jobs and shared-memory requirements from OS threads
  and scheduling. A first single-threaded implementation does not redefine the
  specification's concurrency model.
- Host services/intrinsics: file I/O, executable-memory publication, foreign ABIs,
  and raw-address operations need explicit host/internal contracts. Prefer existing
  language patterns where suitable; do not present extensions as standardized APIs.

When behavior is unspecified, first look for related language operations and host
hooks that provide a consistent model. Discuss genuine choices rather than reopening
specified behavior. Similarity to the spirit of the spec supplements normative
requirements; it does not replace them.

## Working method

The [initial conformance baseline](conformance-baseline.md) pins TypeScript 6.0.3
and ECMAScript 2025, and separates checker, runtime, builtin and host coverage.

Each foundational design note should name its semantic requirements, implementation
choices, and verification cases. Record a versioned conformance baseline before
claiming coverage; the living specification is a research reference, not an implicit
commitment to every current proposal. Unsupported features remain visible gaps.

The immediate task is a specification-grounded runtime contract for self-hosting:
identify required semantics first, then choose layouts, roots, calls, and host
primitives that implement them. Do not require a complete engine before compiling
Tint's own source.

## References

- [ECMAScript overview and hosts](https://tc39.es/ecma262/multipage/overview.html)
- [Execution contexts and environments](https://tc39.es/ecma262/multipage/executable-code-and-execution-contexts.html)
- [ECMAScript shared-memory model](https://tc39.es/ecma262/multipage/memory-model.html)
