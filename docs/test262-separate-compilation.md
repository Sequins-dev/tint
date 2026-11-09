# Test262 separate compilation

Status: design, 2026-11-10. Decision recorded by the user on 2026-11-10:
compile the runtime once per toolchain and link each batch's lowered test
scripts against it, keeping ahead-of-time (AOT) semantics. Building one
test-independent image that compiles test sources with the in-image script
compiler at run time was rejected, because the ledger would then measure the
runtime-compile path.

## Why

Measurements on the frozen toolchain at 1bc017b0 (macOS arm64, Node 24):

- **Runner wall time:** 88% compiling batch images, 6% preparing services,
  3% native execution, 2% initialization. Source: phase intervals of the
  runner heartbeat over a 22-variant staging selection.
- **Batch cost is independent of the tests:** a batch holding one trivial Script
  took 318–387 s (under load) and produced a 101,186,767-byte image. A batch
  compiles the generated `test262-runtime` module, the JavaScript runtime and
  engine, the in-image script compiler, and the hosts, as one linked whole
  program.
- **Inside a batch compile** (V8 profile of two 6-variant batches): codegen 27%
  (half of it the IR verifier), closure checking 18%, lowering 15%, collection
  runtime preparation 12%, managed surface preparation 15%, GC 14%.

So nearly all suite compute repeats the same runtime compilation, about 15,000
times for a full run.

## Mechanism: AOT units linked into a prebuilt runtime image

The pieces already exist for native services (`tools/native-service-cache.ts`,
`compileNativeServiceUnit`, `BuildRequest.nativeServices`):

- **A unit is compiled in Node** through the managed-surface entry pipeline
  (`prepareManagedSurfaceEntry`): the entry module is checked against the
  surface's published types, specialized, lowered and emitted as relocatable
  native code.
- **Its imports are surface identities.** `managedImports` names the
  contracts the unit needs; linking binds them to the image's identity
  functions (`serviceIdentities`).
- **Units are cached on disk** by toolchain digest, source-snapshot digest and
  request, so they are content-addressed and reusable.

Separate compilation for Test262 inverts the service arrangement:

1. **Runtime image, once per toolchain.** Build the batch program with no test
   cases, but with a unit loader in the selector host instead of a static
   list of case hosts. The image publishes the managed surface directory that
   units link against (the same directory the in-image script compiler reads),
   and records it in a manifest next to the image.
2. **Test units, per batch.** Lower each case's Scripts with the same AOT
   `lowerScript` as today and compile the lowered module, with its case host,
   into a unit against the manifest's surface directory. No runtime module is
   compiled.
3. **Load and bind at start.** The image reads the unit file named by its
   argument, maps the code into executable memory (the JIT publication path
   already does this), binds each import to the image's identity functions,
   and runs the selected case through the existing `runNativeScripts` host.
4. **Reuse.** One prebuilt image serves every batch of the toolchain; a batch
   becomes "compile N small units + one process launch per variant".

What stays the same: Script lowering (`lowerScript`), the JavaScript runtime,
engine and harness code, which are compiled once with today's whole-program
pipeline, and the execution host. What changes: the lowered test module is
checked against the published surface instead of the whole program, and it is
not part of the runtime's closed-world optimizations. In-image eval and
`Function` compiles already go through the same entry pipeline. A result that
differs between the two paths is a compiler bug in one of them, never an
intended semantic difference.

## Staged plan

Each stage keeps the current runner working and is gated like any compiler
change: red-first tests, tint-check, a frozen self-build, and a native recheck.

1. **Surface manifest.** Teach the batch builder to emit the image's surface
   directory and identity table as a versioned manifest. Test: the manifest
   read back equals the directory the in-image compiler reads.
2. **Unit compile of a lowered test.** Compile one lowered Test262 case into a
   unit against the manifest (`compileNativeServiceUnit` generalized from a
   factory profile to a script-host profile). Test: unit counts, import
   contracts, and deterministic bytes across two compiles.
3. **Loader host.** A selector host that loads units from a file and binds
   imports, with executable-memory publication through the existing JIT path.
   Test: a trivial unit runs and reports through `runNativeScripts`.
4. **Runner mode.** `TINT_TEST262_LINKING=units` builds the runtime image once
   per run (cached by toolchain digest) and compiles per-batch units. Equivalence:
   run the 343-test module corpus and the strings/RegExp/Array sets in both
   modes and require identical statuses.
5. **Default.** After a full-suite comparison with identical statuses, make
   units the default and record the runner-time change.

## Risks

- **Surface coverage.** A lowered test imports only runtime-import vocabulary
  (`runtime-imports.ts`); every such import must be a published identity. Any gap
  shows up as a unit compile failure, not as a wrong result.
- **Collection runtimes.** The entry pipeline prepares collection helpers per
  unit (about 12% of an eval compile). Units for tests are small, so this is
  bounded, and the collection plan cache from the script compiler applies.
- **Executable memory.** Loading units uses the 64 MiB executable reservation
  already sized for eval-heavy tests.
