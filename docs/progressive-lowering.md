# Progressive lowering

Status: design, 2026-11-12. Goal: generated-code speed. AOT may spend compile
time freely; compile time should stay reasonable but never decides against a
valuable optimization. Measure with `tools/feature-bench` (one realistic kernel
per language area, against Node), `tools/pattern-bench` and
`tools/frozen-workload.ts`.

## One pipeline, two budgets

AOT and runtime (JIT) compilation share the front end, HIR, patterns,
optimizer, instruction selection, register allocation and encoder, as
[the architecture](architecture.md) prescribes. They differ only in policy:
AOT runs every pattern and optimization phase with large budgets, while
runtime compilation runs the same patterns under tight budgets, deferring
expensive phases (applying them lazily to hot code) or skipping them.
Budgets are inputs to the pattern driver and the optimizer, never separate
implementations.

## Completeness first

Native compilation supports every language feature. Type information never
restricts what compiles; it only selects faster lowerings. Every construct
has a general HIR lowering with full JavaScript semantics (the semantics the
Script/Module path already implements through `@tint/js-engine` and the
js-runtime), and type facts (layouts, representations, purity, ranges) are
attributes that enable higher-benefit specialized patterns. A construct the
type facts cannot cover falls back to the general pattern, never to a
diagnostic.

Plain JavaScript already compiles completely: `@tint/js-engine` desugars
Script, Module and dynamic code into a TypeScript AST of runtime-helper calls,
which the shared checker, `@tint/ts-native` and optimizer compile. TypeScript
modules, however, enter the typed checker directly, and it rejects what it
cannot specialize instead of falling back to those general semantics: async functions and
`for await`, generators, destructuring, most class features (inheritance,
private elements, static blocks, accessors, computed members, decorators),
`var`, object spread, rest parameters, unannotated functions, local classes
and nested module statements, among about 110 `UNSUPPORTED` diagnostics. The
target is one front end: AST to HIR with general semantics, specialized by
facts. During migration, constructs the typed path rejects lower through the
general path as `general` values at their boundary, so mixed programs compile
while specializations are added.

## Typed and general code

Typed code keeps its type-based optimizations end to end; mixing typed and
general (untyped or unspecializable) code deoptimizes only where they touch.

- **Checked entries.** A typed function has a fast entry for typed callers
  and a checked entry for general callers. The checked entry validates each
  argument against its declared type, exactly as an explicit cast would; a
  failed check does not throw, it continues in a general version of the
  function, preserving JavaScript semantics when annotations are wrong.
- **Type escape analysis.** In closed-world AOT builds, a type whose values
  never reach general code may use specialized layouts and representations
  (compact records without presence or descriptor guards, unboxed fields).
  A type that escapes uses a general-compatible representation or is
  converted where it escapes. A function whose every call site passes
  concrete types specializes on them and needs no general fallback.
- **Boundaries.** Values entering typed code from general code are checked
  once; typed values entering general code are converted (or already
  general-compatible). Costs stay at these edges.
- **Open world.** Code that runtime compilation (`eval`, `Function`, loaded
  modules) can reach keeps checked entries and escape-safe layouts; the JIT
  runs the same analysis under its budget.

## Why

Today `@tint/ts-native` lowers checked TypeScript straight to the scalar IR
(basic blocks, mutable slots, block-local values) and the AArch64 emitter
selects instructions with special cases inside one large switch. By the time
an optimizer sees a loop, an iterator chain or a property access, the
structure that the most valuable optimizations need is gone:

- an iterator chain is several loops with intermediate lists and indirect
  callback calls, so fusing `filter` into `map` means rediscovering it;
- a loop is a set of blocks, so moving a whole statement out of it needs a
  bespoke CFG analysis per transform;
- instruction patterns (rotates, fused compares and branches, `x ?? 0`
  reads, membership tests) are hand-matched in the emitter, one at a time.

The feature benchmark's largest gaps are exactly these constructs: pipelines
7.7x Node, Map/Set 8.4x, typed numeric loops 6.5x, records 3.9x.

## Model

One op/region data model at every level. A level is a _dialect_: the set of op
kinds legal there, with a verifier.

- **Op**: kind, operands (values), results (typed values), attributes
  (constants, types, layouts, proven facts, tags) and nested regions.
- **Region**: an ordered list of blocks; blocks take arguments (SSA). A region
  is the body of a structured op (a loop body, a pipeline stage, a callback).
- **Value**: an SSA result or block argument with a type at its level.
- **Attribute**: immutable metadata. Facts proven by analyses (integer ranges,
  effect-free, loop-invariant, layout proven, fresh/non-aliased) are
  attributes, so later patterns can rely on them, and tagging a subgraph for
  an optimization is a region with attributes.

