# Compiler check-memory probes, 2026-11-19

Node 24.12.0 on macOS arm64 built `language/expressions/object` with suite
linking, module support, `TZ=UTC`, and AOT native services. The live heap
figures are measured after forced GC.

| Seam (MiB)        | Link memory `34a064ec7` | Check memory `eead7e674` |
| ----------------- | ----------------------: | -----------------------: |
| Linked            |                     560 |                      561 |
| Specialized       |                     862 |                      863 |
| Initially checked |                   1,162 |                    1,163 |
| First instance    |                   1,740 |                    1,711 |
| Second instance   |                   2,571 |                    1,967 |
| Check returned    |                   1,100 |                    1,100 |

`obj-lm-fine` used the uncapped probe configuration. `obj-check-owner-matched-4096`
used a 4,096 MiB old-space cap with the same frozen source input
(`0500ec98c485615d962135d9f77c6f0fa3bca0713841c0da3572270bb6e524ae`).
`obj-check-owner-3072` used the check-memory source snapshot and a 3,072 MiB
cap and measured 1,968 MiB at the second instance.

A baseline V8 heap snapshot at the second instance, `obj-lm-restored-instanced-3`,
found two stack-rooted checked graphs retaining 466 and 333 MiB of checker
state, excluding syntax also held from other roots. Their largest exclusive
children were operation arrays, bindings and expression indexes.

Raw probe and snapshot records are in `scratchpad/bm` for session
`9f6a53a7-7af8-4730-8505-43ba9450ac72`. The snapshot analysis is in
`/private/tmp/tint-front-end-memory.dd3P7m/instanced-3-snapshot.log`.
