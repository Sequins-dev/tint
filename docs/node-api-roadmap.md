# Node.js public API roadmap

The application compatibility target is the public API of Node 26.13.1.
Tint applications import built-ins through canonical `node:*` specifiers.
The roadmap starts with non-I/O modules so file and network APIs can reuse
their byte, path, event and stream semantics. The compiler's own host
requirements remain documented in [runtime host surface](runtime-host-surface.md).

## Architecture

- **F0 · ESM built-in registry.** Keep one authoritative registry of canonical
  specifiers and built-in bindings. Static import, dynamic import and re-export
  use the same module and export identities within a realm. Typed and untyped
  callers use the unified pipeline. Initialize optional libraries only when
  used. The application surface is strictly ESM, with no CommonJS loader,
  interop shim, bare built-in aliases or CommonJS entry bindings. Buffer and
  process are explicit module imports. Globals are limited to standard
  ECMAScript and Web APIs, including timeout and interval timers and console.
  Node-specific immediate timers use explicit imports.
- **F1 · System bindings.** Use internal `tint:c/*` declarations for syscalls
  and libraries. Reuse generated layouts, `OrErrno`, `ByTarget` and C views.
  Reserve `node:ffi` for the Node 26.13.1 userland API. Load versioned system
  or package-manager libraries through per-platform dynamic lookup, including
  Homebrew where applicable. Keep JS semantics in TypeScript and target facts
  in platform adapters. Preserve errno at the failing call, separate native
  error domains and keep buffers and handles alive for the duration of any
  foreign use.
- **F2 · Event loop.** Extend Tint's isolate-owned event loop, timer heap,
  microtask queues, reactor and helper pool. Keep scheduling, timers, readiness
  and dispatch amenable to later compiler and runtime intrinsics. Keep only
  the owning isolate responsible for JS execution and
  settlement. Blocking jobs exchange owned bytes and status. Readiness uses
  generation-guarded handles and per-platform poll/completion adapters.
- **F3 · Events and cancellation.** Make event maps, event names and listener
  signatures strongly typed for EventEmitter and EventTarget. Preserve full JS
  behavior through the same implementations, including mutable listeners,
  registration order, reentrancy, abort and unhandled errors. Use guards at
  specialization boundaries and share coded errors across modules.
- **Streams.** Investigate direct integration of Node and Web stream flow with
  Tint's async/await state machines and microtask scheduler. Prototype a
  backpressured typed producer/consumer pipeline with suspension and
  cancellation. Reuse the same stream lifecycle for typed and JS consumers.
  Preserve observable turn ordering, backpressure and destruction so later
  specializations can use the same semantics.

  The M1.P8 prototype uses ordinary Promise suspension for blocked readers
  and Web writers. Node callback completion and flow notifications use the
  isolate's next-tick queue. Writing below a high-water mark, waking a reader,
  and reaching a terminal state each have one implementation for typed and
  untyped callers. An optimization must preserve those transitions and their
  checkpoints, including listener reentrancy and abort cleanup.

## Milestone 1 · Straightforward non-I/O modules and foundations

| Phase     | Deliverable                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1.P1** | Commit the roadmap and platform link. Build F0's canonical ESM registry, lazy library initialization and shared typed/untyped identity. Remove application CommonJS shims and non-standard Buffer/process globals.                               |
| **M1.P2** | Widen `node:buffer` and standard `TextEncoder`/`TextDecoder`. Share codecs, backing and byte windows.                                                                                                                                            |
| **M1.P3** | Add `node:events` with typed EventEmitter. Add standard EventTarget, Event, CustomEvent, DOMException, AbortController and AbortSignal. Establish coded errors.                                                                                  |
| **M1.P4** | Add `node:path`, `node:path/posix`, `node:path/win32` and `node:url`. Expose standard URL and URLSearchParams, including file URL conversion. Complete before fs.                                                                                |
| **M1.P5** | Add `node:util`, `node:assert`, `node:assert/strict`, `node:string_decoder` and `node:querystring`.                                                                                                                                              |
| **M1.P6** | Widen the non-I/O `node:process` surface through explicit imports. Add `node:timers`, `node:timers/promises` and `node:console` core formatting and inspection. Use F2 for scheduling.                                                           |
| **M1.P7** | Add public `node:os` through `tint:c/*` before fs. Widen userland `node:ffi` toward Node 26.13.1 parity. Widen `node:crypto` over dynamically loaded OpenSSL 3. Widen non-fs `node:worker_threads` features and expose standard structuredClone. |
| **M1.P8** | Add `node:stream`, `node:stream/promises` and `node:stream/web` with a correctness-focused async/await and microtask integration prototype.                                                                                                      |

