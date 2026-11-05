# Runtime-compiled tagged-template sites

The current slice enables tagged templates in Script, eval and constructed-function
bodies compiled through the managed entry. The [native feature gate](../results/managed-template-feature-acceptance-v1.json)
passes ten semantic checks at the frozen source. The [twelve unchanged cache variants](../results/managed-template-cache-conformance-acceptance-v1.json) pass; the [complete directory](../results/test262-language-tagged-template-current-v1.json) passes 48/48. Native fixtures remain separate evidence.

Each successful parse already receives a fresh ScriptRecord carrier. The carrier
now owns an ordered list of TemplateSite records. Managed compilation moves only
validated, explicitly typed template-recipe declarations into the entry prologue,
where getScriptTemplateSite returns the carrier's record for that ordinal. Equal
text never establishes identity. Each constructed Function retains its compiled
carrier, while a fresh eval receives a fresh carrier even when its effective
ScriptOrModule is inherited from the same caller.

The existing realm-owned getTemplateObject cache still creates and freezes the
observable cooked/raw arrays. Tag evaluation precedes template-object lookup;
substitutions follow it. The entry prologue creates internal recipe records only.
Generic managed compilation continues rejecting arbitrary module initialization.
Malformed recipes fail before descriptor reads, linking or publication.

The complete workspace gate passes 4,394 tests, types, dependency boundaries and
formatting. The [surface census](../results/managed-template-surface-census-node-v3.json)
records 133 vocabulary entries, 172 signature classes, 197 record classes and
437 runtime slots. Its comparison uses the immutable prior census, rather than
loading an old registry against current runtime sources.

The [bootstrap graph comparison](../results/managed-template-bootstrap-graph-node-v1.json)
shows all 220 modules and their syntax unchanged from the accepted native compiler.
This allows reuse of that compiler. The native gate exercises changed runtime/lowering behavior through: repeated calls, fresh evals, distinct sites, Function caching,
undefined cooked values, evaluation order, realms, allocation churn, async
suspension and catchable missing-tag errors.

The tools are frozen once for the accepted source. Execute the six unchanged
runtime-cache files in language/expressions/tagged-template, preserving all twelve
variants and original harnesses. Record this focused selection separately from a
complete directory report. Historical reports and partial observations remain
separate evidence.

The [native cache fixture](../results/native-managed-template-cache-runtime-v1.json)
passes owner/ordinal identity, separate parses, realm separation and retention
through allocation churn. This is a bespoke runtime check, not Test262 evidence
or proof of compilation inside the image. The retained large-image attempts
include a timeout and pre-entry launch failures; see the
[launch analysis](../results/managed-template-launch-analysis-v2.json).
The end-to-end gate, twelve-variant follow-up and complete 48-variant directory pass under the frozen V19 toolchain. The subset overlaps the complete directory and is not added to its totals.

The async identity fixture originally exceeded the existing per-entry code cap:
273,248 emitted bytes against 262,144. Its native unsupported observation remains
in the [budget analysis](../results/managed-template-async-budget-analysis-v1.json).
The revised bespoke loop avoids collecting results in an extra array and emits
241,008 bytes while still visiting the same tagged site after each await. The cap
and all unchanged Test262 sources remain unchanged. Tests pin rejection before
reads/publication for the oversized body and successful compilation for the
bounded one. The bounded loop and the catchable missing-tag case now pass natively. The gate retains eight unchanged passing cases from the prior fixture image at the identical portable source, with explicit per-image provenance.
