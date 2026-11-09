# Module-on recheck v2 of language/eval-code/indirect/{export,import}.js#module (P)

This supersedes the toolchain description in `../test262-indirect-eval-module-recheck-p-v1-evidence/README.md`. It reruns the same two variants on a correctly built freeze of main.

## Correction to v1
The v1 README said the recheck ran on a freeze "built from main 6412d984". That isn't accurate:
- **How v1 was built.** `freezeNodeToolchain` copies each package's `dist` from the worktree. P checked out 6412d984 in a scratch worktree and froze it without running `pnpm build` first. So `main-toolchain-v161` paired 6412d984's sources (its recorded snapshot) with compiled packages from an earlier main build (00e49d9a).
- **Why the result still stands.** All of that code is on main, so v1's 2/2 pass is still main evidence. But the stated provenance was wrong.
- **What prevents a repeat.** `freezeNodeToolchain` now refuses stale compiled packages (fix/freeze-dist-check-p). The coordinator also added a rebuild-before-freeze rule to OPUS-RESUME.md.

## v2 run
- **Toolchain.** `main-toolchain-v168`, frozen from main e47cf9ab immediately after `pnpm build` in the same worktree. Manifest: `main-v168-manifest.json`. Frozen toolchain SHA-256: `9a8925a2…` (recorded in the report).
- **Freshness verified.** All 14 frozen packages' `dist` are byte-identical to that build. The build's `tsconfig.tsbuildinfo` files list all 643 snapshot sources with SHA-256 versions that match the e47cf9ab workspace.
- **Settings.** `TINT_TEST262_MODULES=1`; the standard runner slot with 300 s containment. Variants are in `variants.json`, inputs in `run-inputs.json` and the exit record in `run-exit.json`.
- **Result.** 2/2 pass. generatedAt 2026-11-09T11:59:44Z, which is later than both the stage-8 corpus rows (04:47:11Z) and v1 (10:19:59Z).

The corpus-differential choice recorded in v1 is unchanged: corpus differentials run with modules on. The analysis of the stage 4/5/6 reports in v1 also stands.
