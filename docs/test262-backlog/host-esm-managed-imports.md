# Dynamic import in runtime-compiled entries

The remaining two runtime-unsupported variants in the original dynamic-import
report call `import()` from eval. The shared lowerer previously rejected import
calls in eval and dynamic Function entries, and the image's managed helper table
did not export `evaluateImportCall`.

The current implementation uses the same import helper in Script, eval and
Function entries. The helper reads the active Script or module through the
existing checked record views. No new frame, host loader, code arena or scheduler
is introduced. Operand evaluation remains synchronous; specifier conversion and
load failures use the existing promise rejection path.

The captured lowerer exports a capability marker. Historical snapshots retain
their previous helper vocabulary, generated host text and adapter. With the marker,
the host binds both referrer views even when only the Script evaluator is used.
Script-root graph discovery also recognizes import calls inside embedded runtime
source, retaining original fixture hashes before resume checks. Undiscovered
relative specifiers remain unsupported.

[Node surface comparison](../results/managed-import-surface-census-node-v1.json)
measures 131→132 vocabulary entries, 108→109 helper values and 170→171 signature
classes. Record classes remain 197, runtime providers 50 and operation slots 429.
These are measured against the immediately preceding frozen source, not older
planning census figures. Import-free lowering hashes remain unchanged. The full
workspace gate passes 4,389 tests, type checks, dependency checks and formatting.

The [complete bootstrap graph comparison](../results/managed-import-bootstrap-graph-node-v1.json)
finds all 220 compiler modules and their linked syntax unchanged from the accepted
byte-identical native self-build. The compiler artifact can be reused; this does
not establish native behavior of the changed JS entry lowering or helper table.

[Native acceptance](../results/managed-dynamic-import-feature-acceptance-v1.json) passes all eight fixture cases covering direct/indirect
eval, Function, evalScript, Script/module identity, operand order and rejection
identity. Both unchanged [`usage-from-eval.js` variants pass](../results/test262-dynamic-import-eval-native-v1.json): sloppy and strict. Those focused results must not be merged into
the older complete 1,900-variant report.
