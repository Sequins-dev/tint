# Initial conformance and development baseline

Status: fixed reference for implementation, not a claim of complete conformance.
The compiler self-hosts within an implemented strict subset. See the current
[language coverage inventory](language-coverage.md) for implemented subsets, gaps
and the Test262 adoption plan.

## Pinned references

Use **TypeScript 6.0.3** as the initial syntax/checker reference and development
checker. This selects a verified stable 6.x release rather than the earlier proposed 5.x
baseline, for which there was no project-specific technical requirement. It is not
a claim of the latest release across all major versions or a ceiling on coverage. The official
[6.0.3 release](https://github.com/microsoft/TypeScript/releases/tag/v6.0.3) identifies
the release; pin the exact package and integrity in the development lockfile when
project scaffolding is created. Do not use a floating version range.

Use **ECMAScript 2025** as the initial runtime semantic reference, consistent with
our existing [semantic baseline](semantic-baseline.md) and runtime map. Later
language additions require explicit coverage updates. Engine-specific behavior,
host APIs and diagnostic text are separate from normative language semantics.

Tint owns its frontend/checker. Upstream TypeScript is a development oracle and
reference, not a component required by the native compiler. Its acceptance does
not prove Tint strict soundness. Its JavaScript emit may supply type-erased runtime
fixtures but cannot replace missing Tint compilation stages.

## Development checking configuration

The design below describes checking policy. The implemented workspace uses
`tsconfig.base.json` with NodeNext module/resolution and relative-extension rewriting
for compiled ESM package exports; project references emit JS/declarations, while
`tsconfig.tests.json` checks tests/tools without emission. This development packaging
is separate from Tint source-catalog resolution. The other strictness options below
are retained. See [workspace contracts](workspace.md).

Original no-emit checking configuration for reference:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": false,
    "types": []
  }
}
```

The workspace now uses ES2023 library declarations so compiler source can adopt
implemented APIs such as `findLast`, while emitted bootstrap JavaScript keeps its
ES2022 syntax target. This is a development-library vocabulary, not a change to the
runtime semantic reference or a promise to implement every builtin in that library. The
[feature inventory](bootstrap-feature-inventory.md) remains the implementation budget.
Keep DOM and implicit Node ambient types out of the portable core. Node adapter
checking gets its own explicit dependency scope; trusted declarations have a finite
reviewed registry. Do not add permissive ambient declarations to silence missing APIs.

The upstream bundler resolver can accept paths that Tint does not support. Enforce
the [source-catalog rules](build-inputs.md) separately; noEmit checking is not the
runtime loader. These options permit checking explicit `.ts` imports without asking
the development checker to emit the native program. See TypeScript's
[module-option guidance](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html).

Tint additionally rejects the cases in [strict-checking rules](strict-checking-cases.md),
including writable alias violations and unproved assertions that upstream checking
may permit. Do not describe these options alone as a soundness proof.

## Coverage report

Track four independent dimensions for every feature: syntax/binding, static checking,
runtime semantics, and host/builtin API support. A parsed program is not a supported
program until its required path checks, lowers and executes correctly.

Each test reports one of: implemented and passing; implementation failure;
unsupported coverage; intentional strict rejection; or not applicable to this host.
Unsupported tests are visible counts, not passes. A strict rejection needs a named
rule; an unimplemented syntax form must not be labeled unsound.

Compare supported ordinary checking with the pinned TypeScript reference, but record
intentional strict differences separately. Compare accepted runtime behavior with
type-erased execution, preserving values, errors and effect order. Optional live
contract warnings are separate output and cannot change the behavioral oracle.
Do not require identical engine-specific stack strings or diagnostic wording.

Record exact Node executable version/platform and execution flags in test reports.
The workspace records Node 24.12.0 in `.node-version`;
its version is a host-tool requirement, not the language specification. Native
self-build does not require Node. Run reference-only checks under the development
host without pretending those tests passed on Tint.

Pin any imported conformance-suite revision and licensed fixture provenance when
adding tests. No unselected Test262 checkout is implied by this document. Maintain
small independently understood cases from the start; broaden conformance as features
arrive rather than reporting a misleading aggregate coverage percentage.

## Baseline updates and readiness

Updating TypeScript or the runtime edition is an explicit change with differential
results, documented new coverage and reviewed strict divergences. A self-build alone
cannot authorize a conformance claim. Require native execution, independent behavior
checks and deterministic stage 2/3 comparison as already specified.

The strict cases, build-input contract and this baseline close the remaining design
questions needed to begin implementation. Exact tool installation, test-runner choice,
file organization and serializer constants can be selected during scaffolding and
verified in fixtures. They do not require another architecture phase.