Mixed levels are allowed while lowering: a high-level op's region may contain
ops of any lower level. Lowering is complete for a level when every op is
legal in the next dialect.

### Levels

| Level | Dialect                           | Examples                                                                                                                                                                                         | Lowered by                                |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| HIR   | structured language semantics     | `loop` (init/test/step/body), `pipeline` (source, `filter`/`map`/`flat-map` stages, `collect`/`some`/`every`/`find`/`fold`/`for-each` sinks), `field.get` on unions, `list.read`, `closure.call` | patterns into MIR, after HIR optimization |
| MIR   | representation-explicit scalar IR | today's scalar IR: blocks, slots, `record`, `array-read`, `binary`                                                                                                                               | existing passes; patterns into LIR        |
| LIR   | target instruction groups         | AArch64 ops on virtual registers: `ror`, `cmp+b.cond`, `ldp`, family-word membership test, NEON lanes                                                                                            | register allocation and encoding          |

MIR stays the current scalar IR during migration, so every existing pass and
the existing emitter keep working; HIR is introduced above it and LIR below it
one construct at a time.

## Patterns

A pattern is a lowering or optimization rule, the analogue of a component's
render function:

```ts
interface Pattern {
  readonly name: string;
  readonly root: OpKind; // dispatch index
  readonly benefit: number; // higher wins among matches
  readonly match: (op: Op, context: PatternContext) => boolean;
  readonly rewrite: (op: Op, builder: Builder) => void; // emits replacements
}
```

`rewrite` replaces the op with other ops: higher-level ones are matched again
(recursive specialization), lower-level ones are kept. Several patterns may
match one op; the driver applies the highest benefit whose `match` holds, so
specialized variants (a pipeline over a typed array with an effect-free
arithmetic callback) win over general ones (a pipeline over any list), and
the general pattern always exists as the fallback.

The driver is a deterministic worklist over the op tree:

1. analyses attach facts to ops and values;
2. optimization patterns run to a fixpoint within a level (fusion, invariant
   motion, folding), each rewrite re-queuing affected ops;
3. legalization patterns lower every op illegal at the next level;
4. the next level's verifier runs.

Pattern lookup is indexed by op kind; storage uses typed arrays and arenas;
every phase has a work budget whose exhaustion is visible in pass statistics.
The framework stays inside the native TypeScript subset, because the compiler
compiles itself.

## Examples

**Invariant statement motion.** `loop` exposes its body region. An op in the
body whose operands are defined outside, and whose effects do not conflict
with the body's writes (effect summaries are attributes), moves to the
preheader. Whole statements move because a statement is a subtree of ops,
not a scatter of blocks.

**Iterator fusion.** ts-native emits
`pipeline(source = xs, stages = [filter(f), map(g)], sink = collect)`. When
`f` and `g` carry the effect-free attribute (fusion interleaves their calls,
which is observable otherwise), a pattern rewrites it to one `loop` that
pushes `g(x)` when `f(x)` holds, with the callbacks inlined as regions. A
later pattern sizes the output from the source length, and one for typed
sources with lane-independent bodies selects a vectorized loop.

**Instruction selection.** LIR patterns cover MIR expression trees:
`(x >>> n) | (x << (32 - n))` -> `ror`; a compare whose only use is the
block's branch -> fused `cmp`/`b.cond`; adjacent stack stores -> `stp`;
`typedArray[i] ?? 0` -> one checked load; field reads proven by a dominating
guard -> one `ldr`. The current emitter remains the fallback lowering for MIR
ops without an LIR pattern.

## Migration

0. **Completeness**: typed-path rejections become general lowerings (the
   Script/Module semantics at a `general` boundary), starting with the
   constructs ordinary programs use most (classes, destructuring, generators,
   async), so no program is refused; then the two front ends converge on HIR.
1. **Framework** in `@tint/ir` (`structured` subpath): op/region/attribute
   model, builder, pattern registry and driver, dialect verifiers, tests.
2. **HIR loops and pipelines.** ts-native emits `loop` and `pipeline` for
   `for`/`while`/`for-of` and array higher-order methods; legalization
   patterns produce exactly today's MIR (verified by the existing tests and
   self-build), then fusion, preallocation and invariant motion are added as
   HIR patterns.
3. **LIR selection** for one slice (integer and float arithmetic, compares and
   branches, typed-array access), first reproducing current output, then the
   patterns that are awkward in the emitter switch.
4. **Representation choices** (int64/double/optional) as MIR patterns with
   facts, replacing ad-hoc emitter decisions.
5. **Register allocation** over LIR virtual registers (lifetimes across
   blocks), replacing frame homes and the block-local temporary allocator.

Each step keeps the self-build fixpoint and the full gates, and is measured
on the feature benchmark against Node.
