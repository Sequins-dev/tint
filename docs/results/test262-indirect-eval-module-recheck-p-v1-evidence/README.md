# Module-on recheck of language/eval-code/indirect/{export,import}.js#module (P)

## Why this exists
The stage-8 corpus differential (`docs/results/native-surface-image-pruning-v1-evidence/stage8-corpus-language-v157.json`, generatedAt 2026-11-09T04:47:11Z) is a complete native `runtime-execution` report, so `tools/test262-coverage-ledger.ts` counts it. P's corpus wrapper (`run-variants.mjs`) unset `TINT_TEST262_MODULES`, so the report recorded these two module variants as `unsupported`. It was also the latest-dated evidence for them, which dropped `language` to 44699/44701 in the ledger.

`../test262-indirect-eval-module-recheck-p-v1.json` reruns exactly those two variants natively with `TINT_TEST262_MODULES=1`:
- Toolchain: frozen `main-toolchain-v161`, built from main 6412d984 (the current main at freeze time). Manifest and source snapshot are in `main-v161-manifest.json`; frozen toolchain SHA-256 `5f886772…` (in the report).
- Runner: the standard runner slot, 300 s containment.
- Variants: `variants.json`. Inputs are in `run-inputs.json` and the exit record is in `run-exit.json`.
- Result: 2/2 pass. generatedAt 2026-11-09T10:19:59Z.

The ledger selects the latest report date per path/variant, so this newer passing evidence replaces the stage-8 `unsupported` rows.

## Choice: future corpus differentials run with modules on
The ledger reads every `.json` and `.jsonl` file under `docs/results` on main. It accepts any complete native `runtime-execution` report at the pinned revision (see `files` / `aggregateEvidence` in `tools/test262-coverage-ledger.ts`). There is no path convention for non-canonical reports.

P therefore keeps corpus reports in `docs/results`, and from now on runs every corpus and sample differential with `TINT_TEST262_MODULES=1`, through the module-aware wrapper that sets the variable. Moving reports elsewhere was the other option. This one is cleaner for three reasons:
- **The rows become true evidence.** The 343-variant corpus contains exactly two module variants: these two, in the 321-variant language half; the 22 built-ins variants have none. With modules on they execute instead of being skipped. The script variants are unaffected, because the flag only enables module-flagged tests.
- **The evidence keeps counting.** The reports still refresh the ledger's evidence for all 343 variants at the change's toolchain.
- **No new rule to remember.** Moving reports outside `docs/results` would need a convention that the ledger doesn't encode.

P's stage-9 corpus (pending) is being rerun with modules on before it is published.

## Check of P's earlier corpus reports (stage 4/5/6)

| Report | Module rows | Superseded by | Effect on ledger |
|---|---|---|---|
| `native-eval-entry-cache-v1-evidence/stage4-{diff,final}-on-language.json` | `unsupported` | stage-4 module rechecks (`stage4-module-recheck-{on-v141,off-v142}.json`, pass) | None: ledger v25 selects no variants from these reports. |
| `codegen-join-guard-proofs-v1-evidence/stage5-corpus-language-v145.json` (2026-11-08T23:54:32Z) | `unsupported` | `stage5-module-recheck-v145.json` (2026-11-09T01:33:30Z, pass) | None: ledger v25 selects no variants from it. |
| `native-eval-source-cache-v1-evidence/stage6-corpus-language-v149.json` (2026-11-09T01:29:35Z) | `unsupported` | `stage6-module-recheck-v149.json` (2026-11-09T01:37:51Z, pass) | v25 selects 309 of its variants, but **not** the two module rows. Those come from the stage-6 recheck. |

All three are harmless. Only the stage-8 report lacked a later module-on recheck, and this report adds one.
