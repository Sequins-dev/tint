# One-byte strings: code-unit conversion and integer digits (s5, v1)

Recorded 2026-11-23 on macOS arm64 (Apple M5 Max), using the
[slice 3 protocol](string-slice3-ab-v1.md): `tools/string-bench`, 15 paired
rotated rounds, LLDB-asserted native runs and Node 26.13.1.

## Candidate

s5 was prepared from `90fa09a04` plus an uncommitted patch (hash
`6bacfa6a8ddf…`). The patch made two changes:

- **Code-unit conversion (code generation).** `String.fromCharCode` loads
  each code unit with `wordValue`. That reads integer-stored values and
  exact doubles inline, and calls the `to-uint32` helper only for other
  values. Before, every unit not stored as a 32-bit word called the helper.
  `string-from-code-units` also became an integer-accepting use.
- **Integer digits (number-text).** Digit groups were computed with
  `value | 0` and multiply-shift quotients, and `numberToString` gained a
  small-integer test first.

The base is the `90fa09a04` images (typed `5a8841afac5a92f5…`). s5's typed
image is `8914430fe3ff7074…`. One-minute load at round starts was 3.7–5.5.
Raw rounds: [typed](string-s5-ab-v1-typed.json),
[general](string-s5-ab-v1-general.json) and
[frozen](string-s5-ab-v1-frozen.log).

## Results

s5 against `90fa09a04` (steady medians, paired s5/base):

| Kernel      | Node | base |   s5 | s5/base          |
| ----------- | ---: | ---: | ---: | ---------------- |
| create      |  8.7 | 17.6 | 19.7 | 1.12 (1.11–1.14) |
| template    | 16.8 | 20.9 | 23.9 | 1.14 (1.10–1.15) |
| stringBuild | 18.9 | 47.8 | 55.4 | 1.15 (1.14–1.19) |
| strings     | 12.9 | 21.6 | 22.4 | 1.05 (1.02–1.07) |
| mapKeys     | 13.8 | 20.5 | 21.4 | 1.03 (1.02–1.05) |

The other kernels were within ±3%. Frozen v7 (`ob5` against `s5`, five
interleaved runs) was neutral: paired cycles ranged from −1.2% to +1.4%,
with a median of +0.3%.

### Attribution

Four images of the affected kernels, measured together in 15 rounds
([raw](string-s5-attribution-v1.json); load 3.7–7.9):

- V0: `90fa09a04`;
- V1: V0 with the code-unit change only;
- V2: V0 with the integer digits only;
- V3: both.

| Kernel       | Node |    V0 | V1/V0 | V2/V0 | V3/V0 |
| ------------ | ---: | ----: | ----: | ----: | ----: |
| create       | 8.44 | 17.04 | 0.943 | 1.145 | 1.136 |
| template     | 16.4 |  20.1 | 0.995 | 1.152 | 1.156 |
| stringBuild  | 18.9 |  46.7 | 0.987 | 1.169 | 1.141 |
| strings      | 13.0 |  20.3 | 1.024 | 1.095 | 1.079 |
| mapKeys      | 13.4 |  20.1 | 0.992 | 1.049 | 1.051 |
| numberString | 0.77 |  1.69 | 1.005 | 1.037 | 1.003 |

## Decision

- **Kept:** the code-unit conversion (`create` −5.7%, the others within
  noise).
- **Reverted:** the integer digits. The double version is faster in every
  affected kernel. The integer form adds a `value | 0` round trip at each
  call and more callee-saved registers, and Tint's prologues are not
  shrink-wrapped, so the saves are paid on every call.
