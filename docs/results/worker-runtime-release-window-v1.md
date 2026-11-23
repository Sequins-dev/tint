# Registered releasable regions for memory-release

24 November 2026. Change `da16bafc2`, following
[zero-copy shared string bodies](worker-runtime-zero-copy-v1.md).

## Problem

The collectors return a freed shared string body's pages with
`memory-release` (a fixed anonymous mapping over the range). The two backends
disagreed:

- **x86-64** checked the range against the isolate's managed mapping, so it
  refused every arena range. `e503b7ee8` then left bodies resident, and
  x86-64 never returned arena pages to the OS.
- **arm64** checked nothing.

## Change

- **One contract for both backends.** `memory-release` releases only a range
  inside the context's managed mapping, or inside the one releasable window
  the isolate's identity page records (`@tint/abi`
  `nativeIdentityReleasable*Offset`, words 3 and 4). That costs two range
  compares. Any other range, or a misaligned one, returns -1 and maps
  nothing.
- **Recording the window.** The Worker host records the shared string arena
  as the window when it attaches to the arena, before any body can be freed.
  It writes the window once and never changes it.
- **Refused releases.** A refused release is counted (`refusedReleases`) and
  leaves the body resident. That is no longer the normal path on any backend.

## Validation

Every native run was under LLDB, which reported the stop at entry and
exit 42. Evidence: [fixture runs](worker-runtime-release-window-v1-fixtures.txt).
The x86-64 lines there are transcribed from the VM session.

**`tools/build-memory-release-fixture.ts`.** A collector runtime wrapper
checks the following before starting the generational runtime:

- an unregistered range is rejected, and its contents stay;
- the registered window releases, and the page then reads as zero;
- a range straddling the window's end, one starting below it, and a
  misaligned one are rejected;
- after the window is cleared, a range in it is rejected again.

It passes on macOS arm64, Linux arm64 and Linux x86-64. Under LLDB on macOS,
an `mmap` trace showed the rejected ranges never reached the kernel. Startup
publishes the managed mapping to the context only after the runtime
initializes, so the fixture does not test it at that point; every major
collection releases pages inside it.

**Shared string fixture and stress.** These now also require no refused
release and no resident granule at the end. They pass with:

- serial, parallel and copying collectors on macOS arm64 and Linux arm64;
- serial and parallel collectors on Linux x86-64. Freed arena pages are now
  returned there too.

**Frozen v7.** 15 rotated rounds under the timing lock, base `a60cd3ce7`
against `da16bafc2`. The table gives paired ratios: the median, with the
interquartile range in brackets.
Evidence: [v7 rounds](worker-runtime-release-window-v1-v7.txt).

| Wall                 | Cycles               | Instructions           | Peak RSS               |
| -------------------- | -------------------- | ---------------------- | ---------------------- |
| 1.0015 (0.993–1.012) | 1.0000 (0.994–1.006) | 1.0027 (1.0026–1.0028) | 0.9999 (0.9996–1.0003) |

Neutral. The instruction rise is the same as `a5856ceaf`'s.