## Milestone 2 · Complex non-I/O modules

Add `node:test`, then `node:vm` using per-context realms and dynamic
compilation, `node:perf_hooks`, `node:diagnostics_channel`,
`node:async_hooks` starting with AsyncLocalStorage, and `node:module`
with ESM-only utilities and hooks.

## Milestone 3 · File and streaming I/O

Widen `node:fs` sync operations first through `tint:c/*`, then async
callbacks, `node:fs/promises`, FileHandle, streams and watchers. Reuse
path, URL, Buffer, OS and streams from Milestone 1. Follow with
`node:child_process`, `node:tty`, `node:readline`,
`node:readline/promises` and `node:sqlite` over dynamically loaded system
or Homebrew libsqlite3. Deliver `node:zlib` as one module with synchronous,
callback and stream APIs, using M1.P8 streams and dynamically loaded system
or Homebrew zlib, Brotli and Zstd. Add stream-bound process stdio and crypto
stream widening.

## Milestone 4 · Network I/O

Generalize F2 kqueue/epoll readiness for read, write, EOF and hangup with
generation-guarded fd reuse. Add `node:net` for TCP and Unix sockets,
`node:dns` and `node:dns/promises`, `node:http`, `node:tls` over
dynamically loaded OpenSSL 3, `node:https`, `node:dgram`, `node:http2`,
and Web networking with fetch, WebSocket and EventSource.

## Validation and delivery

Rebase on current `origin/main` and open one focused PR per phase. Report
the PR URL and head SHA to the orchestrator, then pause until the orchestrator
confirms three-target CI passed and the PR was squash-merged into `main`.
Start the next phase from the updated `main`. The targets are Darwin arm64,
Linux arm64 and Linux x86-64. Preserve Windows as a distinct
platform boundary. Record typed-only, untyped and mixed native coverage,
module identity, errors and supported overloads for each slice. Use tagged
Node tests or explicitly scoped public case extracts as the behavioral
oracle. Keep application conformance distinct from Node-host tooling and
Test262.

Prioritize Node 26.13.1 correctness and conformance, strong typing and clean
architecture across all four milestones. Keep implementations suitable for
later optimization. The separate performance discovery and Central Builder
pipeline owns hot-path tuning and benchmarks after higher-priority performance
work. Phase PRs are gated on correctness and conformance.

Before opening a PR, run `pnpm build && pnpm typecheck && pnpm boundaries &&
pnpm format:check`. Register new tests in `tools/check-test-files.json`
and tools tests in `tools/gate/test-costs.json`. Verify registrations with
`node --test tools/check-test-files.test.ts`. Run
`node --test tools/script-runtime-surface.test.ts` when touching foundation,
JS runtime or script runtime modules. Exercise relevant native fixtures
under LLDB with entry and exit assertions and the shared gate lock. The
orchestrator owns CI monitoring and squash merges.

[Node 26.13.1 API](https://nodejs.org/download/release/v26.13.1/docs/api/index.html)
· [Unified pipeline](unified-pipeline.md) · [Event loop](design-event-loop.md)
· [Native FFI](native-ffi.md) · [Platform roadmap](platform-roadmap.md)
