# Slice 3 baseline measurements

Source revision `e93aacded1d63f65d974a0146af0551c4e6e8d3c` on macOS arm64.
Node v24.12.0 and pinned TypeScript 6.0.3. Measurements used `TZ=UTC`.
They ran unlocked, without executing a native image or running the full gates.

## Compiler source baseline

| Check | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile` | Exit 0. |
| `pnpm build` | Exit 0. |
| `node tools/selfhost-coverage.ts --entry packages/compiler/src/native/index.ts --specialize` | Exit 0, stage `checked`, 242 linked modules, 3,870 checked functions, 64 specializations, `selfHosted: false`. |
| `/usr/bin/time -lp node tools/bootstrap-compiler.ts "$probe/stage1" --snapshot "$probe/source"` | Exit 0. Production compiler roots and typed compilation required. 41,792,378-byte macOS stage 1, SHA-256 `963c1afb288dbe8dbe96798f48cc00c92037db8750990b67122b15ec4c55e8d2`. |
| Node-hosted stage-1 resource observation | 157.28 s elapsed, 4,120,100,864 B maximum RSS. One observation with some concurrent probe preparation. Use as scale context only. |

The first check reaches the native compiler package through the linked audit
entry. The bootstrap compiles the actual CLI project through allocator, runtime,
program, startup and image writing. The stage-1 build stayed typed. It supplies
zero fallback examples on the compiler's own sources. `projectFiles()` captures
the portable source catalog, including optional modules outside the ordinary
compiler roots. The linked audit denominator, catalog denominator and stage-1
build are separate observations.

The frozen bootstrap catalog has 781 files and 21,082,282 UTF-8 bytes. Its
SHA-256 is `b7ccb26a32be775bc8833d7995735d4aee5ad6bddb12b5382916a9300ad39418`
over sorted relative path, NUL, content, NUL for each entry. Git identifies
the toolchain source. The catalog digest identifies the captured input bytes.

A Node serial loop opened each file in the captured catalog and called
`createSourceText` then `parseModule` from the built packages. Timing wrapped
only `parseModule` and its result creation. All 781 parsed and the accumulated
parser time was 524.04 ms. This pass did not bind, check, lower, generate an
image, or measure syntax heap. It estimates only the scale of one extra parse
of selected source bytes. A first attempt at the catalog scan used the workspace
manifest reader and exited 1 because the bootstrap snapshot contains source
files without package manifests. The scan then enumerated that snapshot directly.

## Corpus and native ledger

Run the compile-only probe with the built workspace packages.

```sh
TZ=UTC node tools/unified-pipeline/probe-slice-3.ts /tmp/slice3-corpus.json generators,async-await,class-inheritance,var-hoisting,arguments-object,typed-array-index,probe-decorated-class,probe-direct-eval,probe-error-after-generator
```

The probe requests the program phase with hosted project bindings and captures
a fresh workspace source identity. It visits every typed corpus form and
three additional witnesses. The optional list retries the requested forms
with the legacy general lowering available. It reports native **program code**
bytes, before startup, host services, image headers and signing. It does
not invoke the hosted run harness. The pinned TypeScript diagnostics are raw
diagnostics using workspace options plus each fixture's option override,
virtual ESM files and the corpus's helper sources. Some helpers are
intentionally unchecked in Tint. Some open writes diagnose under TypeScript.
Treat those facts as inputs to the profile decision described in the design,
not as a raw diagnostic-count threshold.

The initial probe and its reproduction exited 1 before recording any
measurement. The script attempted to spread a `foreignBindings` property
that `foreignRuntimeBindings` does not return. The corrected probe uses the
project request's foreign bindings, as the hosted fixture does.

[Compile-only records](slice-3-function-fallback-corpus-e93aacded.json) and
the [earlier native execution ledger](unified-pipeline-ledger-slice4a-c2-b3-dev-lldb-v1.json)
use separate source snapshots and serve different purposes. The older ledger
records outcomes for both forms of all 72 constructs. It builds exactly one
fixture per form and does not isolate sibling typed functions. The new probe
adds a current-main first-rejection baseline. It can identify erased static
errors and emitted program code even for cases that fail native execution
in the earlier ledger.

The corrected broad probe exited 0 on source snapshot
`15a28d7bebd8b8d8691c61034ae3766af43b000f6c361774a4d050e839ef8a57`. It
recorded 72 typed forms and three extra witnesses. Of the 72 corpus forms,
31 emitted typed, 25 failed checking, 11 failed linking, two failed runtime
preparation, one failed specialization, one failed parsing and one required
an unavailable option. Typed emission agreed with the previous typed path for
all 72 corpus cases.
Seven selected retries emitted whole-module fallback program code between
22,713,648 and 23,802,048 bytes. The var witness emitted 1,536 bytes on the
typed path with or without the provider. The first decorator witness stopped
in parsing, before retry.

The old ledger's `typed-array-index` expectation assumed the read would be
`number | undefined`. Pinned TypeScript accepted the exact fixture with
`noUncheckedIndexedAccess` on. The write to `bytes[1]` immediately preceding
the read provides the narrowing fact. A separate generator-plus-bad-assignment
probe confirmed that current module fallback really can mask a genuine type
error. TypeScript reported TS2322 for the later explicit assignment and Tint
still emitted through the module retry. The original inheritance witness
reported TS4114 for its missing override modifier.

The measurement script itself passed focused strict TypeScript checking
after hoisting the checked provider value into a narrowed constant. The
initial focused check exited 2 with TS2379 under
`exactOptionalPropertyTypes`. That edit preserves the runtime probe.

A [focused follow-up](slice-3-function-fallback-oracle-e93aacded.json) exited 0
on the same workspace snapshot.

```sh
slice_cases=probe-index-unproven,probe-decorator-primitive-signature,probe-inheritance-override
TZ=UTC node tools/unified-pipeline/probe-slice-3.ts /tmp/slice3-oracle.json "$slice_cases" "$slice_cases"
```

| Witness | Pinned TypeScript 6.0.3 | First Tint rejection | Module retry |
| --- | --- | --- | --- |
| Indexed read without the preceding write | TS2322, `number \| undefined` cannot initialize `number` | Check, invalid binding operation | Emitted 23,037,648 B of program code |
| Decorated class with a simple decorator signature | Accepted | Check, typed decorators require dynamic class replacement contracts | Emitted 22,735,192 B |
| Inheritance with explicit override | Accepted | Check, class accessor contracts require separate read and write checking | Emitted 22,804,864 B |
