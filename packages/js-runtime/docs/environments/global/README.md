# Global and object environments

This package composes declarative and ordinary-object binding records into lexical
scope chains. Retain a `BindingReference` across RHS evaluation: re-resolving its
name can change the target after user code mutates the environment.

`createObjectEnvironment` and `createObjectScope` supply the binding operations
needed by `with`. Resolution checks inherited properties before reading
`Symbol.unscopables`; only an object-valued filter is consulted. Reads, writes and
deletes through an already resolved reference do not consult that filter again.
Deletion before a strict read or write produces a reference error; a sloppy write
can recreate the property. Property access preserves the binding-object receiver.

`getBindingThisValue` returns the binding object for calls through a with-environment
reference, and undefined for other environment references. This implicit call
receiver is distinct from a function's lexical `this` binding.

The host supplies canonical name keys, object views, truthiness and ordinary-object
call hooks. Proxy interception is not implemented by these ordinary-object records.
`createWithScope` provides the Script adapter, including primitive boxing before
scope entry. Script parsing and lowering use this API; strict source rejects
`with`.

Verification: `test/object-scope.test.ts` covers resolution and mutation ordering;
`tools/verify-hosted-object-environment.ts` executes the same core operations in a
native fixture. Neither is a Test262 conformance result.

Reference: [ECMAScript object environment records](https://tc39.es/ecma262/2025/multipage/executable-code-and-execution-contexts.html#sec-object-environment-records).
