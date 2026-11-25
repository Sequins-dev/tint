# Zero-copy shared string bodies

24 November 2026, macOS arm64 (M5 Max). Implementation `a5856ceaf`, which
also contains the early pool start (`5a3491b1f`) and the arm64 shutdown
request (`f8c556b0d`). Base images are from `a60cd3ce7`. Design:
[docs/design-worker-runtime.md](../design-worker-runtime.md), "Shared string
bodies".

## What changed

A string of at least 32,768 units travels between isolates as a body of the
process's shared string arena:

- the sender copies it once (or not at all, for a string it received or
  sent before);
- the receiver uses the body's flat string object directly;
- each isolate's collector keeps a hold on a body while the isolate can
  reach its string.

## Correctness

Every native run below was under LLDB, which reported the stop at entry and
exit 42. The recorded runs are at the final head `e503b7ee8` ("Other
targets" below); the runs at `a5856ceaf` passed the same way.

**Fixture** (`tools/build-worker-shared-strings-fixture.ts`), for three sets
of collectors:

- serial (8 MiB heaps): serial minors and serial marking;
- parallel (64 MiB heaps): pool minors and pool marking;
- copying: the copying runtime, where every collection is full.

Each run printed `shared strings: ok` after checking, in order:

1. Ten echo round trips of one string make one body, and the main isolate
   holds the echoed body.
2. A message discarded unreceived (its Worker terminated while busy) frees
   its body once the sender's string is gone. The send cache keeps nothing.
3. One body is held by four isolates (reference count 4); terminating two of
   them drops their holds (count 2).
4. A received string's hold is queued, a minor collection makes it old,
   minor collections keep it, and a full collection frees it. In the copying
   runtime the next collection frees it.
5. A body whose sender dropped its hold while the message waited in a busy
   Worker's queue survives, reads intact, and holds only the receiver's
   reference.
6. After every Worker exits, every body is freed.

**Stress** (`TINT_SHARED_STRINGS_STRESS=1`): four Workers make bursts of 16
fresh bodies at once for 24 rounds. The main isolate forwards each string to
the next Worker, which verifies it, and every sixth round all isolates
collect. Each collector set passed three of three runs with:

- no fallback to a copy;
- exactly one body per burst string (1,536);
- every body freed at the end.

Evidence: [stress runs](worker-runtime-zero-copy-v1-stress.txt).

## Transport

Each set ran 15 rotated rounds under the timing lock. Base is `a60cd3ce7`.

**Isolated 1 MiB clone** (µs per round trip; five round trips per sample;
median and interquartile range; load median 7.2).
Evidence: [isolated runs](worker-runtime-zero-copy-v1-isolated.txt), where
`a` is the base and `b` is zero-copy.

|              | Sample 1      | Sample 2      | Sample 3      |
| ------------ | ------------- | ------------- | ------------- |
| Base         | 386 (367–500) | 655 (581–746) | 473 (452–593) |
| Zero-copy    | 16 (15–33)    | 22 (19–28)    | 19 (14–25)    |
| Node 26.13.1 | 270 (258–316) | 157 (151–211) | 155 (145–213) |

**Transport suite** (load median 7.5; the load from other worktrees makes
these absolute times higher than in earlier runs).
Evidence: [transport](worker-runtime-zero-copy-v1-transport.json).

| Operation             | Zero-copy / base  | Zero-copy / Node  |
| --------------------- | ----------------- | ----------------- |
| 1 MiB clone           | 0.07× (0.06–0.08) | 0.07× (0.06–0.09) |
| terminate             | 1.27× (1.13–1.56) | 0.59× (0.56–0.72) |
| Every other operation | 0.92–1.06×        | as before         |

- **terminate.** Terminating now joins the isolate's collector pool and
  releases its holds before its memory is unmapped. arm64 never did this
  before. It stays well under Node.
- **wait-notify and wait-async** read 1.8–1.9× Node in this loaded run, for
  base and zero-copy alike. They are the existing gaps bounded by PR #12.

## Frozen v7

15 rotated rounds under the timing lock, base `a60cd3ce7` (`lo-base`) against
`a5856ceaf` (`zc`). The table gives paired ratios zc / base: the median, with
the interquartile range in brackets. `frozen-workload.ts` records no load.
Evidence: [v7 rounds](worker-runtime-zero-copy-v1-v7.txt).

| Wall                 | Cycles              | Instructions           | Peak RSS               |
| -------------------- | ------------------- | ---------------------- | ---------------------- |
| 1.0023 (0.987–1.004) | 0.998 (0.996–1.002) | 1.0026 (1.0025–1.0026) | 1.0000 (0.9999–1.0001) |

Wall, cycles and peak RSS are neutral, so the gate holds. Instructions rise
0.26%, most likely from the arena range check on the collectors' non-moving
reference paths. The compiler holds no body, so that check never matches.

## Self-build and Test262

- **Self-build at `a5856ceaf`.** The native-subset check passed and stage 1
  built. Stages 2 and 3 exited 0, and stage2 == stage3. `e503b7ee8` changes
  no compiler source.
- **Test262**, with the frozen toolchain of the final head `e503b7ee8`, batch
  size 64, agent tests included:
  - Atomics: 778/778, unchanged; Atomics was also 778/778 at `a5856ceaf`.
  - SharedArrayBuffer: 208/208, unchanged.

## Other targets

- **macOS arm64**, final tree `e503b7ee8`: every main fixture and stress
  variant passed. Evidence: [macOS runs](worker-runtime-zero-copy-v1-macos.txt).
- **Linux arm64** (the `dev` container, 4 KiB pages, so 16 KiB granules),
  `e503b7ee8`: every main fixture and stress variant (serial, parallel and
  copying) passed under LLDB 19.
  Evidence: [Linux arm64 runs](worker-runtime-zero-copy-v1-linux-arm64.txt).
- **Linux x86-64** (Debian 13 VM): the serial and parallel main fixtures and
  stress passed. The copying runtime is not supported on x86-64 yet.
  Evidence: [x86-64 runs](worker-runtime-zero-copy-v1-x64.txt).

Two things were found and fixed on x86-64 (`e503b7ee8`):

- Its `memory-release` maps only over the isolate's managed heap, so
  returning a freed body's pages failed and threw inside a collection. A
  refused release now leaves the body resident (counted), and the runtime
  stops asking.
  - Consequence: on x86-64, arena pages are reused but never returned to the
    OS.
  - arm64 returns them; its `memory-release` follows the documented contract
    and has no range check.
- The fixture's in-flight step assumed the sending turn's frames drop the sent
  string before a collection in that same turn. On x86-64 they did not, so
  the step now collects in a later turn.

## Open decision

x86-64's `memory-release` is confined to the managed mapping, so x86-64
never returns freed arena pages to the OS. Two ways to fix that:

- relax its range check to the documented contract, as arm64 has it;
- add a dedicated page-release operation for the arena.
