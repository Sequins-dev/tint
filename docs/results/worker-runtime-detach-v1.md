# Worker transport: detach-aware typed views and a codec regression

23 November 2026, macOS arm64 (M5 Max), Node 26.13.1 as the reference.

- Every run is paired and rotated, 15 rounds, under the timing lock. Each
  table names the run's 1-minute load average; other sessions shared the host.
- Native images ran under LLDB. Each stopped at entry and exited 42.
- Base images come from the frozen `e47f38614` toolchain
  (`.tint-bench/test262/tc-e47f38614`). Bisect images were built from clean
  checkouts of each commit.

## Detach-aware typed views of realm typed arrays (`c207bdcf1`)

A typed view of a realm typed array over an ordinary buffer
(`projectNativeTypedArray`) now observes the buffer's detachment, as a realm
typed array does, instead of pinning the buffer. The semantics are in
`docs/unified-pipeline.md`, under "Narrowed typed-array values".

- The buffer's backing record lists its projected views. Detaching it
  (`transfer`, `transferToFixedLength` or a Worker transfer) runs one hook,
  which detaches each view through the `native-array-detach` host operation.
- A detached view has length 0, and its data pointer sits one word before
  its owner's payload.
  - Element reads give undefined and writes are ignored, through the existing
    bounds check.
  - `byteOffset` reads as 0.
- `Atomics` and the validating methods (`fill`, `set`, `subarray`, `slice`,
  `join`, `at`, `reverse` and iteration) throw TypeError. They test the
  length first, so a nonempty array pays one compare.
- LICM still hoists a typed-array length out of a loop, unless the loop may
  change it. That means an operation with the invoke effect, a may-callback C
  call, or a C-memory adoption or retarget.

**Cost.** Base `e47f38614`; new is `c207bdcf1`'s tree.

| Benchmark                               | Load | New / base |
| --------------------------------------- | ---: | ---------: |
| PR #17 `typedArrays` kernel (48.1 ms)   |  4.6 |      1.00× |
| Typed transport, each operation         |  4.3 | 0.97–1.00× |
| Untyped transport, each operation       |  4.0 | 0.98–1.02× |
| Frozen v7, instructions                 |  2–4 |    1.0004× |
| Frozen v7, cycles                       |  2–4 |    1.0005× |
| Frozen v7, wall                         |  2–4 |    1.0022× |
| Frozen v7, peak RSS                     |  2–4 |    0.9997× |

The kernel's machine code is unchanged. The runtime grows by 1.8%, from the
length-0 tests, their TypeError paths and the `byteOffset` clamp.

Evidence:
- [kernel](worker-runtime-detach-v1-typed-arrays.json)
- [typed transport](worker-runtime-detach-v1-typed-transport.json)
- [untyped transport](worker-runtime-detach-v1-transport.json)
- [frozen v7](worker-runtime-detach-v1-frozen-v7.txt)

## Codec regression from `e55e9f7d0` (fixed in `3934a2cec`)

`e55e9f7d0` taught the Worker codec to clone a typed program's native typed
arrays. It tested every value with four `instanceof` checks before viewing it
as a realm object. On the general path those are realm instanceof calls, so
every record, tree node, string and buffer message paid for them.

A rebuild of `e55e9f7d0` with only the codec reverted is the same size as the
`6d37cee2b` image, so `bb24c5a91` is not involved.

| Operation (µs, load 2.6) | `6d37cee2b` | `e55e9f7d0` | Change |
| ------------------------ | ----------: | ----------: | -----: |
| Round trip               |        6.62 |        8.14 |  1.22× |
| Clone, 16 records        |        55.5 |       112.9 |  2.04× |
| Clone, depth-10 tree     |       7,057 |      15,502 |  2.20× |
| Clone, 1 KiB string      |        8.93 |       12.06 |  1.35× |
| Transfer, 64 KiB         |        9.31 |       14.02 |  1.50× |

`3934a2cec` views the value as a realm object first. Only a value that is not
a realm object is then tested as a native typed array, since a native typed
array is opaque to the realm.

| Operation (µs, load 3.3) | `6d37cee2b` | `e47f38614` | `3934a2cec` | / Node |
| ------------------------ | ----------: | ----------: | ----------: | -----: |
| Round trip               |        6.60 |        8.13 |        6.70 |  0.77× |
| Clone, 16 records        |        57.4 |       119.6 |        57.3 |  2.75× |
| Clone, depth-10 tree     |       7,184 |      15,887 |       7,237 |  5.54× |
| Clone, 1 KiB string      |        9.00 |       12.19 |        9.12 |  0.96× |
| Transfer, 64 KiB         |        9.36 |       14.13 |        9.52 |  0.95× |

Evidence: [bisect](worker-runtime-detach-v1-codec-bisect.json),
[fix](worker-runtime-detach-v1-codec-fix.json).

## The 1 MiB string clone in the suite

In the full transport suite the 1 MiB clone took about 145 µs (0.93× Node)
up to `a74d5be25`, and about 194 µs (1.2×) from `690468336` on.

| Image (load 2.2) | µs per round trip |
| ---------------- | ----------------: |
| `550fa5d3a`      |             148.7 |
| `a74d5be25`      |             147.4 |
| `690468336`      |             193.7 |
| Node             |             155.6 |

This is a shift in heap state, not added work:

- Neither half of `690468336` reverted alone restores it.
  - Reverting the Worker host and message changes gave 207 µs.
  - Reverting the codec gave 182 µs, with samples in both modes
    (interquartile range 151–216 µs, load 4.5).
- Collections:
  - LLDB counts show no major collection before the phase on either image.
  - Both images map the same large packets in every phase.
  - The slower image takes fewer page reclaims per run (79,500 against
    84,400).
- Per sample, both images have one slow sample out of three in the phase,
  where a minor collection copies the in-flight 2 MiB string. The older image
  returns to the fast mode in its third sample; the newer one does not, so its
  median lands in the slow mode.
- Polling longer before parking does not remove it. A 300 µs pre-park spin
  gave 0.93× with an interquartile range of 0.83–0.96× (load 4.5), and made
  `terminate` 3.5× slower.

Evidence: [bisect](worker-runtime-detach-v1-mib-bisect.json),
[spin experiment](worker-runtime-detach-v1-mib-spin.json).

The phase allocates one 2 MiB UTF-16 string per hop into a 32 MiB nursery, so
where its collections fall decides the median. Two planned changes shrink
that: the one-byte string representation (`perf/one-byte-strings`) halves the
bytes per hop, and the nursery warm-up work changes when collections fall.
The isolated 1 MiB clone (3.04× Node,
[nursery report](worker-runtime-nursery-v1.md)) waits on the same two.

## Transport against Node after `3934a2cec`

Operations still above Node, macOS arm64, from the fix run:

| Operation             | / Node | Bound by                                     |
| --------------------- | -----: | -------------------------------------------- |
| Clone, 16 records     |  2.75× | untyped object model and call floor (PR #12) |
| Clone, 1,024 records  |  4.19× | PR #12                                       |
| Clone, depth-4 tree   |  4.24× | PR #12                                       |
| Clone, depth-10 tree  |  5.54× | PR #12                                       |
| Clone, 1 MiB string   |  1.21× | one-byte strings and nursery warm-up         |
| wait/notify           |  1.27× | untyped builtin call floor (PR #12)          |
| Counter, 1 Worker     |    40× | untyped builtin call floor (PR #12)          |
| Counter, 4 Workers    |   7.3× | untyped builtin call floor (PR #12)          |
| Typed batch           |  1.03× | not yet profiled (in the typed transport)    |

Every other transport operation is at or below Node.
