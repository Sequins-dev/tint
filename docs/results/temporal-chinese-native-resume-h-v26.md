# Chinese/Dangi native validation hold

Native launches remain held until load-events.md records HOST AUTHORIZATION RESTORED.
Frozen source v26 includes all calendar families, with 587 verified source files.
No native passes or stage-image equality are claimed. All gates pass (4699/4699).

1. Resume the held ISO PlainYearMonth journal on original frozen v12 first.
2. Observe the eight compiled cases using `.tint-bootstrap/observe-native-fixture-direct-h-v26.mjs`, passing the fixture manifest path from `native-temporal-chinese-build-only-h-v26.json`, a new report path and the frozen v26 descriptor path.
3. Run `.tint-bootstrap/temporal-chinese-selfbuild-resume-driver-h-v26.mjs` with `slot selfbuild 2 -- node`; the prepared compiler/source proof is committed. It verifies initial/final debugger states, stage equality, signature, DWARF and smoke execution.
4. Measure the Chinese/Dangi named-file manifests with the standard native runner and `TINT_TEST262_VARIANTS`, then the complete affected Intl families. Keep one H runner, batch64, direct launch, heartbeat30000/stall150000 and timeout300000. Retain prior reports.

Guarded drivers require a restoration marker newer than the stall marker and were syntax checked only. Archive copies in docs/results preserve the exact source; execute the original copies in .tint-bootstrap so relative frozen imports resolve.
