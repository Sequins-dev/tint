# Initial source loading and reproducible build contract

Status: proposed version 0 for the self-hosted compiler. This is a small host/module
policy, not a claim of Node, npm or complete TypeScript project-system compatibility.

Implementation note: [file-service](../packages/file-service/README.md) now provides
bounded synchronous reads and staged output publication through a host contract.
[Source-text snapshots](../packages/source/README.md) now provide strict decoding
through standard TextDecoder/TextEncoder globals and byte/UTF-16/line mapping.
[Source catalogs](../packages/source/README.md) and the
[explicit resolver](../packages/source/README.md) are implemented for supplied
import requests. The initial [syntax slice](../packages/ts-syntax/README.md) now
produces import metadata and source spans, composed with the resolver in integration
tests. Workspace-manifest mapping generation, graph binding and the compiler request
remain unimplemented. Unsupported module syntax fails parsing; it is not skipped.

## Build request and source catalog

The compiler core accepts a structured request: schema version, entry module ID,
source catalog, language profile, target description, artifact kind, optimization
settings, trusted capability/import manifest and diagnostic/path-remapping options.
For the first self-build select strict profile, executable output and baseline
non-speculative lowering. Reject unknown options rather than silently ignoring them.

A source catalog maps normalized project-relative module IDs to immutable source
bytes, supplied directly or read through the build-host adapter. Example IDs are
`src/main.ts` and `src/parser.ts`. The entry names one catalog item. Filesystem paths
used to obtain those bytes are separate from module identity. Source roots and
output destinations belong to the host-facing build request, not generated code.

Initially declare the source catalog explicitly. No directory crawling, package
lookup or filesystem case guessing is required. A future CLI/configuration adapter
may construct the same request; its text syntax is not part of the core compiler.
This avoids adding a JSON parser merely to begin compiling fixtures. Native self-build
can use a compiled-in project catalog plus a project-root argument until config-file
support is useful. Catalog membership must be checked against actual compiler source.

## Module IDs and resolution

Catalog IDs use `/` separators, are case-sensitive, contain no empty, `.` or `..`
segments and cannot be absolute. Initially restrict IDs to portable ASCII letters,
digits, `_`, `-`, `.`, and `/`; reject IDs differing only in ASCII case. This applies
to logical source filenames, not identifiers, string contents or arbitrary user data.
The host can map catalog entries to differently encoded filesystem paths explicitly.

Ordinary imports must begin `./` or `../` and include `.ts`. Resolve relative to the
importer's module ID, normalize dot segments, reject escaping the logical project
root, then require an exact catalog match. Reject backslashes, query/fragment syntax,
URLs, absolute imports, extension guessing and directory/index fallback.

`./x.ts` and `./part/../x.ts` identify the same normalized module. Physical symlinks,
inodes and host case folding do not define identity: two deliberately declared IDs
are different modules even if their bytes come from the same physical file. Reject
duplicate normalized IDs. The catalog is not an OS filesystem sandbox.

Bare specifiers may name explicit catalog import mappings generated from the reviewed
workspace contracts, or compiler-owned host/intrinsic declarations with checked
identities and permissions. Each mapping grants access only to a public entry module
and is scoped to the importing package's declared dependencies. Deep imports are
rejected. Relative imports may only target modules with the same manifest-supplied
package owner; cross-package access uses the declared mapping. The manifest-to-mapping
adapter remains to be implemented; it is not automatic filesystem
package discovery. Arbitrary packages, package.json
exports, path aliases, CommonJS and ambient package discovery are deferred. Do not
accidentally inherit these from the upstream development checker's resolver.

Resolve declaration-level type-only dependencies for checking but exclude their edges
from runtime module initialization. With verbatimModuleSyntax, inline type specifiers in
ordinary import/export declarations still retain dependency side effects. Preserve ordinary import side effects, live bindings and
cycle/TDZ semantics. Resolve/bind the graph before evaluation; do not replace ESM
initialization with alphabetical execution. Top-level await and dynamic import are
initial coverage gaps diagnosed explicitly.

## Source bytes and diagnostics

Read each source once into the build snapshot. Use standard TextDecoder/TextEncoder globals: Node supplies them during bootstrap;
native Tint implements the same globals in its TypeScript runtime. Decode UTF-8
strictly with fatal decoding and BOM preservation: reject malformed
sequences, overlong encodings, surrogate encodings and out-of-range code points.
Accept a leading UTF-8 BOM as source whitespace. Preserve original bytes and line
endings for hashing; do not normalize identifiers or source Unicode. Recognize
language line terminators during scanning, including CRLF as one line break.

Track byte offsets and UTF-16 code-unit offsets as distinct units. Diagnostic source
positions use UTF-16 code units; human-facing lines/columns are one-based with a
stated convention. Keep enough mapping information to report decoding failures by
byte offset before tokenization. Runtime strings retain ordinary UTF-16 behavior;
strict source decoding is not a restriction on string values created at runtime.

Snapshotting each file once prevents inconsistent rereads, but is not a filesystem
transaction across files. A reproducible/release build supplies expected content
hashes and rejects mismatches. Interactive builds record the exact bytes consumed.

## Deterministic artifacts

Fingerprint compiler/build schema versions, source catalog IDs and bytes, target
and deployment settings, profile, optimization options, runtime/intrinsic manifests,
layout/ABI versions and relevant code-generation options. Persist a build report
alongside the artifact. Record toolchain provenance without embedding the running
compiler binary's identity into generated bytes in a way that prevents stage 2/3
comparison.

Assign symbol/layout/import IDs deterministically. Use sorted catalog IDs where
ordering has no language meaning, but preserve source order where semantics require
it. Do not let hash-table bucket order, absolute checkout paths, timestamps, random
IDs or OS directory order affect output. Apply path remapping to embedded diagnostics
and debug metadata. Use deterministic identifiers/signatures for local artifacts.

A target describes architecture, OS, ABI, image format, deployment floor and capabilities.
The build host is separate. Linux and Windows adapters must preserve this logical
request/resolution contract while supplying their own paths, services and publication.

Publish a completed artifact through the host's output contract only after verification
and final serialization/signing. Errors leave the prior destination intact under the
supported host publication guarantees. File permissions are reported separately from
byte-for-byte artifact comparison.

## Entrypoint and initial CLI boundary

An executable entry module exports `main(args: string[]): number`. The launcher
initializes the ESM graph, passes arguments excluding the executable name, calls main
and maps its result to process status. Initially require an integer in 0..255 for
portable CLI behavior; invalid status or an uncaught throw is a reported failure.
This is an explicit executable-host convention, not a restriction on ordinary
function returns. Library artifacts will have their own initialization/export contract.

The compiler's reusable build operation accepts the structured request and returns
an artifact/report or diagnostics; it never exits the host process. Only the CLI
wrapper handles process completion. Exact command spelling and Node launch tooling
are implementation setup decisions and cannot alter core resolution semantics.

## Required cases

Test normalized duplicate paths, exact extensions/case, root escape, missing entries,
type-only edges, side-effect imports, cycles, malformed UTF-8/BOM/line endings, changed
input hashes and identical builds in different directories. Compare Node/native
resolution and artifact bytes for identical snapshots. Separate logical catalog
portability from native execution support on each target.
