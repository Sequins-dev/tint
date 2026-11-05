# Explicit resource management

The reusable `@tint/js-runtime/disposal` package owns pending/disposed state and
resource-list transfer. It does not interpret callable values, create language
exceptions, run jobs, or bind operating-system resources. Closing detaches the
list before callbacks run; the embedding drains it in reverse registration order.
Moving transfers ownership once and leaves the source disposed.

The ordinary-object adapter supplies `DisposableStack` branding, realm-local
prototypes, observable disposal-method lookup, callback invocation and intrinsic
`SuppressedError` creation. A cleanup failure does not prevent remaining cleanup.
The latest failure becomes `error`, and the preceding failure becomes `suppressed`,
including when the thrown value is `undefined`. Cleanup never invokes a mutable
global error constructor.

Registration validates pending state before inspecting the resource. `use` passes
the captured resource list through method lookup; `adopt` and `defer` capture
callbacks without invoking them. `move` returns a fresh intrinsic stack and does
not consult an instance's constructor or species. Iterator disposal calls a
present `return` method and discards its result.

Both stack APIs have native conformance measurements. Async disposal shares
the ownership protocol, awaits normal cleanup results in sequence, and suppresses
failures while continuing cleanup. Synchronous fallback disposers ignore their
return values and convert thrown values into rejected intrinsic promises. Null
registrations ensure the required await boundaries.

Synchronous `using` lowering protects lexical blocks, function bodies and Script
bodies with cleanup on normal and abrupt completion. Registration precedes binding
initialization, preserving TDZ during method lookup. Cleanup includes an original
throw in the suppression chain. Native regressions also cover loop-header lifetimes and generator suspension.
A classic `for` initializer belongs to the whole loop; `for-of` resources belong
to each iteration and dispose before iterator closing. `await using` has native regression and complete selection measurements;
remaining gaps and failures are recorded in the dashboard. Async lexical cleanup uses the same mixed-resource drain as
stack disposal, preserving the original throw and awaiting asynchronous cleanup
before continuing an enclosing completion. A compiler-owned await operation resumes
that continuation in the final disposal job; lexical cleanup must not add a wrapper
Promise reaction. Cleanup reports whether an Await was
actually reached: unreachable declarations and synchronously throwing async
disposers do not introduce a suspension merely because the scope is async. Synchronous resources in mixed scopes
ignore return values; empty async resources establish the specified await boundary
before a following synchronous disposer. Measurements belong in the
[Test262 dashboard](test262.md), rather than this design contract.
