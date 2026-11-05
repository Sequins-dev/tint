# Working practices

## Project direction

- Follow the active objective in [docs/implementation-goal.md](docs/implementation-goal.md).
  Read the linked architecture and status documents selectively for the task at
  hand; do not routinely load historical archives. Keep the goal document limited
  to priorities and completion criteria, current status in its owning dashboard,
  and run-specific evidence in immutable reports.
- Tint is a self-hosted TypeScript compiler/runtime with direct native code
  generation and its own linking machinery. Share compiler infrastructure between
  AOT and live execution; do not introduce C or a platform linker as an intermediary.
  Node is the bootstrap/build host, not a substitute for executing native output.
- JavaScript execution follows ECMAScript semantics, including behavior permitted
  by unsound TypeScript assertions. Strict native compilation may impose explicit
  restrictions; do not silently change live-mode behavior to simplify compilation.
  Use the TypeScript version pinned in the workspace as the type-checking guide.
- macOS arm64 is the first target. Preserve platform boundaries for Linux as the
  eventual primary target and for later Windows support.

## Module and host boundaries

- Prefer cohesive reusable frameworks with purpose-focused internal modules and
  narrow public entrypoints, following [the migration plan](docs/framework-consolidation.md).
  Reuse existing primitives; do not make every small component a package. Keep
  dependencies acyclic and communicate through explicit public contracts; avoid
  importing another framework's internal source files.
- When adding packages or dependencies, update package manifests, TypeScript project
  references and `workspace-contracts.json`. Regenerate the compiler source catalog
  with `node tools/generate-compiler-catalog.ts`, then format the generated file.
- Keep portable compiler/runtime logic separate from Node-only tooling and platform
  adapters. Use standards-based globals such as TextEncoder/TextDecoder and the
  explicitly supported host facades; avoid expanding the host surface casually.
- Parser or AST changes must propagate through visitors, rewriting, binding,
  linking, checking and lowering. Unsupported paths must fail explicitly rather
  than drop syntax or bypass semantics.

## Validation and evidence

- Add semantic tests for each feature, including ordering, abrupt completion and
  boundary cases. Node reference execution is useful, but investigate discrepancies
  against the specification rather than treating Node as infallible.
- TypeScript checks and Node tests do not prove native compatibility. Exercise
  changed portable algorithms and compiler stages in native fixtures. Preserve
  self-hosting with frozen source snapshots, successful native self-builds and
  stage-image comparisons; verify debug information when producing debug builds.
- Keep validation commands fail-fast and inspect each exit status. A later passing
  command must not hide an earlier failed type check or test.
- Public workspace imports resolve built `dist` files. Rebuild the TypeScript
  reference graph (`pnpm build`) after framework source changes before running
  downstream tests or tools; mixing source imports with stale output can produce
  misleading results.
- Run `pnpm check` for the workspace gates (types, tests, dependency boundaries and
  formatting), or the equivalent constituent commands. Use focused checks while
  iterating and relevant native validation before claiming a slice works.
- Run experimental native binaries under LLDB to contain faults and prevent macOS
  Problem Report windows. For hosted fixtures, use `TINT_BUILD_ONLY=1` and inspect
  the resulting binary under LLDB. Assert the inferior's stopped-at-entry and final
  expected exit states; the debugger's shell exit status alone is insufficient.
- Use hosted fixtures' build manifests when recording native runs; they capture
  the loaded source snapshot and arguments. Do not fingerprint a mutable workspace
  after building and attribute that later state to an older image.
- Preserve failed observations and distinguish debugger launch failures from
  faults after native execution begins. Do not automatically retry away failures.
  Before restarting background work, inspect its live process/session; an observation
  timeout is not evidence that the work stopped.

## Conformance and progress records

- Execute unchanged Test262 sources and harnesses through native output. Respect
  source goals, strictness, isolation and negative-test phases. Never evaluate a
  parse-negative test to establish its expected syntax error.
- Keep native conformance, parser acceptance, Node reference results and bespoke
  regression fixtures separate. Full-suite percentages require the full pinned
  suite and an explicit variant policy; retain failures and unsupported cases in
  the denominator. Overlapping selections cannot be summed into overall coverage.
- Store each run in a new immutable report. Update the concise
  [Test262 dashboard](docs/test262.md) in place after complete selection reruns;
  do not append a progress diary or merge focused rechecks into older totals.
  Link detailed evidence instead of copying logs into design documents.

## Continuous cleanup

Always watch for opportunities to clean up and improve the code while working.
In files you touch, continuously apply small, behavior-preserving refactors when
you see a clearer structure, even when the cleanup is not strictly required for
the immediate change. Improve naming, simplify control flow, remove duplication
and obsolete code, clarify contracts, and correct stale comments as you encounter
them.

Prefer small, continuous improvements over postponing cleanup until a large
refactor is necessary. Keep each refactor understandable and validate it with
appropriate checks. Preserve intentional behavior and existing user changes;
keep the requested work moving while improving its surrounding code.
