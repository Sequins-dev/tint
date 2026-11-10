# Closure environments: assignment conversion and known calls

Status: step 1 implemented (2026-11-11); steps 2–3 designed. Refined from
external research and self-compile profiling.

## Current lowering

- Every captured binding except never-written parameters is a separate heap
  cell `{state byte, value}`. Each access is a `record-cell` terminator: a TDZ
  state check, an extra pointer indirection, and the end of an IR block.
- Each capturing function value gets its own environment record of cell
  pointers or values. Hoisted declarations build theirs at scope entry. A
  closure copies its incoming captures from that record into locals on entry.
- Nested declarations that capture anything are never called directly: a call
  between sibling helpers reads the helper's function value from its cell and
  makes a guarded indirect call. Inlining never sees these calls.

Self-compile measurements (program module):

- 3,593 captured bindings. Only 826 (23%) are ever reassigned; the rest are
  function declarations (1,321), `const` (1,097) and parameters (349, already
  captured by value).
- 2,694 bindings (75%) are captured by hoisted declarations.
- 14,483 indirect calls against 19,529 direct; 30,353 TDZ-checked cell
  accesses (7% of blocks).

## What other systems do

- **Chez Scheme**: flat closures (one indirection per free variable) plus
  _assignment conversion_: only assigned variables are boxed, everything else
  is copied into the closure. "Well-known" procedures (only ever called
  directly) are called through direct labels and often need no closure at all.
  Self-references and mutual references are eliminated, and procedures in one
  strongly connected component share a closure. Measured: over 50% of closure
  creation and access overhead removed; on Chez's own compiler, 47% of closure
  allocation and memory references. Never adds work relative to naive flat
  closures. [Keep, Hearn, Dybvig 2012]
- **SML/NJ**: flat closures with safe sharing cut heap allocation by 36% and
  variable fetches by 43%, about 17% faster overall. Linked (chained)
  environments are not safe-for-space. [Shao, Appel, TOPLAS 2000]
- **OCaml flambda**: mutually recursive functions form one "set of closures";
  calls between known members are direct.
- **V8 and Hermes**: captured variables live in chained context/scope records;
  uninitialised `let`/`const` hold a hole sentinel checked on each access.
  The TypeScript team replaced closure-captured `let`/`const` with `var`
  purely to avoid those checks and measured 1.5–13% speedups per compiler
  phase under V8. [TypeScript #52924]

Conclusions for tint: whole-program AOT knowledge allows the Chez model.
Prefer flat closures plus assignment conversion over V8-style chained scope
records, which add chain walks and are not safe-for-space.

## Design

1. **Assignment conversion.** Only bindings written after their initializer
   keep a cell. Every other captured binding (`const`, never-reassigned `let`,
   function declarations, parameters) is copied into the closure's record and,
   at closure entry, into a local slot: an ordinary slot access, with no cell,
   TDZ check or block split.
2. **Value capture must see an initialized value.** A closure is created
   after the binding is initialized when:
   - it is a function expression evaluated after the declaration; or
   - it is a hoisted declaration whose creation can be _sunk_ to just after
     the last initializer it captures. That is allowed when nothing can
     observe or call it earlier: no reference to it, and no call of any other
     hoisted function of the scope, before that point.

   Otherwise the binding keeps its cell with the TDZ state (current
   behavior). This is tint's analogue of Chez's letrec purification.

3. **Known functions and sharing.** A function declaration that is never
   reassigned and only called directly (well-known) needs no function value
   for those calls. Sibling helpers that reference each other form a strongly
   connected component that shares one environment record. Calls within it are
   direct and inherit the record, so mutual references disappear and the
   inliner can see the calls. Other known callees' records are captured by
   value in topological order.

## Order of work

Each step is gated by the native self-build and full Test262.

1. Assignment conversion with value capture where creation already follows
   initialization (function expressions, parameters, and hoisted
   declarations whose creation can be sunk).
2. SCC-shared environments and direct calls to well-known functions.
3. Re-measure, then extend the inliner to environment-inheriting callees.

Sources: [Keep, Hearn, Dybvig, "Optimizing Closures in O(0) time" (2012)](https://www.schemeworkshop.org/2012/papers/keep-hearn-dybvig-paper-sfp12.pdf);
[Shao, Appel, "Efficient and Safe-for-Space Closure Conversion"](https://flint.cs.yale.edu/flint/publications/escc.html);
[OCaml Flambda](https://ocaml.org/p/ocaml-base-compiler/4.13.0/ocamloptcomp/Flambda/index.html);
[Hermes IR](https://github.com/facebook/hermes/blob/main/doc/IR.md);
[TypeScript #52924](https://github.com/microsoft/TypeScript/issues/52924).

## Results so far

- **Step 1** landed (by-value capture plus per-function hoisted sinking). In
  a self-compile, 612 `const`s moved from cells to payloads at first; the
  remaining cells are 1,328 function bindings, 825 reassigned `let`s and a
  shrinking set of `const`s captured by early-referenced hoisted functions.
  Instructions 654.3G → 631.6G (−3.5%); image 20.66 MB → 20.00 MB.
- **Step 2 still targets the larger share.** In Chez's measurements, eliminating
  self-references and mutual references removed 45.6% and 32.6% of closure
  memory references. In tint that is the function-binding cells and the
  guarded indirect calls between sibling helpers.
- **Lambda lifting** (passing free variables as extra arguments) gave GHC only
  about 0.7–1% on average once known calls were already cheap, and it can
  increase allocation. Treat it as a later, selective refinement of step 2,
  not a replacement. [Graf, Peyton Jones, "Selective Lambda Lifting" (2019)](https://arxiv.org/abs/1910.11717)
- **Step 2 needs an IR extension.** A direct `call` to a function with a
  managed closure record must pass that record explicitly; today `inherit`
  only covers borrowed stack environments. Every pass that visits call
  operands (liveness, substitution, inlining, record flow) must learn the new
  operand.
