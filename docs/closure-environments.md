# Closure environments: shared scope records

Status: proposed (2026-11-11). Motivated by self-compile profiling.

## Current lowering

- Each captured `let`/`const`/function binding is its own heap cell record:
  `{state byte, value}`. Every access is a `record-cell` terminator: a TDZ
  state check, an extra pointer indirection, and the end of an IR block.
- Each capturing function value gets its own environment record of cell
  pointers (or values, for never-written parameters). It is built when the
  function value is created; hoisted declarations build theirs at scope entry.
- A closure reads every incoming capture from its environment once, at entry,
  into local slots.
- Nested function declarations that capture anything are never called
  directly (`directFunctions` drops them). Calls between sibling helpers load
  the helper's function value from its cell and make an indirect call with
  function-record and signature guards. Inlining never sees these calls.

Self-compile counts (program module): 2,282 of 3,311 functions capture;
14,483 indirect calls against 19,529 direct; 30,353 TDZ-checked cell
accesses, 7% of all blocks.

## Proposal

1. **One environment record per scope instance.** The record's fields are the
   captured bindings owned by that scope, so there are no per-binding cells.
   The owner reads and writes its captured bindings as fields of that record.
   Closures hold pointers to the scope records they use (a flat list, as
   today), not one pointer per binding. Per-iteration `for` bindings get a
   fresh record each iteration, as `copyIterationCells` does now.
2. **Direct sibling calls.** A never-reassigned nested function declaration
   whose environment is exactly records the caller already holds is called
   directly, passing those records (the IR's `inherit` environment when they
   match). Its function value is still created for escaping uses. This makes
   factory helpers ordinary direct calls, eligible for inlining.
3. **TDZ only where needed.** A binding needs a state byte only if a capturing
   function could run before the binding is initialised. Conservatively it is
   safe when:
   - every capturing function expression appears textually after the
     declaration in the binding's scope;
   - no hoisted function of that scope is referenced before the declaration
     completes;
   - the owner has no textual reads before the declaration.

   Safe bindings get plain fields: unguarded reads and writes, no block split.

4. **By-value capture** stays for never-written parameters, and extends to
   TDZ-safe `const` bindings copied into a closure's own record.

## Order of work

Each step is gated by the native self-build and full Test262.

1. TDZ-safety analysis plus plain fields for safe bindings (smallest step;
   removes state checks).
2. Shared scope records (removes cells and per-closure records).
3. Direct sibling calls with environment passing (unlocks inlining).
