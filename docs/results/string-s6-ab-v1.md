# One-byte strings: concatenation with one allocation (s6, v1)

Recorded 2026-11-23 on macOS arm64 (Apple M5 Max), using the
[slice 3 protocol](string-slice3-ab-v1.md): `tools/string-bench`, 15 paired
rotated rounds, LLDB-asserted native runs and Node 26.13.1.

## Candidates

The base is `6ea61924f` (typed image `3ae357de641a74d1…`). Both candidates
add its typed string lowering change:

- **Templates.** A template literal skips empty literal parts.
- **Concatenation in one allocation.** A template, or a typed string `+`
  chain of three or more operands, is built with one allocation: the
  summed lengths, the kind from its pieces' two-byte flags, and a
  `string-write` per piece, as `join` lowers. Before, each step allocated
  and copied the whole prefix. A chain is fused only when every operand is
  a string, number or boolean that is neither speculative nor a BigInt
  (static checker facts), so other chains keep their existing path.

| Label | Adds                                                                | Typed image         |
| ----- | ------------------------------------------------------------------- | ------------------- |
| s6    | the lowering change                                                 | `6ca5f8e812efe16b…` |
| s6a   | s6, with every private AArch64 helper aligned to a 64-byte boundary | `2baa0c129237016a…` |

One-minute load at round starts was 1.8–3.4 (typed) and 2.2–7.7
(general). Raw rounds: [typed](string-s6-ab-v1-typed.json) and
[general](string-s6-ab-v1-general.json) (general: base against s6a).

## Results

Steady medians. Paired ratios against the base, with the s6a interquartile
range:

| Kernel      | Node | base |   s6 |  s6a | s6/base | s6a/base          | s6a/Node |
| ----------- | ---: | ---: | ---: | ---: | ------: | ----------------- | -------: |
| template    | 15.9 | 19.5 | 15.4 | 15.6 |   0.786 | 0.798 (0.79–0.80) | **0.98** |
| strings     | 11.9 | 20.4 | 19.0 | 19.3 |   0.931 | 0.947 (0.94–0.95) |     1.62 |
| stringBuild | 17.7 | 46.1 | 43.3 | 43.6 |   0.944 | 0.948 (0.94–0.96) |     2.46 |
| clone1MiB   |  3.0 |  3.4 |  3.2 |  3.3 |   0.948 | 0.966 (0.94–0.98) |     1.11 |
| utf8        |  1.1 |  0.7 |  0.9 |  0.9 |   1.298 | 1.295 (1.28–1.33) |     0.80 |
| search      | 14.4 | 11.2 | 11.6 | 11.6 |   1.034 | 1.033 (1.03–1.04) |     0.81 |
| create      |  8.2 | 16.0 | 16.4 | 16.4 |   1.027 | 1.021 (1.02–1.04) |     1.99 |

The other typed kernels, and general `upperCase` and `json`, were within
±1.5% for both candidates (`splitJoin` +2.6% for s6a only).

## Decision

- **Kept:** the lowering change. `template` drops 20% and now beats Node.
  `strings` and `stringBuild` drop 5–7%.
- **Rejected:** helper alignment. s6a measured the same as s6, so it does
  not help.
- **Open:** `utf8` (+30%, still 0.8× Node), and `search` and `create`
  (+2–3%). Neither kernel's hot path has a template or a string `+` chain,
  and aligning the helpers did not change them. This is investigated
  separately with profiles of both images.
