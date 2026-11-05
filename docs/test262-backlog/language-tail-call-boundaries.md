# Proper tail calls: language call boundaries

The complete unchanged call selection now passes [**171/171**](../results/test262-language-call-tail-transfers-v1.json), including all six proper-tail-call cases that previously faulted after entry. The original [165/171 fault triage](../results/language-call-tail-fault-triage-v1.json) remains retained. The new report uses the accepted 566-file frozen source; it is not a whole-language pass rate.

## Implementation and evidence

Strict ordinary functions, arrows and methods now use invocation-owned tail
transfers. The lowerer marks eligible call positions, captures the callee,
receiver and arguments, checks callability, and requests a transfer. The existing
call driver loops over typed internal steps after the source execution context
has been restored. Returned JavaScript values cannot impersonate transfers.
Nested calls own separate frames and restore their parent on both normal and
abrupt completion. No scheduler, interpreter or unchecked cast was added.

The source callback retains its four-argument ABI. Bound functions and
`Function.prototype.call`/`apply` forward through the same driver, preserving
argument order, receivers and constructor processing. Intrinsic direct eval
keeps its caller context; a shadowed identifier named `eval` can transfer like
any other callable.

| Gate                                                                   | Result                                                 | Evidence                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Workspace types, tests, boundaries and formatting                      | 4,334 tests pass                                       | `.tint-bootstrap/tail-lowering-workspace-check-v2.log`                         |
| Dispatch, invocation ownership and parser-backed position analysis     | Native fixtures pass                                   | [Preparation](../results/tail-call-preparation-native-validation-v1.json)      |
| Source factory and construction                                        | 100,000 transfers pass                                 | [Source factory](../results/tail-source-factory-native-validation-v1.json)     |
| Bound forwarding and construction                                      | 100,000 transfers pass                                 | [Bound factory](../results/tail-bound-factory-native-validation-v1.json)       |
| Call and apply forwarding                                              | 100,000 transfers per method pass                      | [Call/apply](../results/tail-call-apply-factory-native-validation-v1.json)     |
| Transfer arguments across moving GC                                    | Payload survives 50,000 remaining allocating transfers | [GC](../results/tail-transfer-gc-factory-native-validation-v1.json)            |
| Intrinsic versus shadowed eval                                         | Native fixture passes                                  | [Eval guard](../results/tail-eval-candidate-factory-native-validation-v1.json) |
| Actual lowered JavaScript                                              | Ten 100,000-call cases pass                            | [AOT lowering](../results/tail-lowering-native-validation-v1.json)             |
| Compilation inside the native image, linking, publishing and execution | 100,000 recursive calls pass                           | [Managed entry](../results/tail-in-image-native-validation-v1.json)            |
| Frozen native self-build and stage-image identity                      | Running                                                | Acceptance pending                                                             |
| Unchanged call selection                                               | Pass: 171/171 on the accepted frozen snapshot          | [Complete rerun](../results/test262-language-call-tail-transfers-v1.json)      |

All native fixtures run under LLDB with initial-stop and final-exit checks.
These bespoke results are separate from Test262 conformance. The low-level
source/forwarding fixtures use a 1 MiB stack and 4 MiB managed heap; increasing
those limits was not used to establish bounded execution.

The AOT cases cover direct recursion, an evaluated callee, member calls,
optional calls, tagged templates, call/apply and three shadowed-eval binding
forms. The managed case compiles its recursive function through `$262.evalScript`
inside the image before executing it.

## Position and context boundaries

[EvaluateCall](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-evaluatecall)
and the [tail-position rules](https://tc39.es/ecma262/multipage/ecmascript-language-functions-and-classes.html#sec-tail-position-calls)
define eligibility. The implementation propagates positions through grouping,
conditional branches, the final comma operand, short-circuit right operands and
eligible statement bodies. Nested functions have independent owners.

- Sloppy, async and generator functions retain ordinary calls.
- For-of bodies retain their iterator-closing work.
- A try body retains its catch/finally work. Only an eligible catch without a
  finalizer, or the finalizer itself, can finish the containing function.
- Live resource-disposal scopes prevent transfer. Switch clauses conservatively
  share their disposal state.
- Callability and argument collection happen before removing the caller.
- Source realm, effective Script identity, thrown identities and constructor
  return processing survive the transfer.
- Arrow `new.target` remains lexically inherited; it does not identify whether
  the arrow itself was constructed.

## Measured surface and remaining work

The live surface has 196 record classes and 169 signature classes, 96 collection
anchors, 50 runtime providers, 429 operation slots and 43 runtime ABIs. Provider,
slot and ABI counts are unchanged. The three new registry helpers increase the
full vocabulary from 128 to 131 entries; the existing eight import-free lowering
hashes remain unchanged. These are Node measurements, not native conformance.

The current slice enables ordinary functions, arrows and methods. Raw class
constructor callbacks remain outside this lowering change. Proxy forwarding also
needs a separate slice: an apply trap must preserve the embedding's
`ObjectHooks.call` contract rather than bypassing it to invoke an internal
callback directly. No Proxy hook behavior is changed here.

A [frozen Node lowering census](../results/language-tail-call-preparation-census-node-v1.json) confirms that all 34 positive feature variants prepare and select the tail factory and transfer helper. This does not establish execution outcomes.

The [pinned feature census](../results/language-proper-tail-call-census-node-v1.json)
contains 34 language variants, including the six call-group cases. The other
variants span logical/conditional/comma expressions, tagged templates and
control-flow statements. Their population is not a pass forecast.

The frozen self-build and artifact checks pass. The earlier pre-entry launch failure remains in its [immutable observation](../results/bootstrap-language-tail-calls-v1.json); a separate launch control passed before the accepted build.

The unchanged 171-variant call rerun and 184-variant super selection both pass. Continue assignment and iterator completion, then function/environment and control-flow groups. Preserve the original failures and all native observations; do not merge focused checks into old totals.
