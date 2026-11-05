# Allocation placement and interprocedural lifetimes

The objective is to avoid managed allocation when storage and lifetime can be
proved. Prefer eliminating the aggregate through scalar replacement. Otherwise
use bounded stack or caller-owned storage where safe; use managed heap storage
when a proof is absent or the chosen stack budget cannot accommodate it. A nursery
is a complementary heap policy, not another name for stack allocation.

## Function summaries

Analyze allocation sites and aliases, not just declared return types. Distinguish:

- Local objects whose aliases stay within this invocation.
- Objects or argument aliases exposed only through the return value.
- Objects retained through globals, externally reachable fields, escaping closures,
  unknown calls, foreign interfaces, or suspension.

Returning an object is an escape from one function, not necessarily from the
stack. Storing it into another object propagates a lifetime constraint along that
edge; it does not automatically force either object onto the heap. Capturing it
in a closure similarly inherits the closure's lifetime. Object size affects a
placement budget, not whether a reference escapes.

Summaries should describe returned argument aliases, returned allocation sites,
retained parameters, writes that publish references, suspension, and relevant
exceptional exits. Compute them over direct-call graph components to a bounded
fixed point. Unknown or exhausted analyses produce conservative summaries.
Retaining effects compose through callbacks and nested closures. Type annotations,
including readonly views, are not substitutes for alias and effect proofs.

## Caller-owned results without inlining

For a proved call site, reserve result storage in a suitable caller frame and
pass its address as a private hidden argument. The callee fills that destination
and returns the corresponding result. Forwarding functions can forward the same
destination to another callee. The object must never remain in a callee's expired
frame. Inlining can improve the result further but is not a prerequisite.

Treat "stack-ready" as an allocation-site summary conditional on the caller's
uses, not a property of the declared return type. A separately compiled callee
can report that a fresh result has no retained aliases. Each caller then either
proves a bounded stack lifetime, forwards the storage obligation to its own
caller, or selects managed allocation. This follows the static call graph and
alias flow; it does not require walking the runtime stack.

For example, `consume(forward(make()))` may reserve the result in `consume`'s
caller frame, with `forward` passing the hidden destination to `make`, provided
`consume` retains no alias. Repeated calls require distinct storage while their
results overlap in lifetime; returning alone never proves immediate consumption.

A function may need ordinary heap and caller-storage variants for different call
sites. Public/FFI calling conventions retain their declared boundary contract;
private specialization cannot silently change an exported ABI. A call that might
return an existing argument alias must distinguish that case from construction of
a fresh result, preserving identity and avoiding an unnecessary copy.

Choose a lifetime covering all uses and all reachable aliases. Account for
recursive calls, simultaneously live results, exceptions and finally blocks, and
objects returned through several forwarding frames. Suspension requires storage
that survives the suspended activation; a native machine stack address cannot be
assumed to do so. Dynamic extents or graphs that exceed a bounded stack reservation
fall back to managed allocation. Do not promote by copying unless every alias can
be updated coherently, including interior views and host references.

## IR, backend, and collector obligations

Represent allocation region and lifetime explicitly in IR. Analysis results must
identify the proof, compatible call variant, alias set, and required lifetime.
Keep the existing managed path available when a transformation is unsupported.

Scalar-replaced managed fields are ordinary traced local slots. Materialized
stack objects require explicit field tracing at safepoints, including during
partially completed construction. The current collector does not generally accept
stack addresses as managed object roots; merely classifying all stack addresses as
external would lose heap references stored inside those objects. Frame layout,
root maps, exceptional cleanup, and future deoptimization materialization must
therefore be extended together before publishing stack-object code.

Strict and live compilation should share the analysis and transformations. Live
mode may use guarded callee/shape assumptions, but invalidation must preserve
logical object identity and materialize any eliminated state before transferring
to generalized native code. The current implementation uses proved facts only.

## Implemented slice and next gates

`@tint/scalar-optimization` currently scalar-replaces fixed numeric/boolean records
created in a dominating straight-line entry prefix. It follows unique local
assignments, checks initialization/dominance, rejects observable object identity
and unproved uses, and turns field accesses into private local slots. Return-only
escape is classified separately but still uses managed storage. No caller-storage
ABI, nursery, moving collection, or general stack-object allocation is implemented.

Validation includes IR verification and a native fixture with branches, loop
mutation, and exact allocation accounting: the local record is eliminated while a
separate returned record remains allocated. Heap exhaustion behavior follows the
remaining allocations. Argument evaluation and other observable effects remain.

Next, expose reusable function-effect/escape summaries and verify them independently
on returned aliases, forwarding chains, cyclic object graphs, local versus escaping
closures, unknown calls, and exception paths. Then add one private caller-storage
return variant for a fixed scalar-only record and prove caller lifetime and stack
budget handling with native tests. Managed fields require collector integration
before extending that slice. Nursery allocation and promotion are a separate
runtime change requiring remembered old-to-young references and, if moving, complete
pointer-update contracts.
