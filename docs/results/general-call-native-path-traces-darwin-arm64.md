# Native call, property and element instruction traces on Darwin arm64

Each image ran the same 15 generality kernels. LLDB single-stepped 32 warm
loop iterations at matching source counters, verified entry and continued
each inferior through exit 42. Cells report retired instructions, calls and
managed allocations in that order. Ranges span the traced receiver or value
variants within a kernel. The raw traces attribute calls and allocations to
functions and record allocation sizes.

| Kernel | Previous PR baseline | Native entry | Inline primary property cache | Integer elements |
| --- | ---: | ---: | ---: | ---: |
| allocateObjects | 9365 / 84 / 18 | 9177 / 81 / 18 | 9064 / 81 / 16 | 8040 / 70 / 14 |
| arguments3 | 1759 / 15 / 0 | 1636 / 13 / 0 | 1433 / 11 / 0 | 1433 / 11 / 0 |
| arguments4 | 1865 / 15 / 0 | 1766 / 13 / 0 | 1563 / 11 / 0 | 1563 / 11 / 0 |
| arguments5 | 1971 / 15 / 0 | 1896 / 13 / 0 | 1693 / 11 / 0 | 1693 / 11 / 0 |
| arguments6 | 2077 / 15 / 0 | 2026 / 13 / 0 | 1823 / 11 / 0 | 1823 / 11 / 0 |
| buildString | 503–4260 / 1–43 / 1–12 | 538–4357 / 1–44 / 1–12 | 538–4438 / 1–45 / 1–12 | 538–4440 / 1–45 / 1–12 |
| catchInLoop | 1304–1859 / 13–22 / 0 | 1138–1694 / 10–19 / 0 | 1138–1694 / 10–19 / 0 | 1138–1694 / 10–19 / 0 |
| concatenateStrings | 643–669 / 3–5 / 1 | 686–706 / 3–5 / 1 | 686–706 / 3–5 / 1 | 686–706 / 3–5 / 1 |
| mixedCall | 1626–2876 / 19–34 / 0 | 1480–2736 / 16–31 / 0 | 1480–2736 / 16–31 / 0 | 1480–2736 / 16–31 / 0 |
| mutableCapture | 1234–1235 / 13 / 0 | 1099–1100 / 10 / 0 | 1099–1100 / 10 / 0 | 1099–1100 / 10 / 0 |
| objectArray | 1509 / 11 / 0 | 1530 / 11 / 0 | 1121 / 7 / 0 | 864 / 4 / 0 |
| objectRoundTrip | 2479 / 23 / 0 | 2332 / 20 / 0 | 1680 / 14 / 0 | 1680 / 14 / 0 |
| receivers2 | 3193–3251 / 29 / 2 | 3025–3079 / 26 / 2 | 1964–2431 / 17–21 / 0 | 1704–2171 / 14–18 / 0 |
| receivers4 | 3137–3251 / 29 / 2 | 2969–3081 / 26 / 2 | 2437–2969 / 21–25 / 0 | 2177–2709 / 18–22 / 0 |
| receivers8 | 3130–3242 / 29 / 2 | 2962–3074 / 26 / 2 | 2500–3148 / 21–25 / 0 | 2243–2891 / 18–22 / 0 |

The six-argument kernel already allocated nothing in the traced baseline
iteration. The native entry reduced it from 2,077 instructions and 15 calls
to 2,026 instructions and 13 calls. Inlining the property cache brought it
to 1,823 instructions and 11 calls. The remaining instructions include 771
in the callee, 637 in the loop body, 339 in source-call and execution-name
bookkeeping and remembered-object barriers, and 76 in object projection.

The array-of-objects kernel fell from 1,530 instructions with the native
entry to 1,121 with the property cache, then to 864 with inline packed array
reads. The allocation-heavy kernel still allocated 1,264 bytes in 14 objects
and bookkeeping records per traced iteration, including a 616-byte ordinary
object. These are instruction observations and allocation counts.

The native entry uses the experimental ARM64 AOT mode. It handles same-Script
ordinary synchronous calls. Foreign contexts, special callable objects,
spread, and proper tail calls retain the general dispatch. This property
prototype inlines the first cache state. Secondary states and the fixed-size
megamorphic cache run in the miss stub. Packed reads are inline. Typed-array
reads borrow ordinary storage in the runtime helper.

| Image | SHA-256 | Source patch SHA-256 |
| --- | --- | --- |
| Native entry, early prototype | `cc94a3758d709673d602690f85b4e0d10e720c8b2cd5e3384b40408342966fe0` | `6f4ce892d0112117fbe873466932e8b07f4cf62cc104a43f777607415358873a` |
| Inline property cache | `b07ea24efb775c014c41fb54b2a2cce047b1fc36bc4250e1dff61c81f1057334` | `de62d78fd6bad44d8afcfc95c61d05bc8829125a76e1c3a75336346014e6b0e5` |
| Integer elements | `5245e520d3d0070b80a3e059ef3e19aa63e5ee15cce59fe1cc41a2207c7f8cb7` | `85ddb4baf70cf2b3c17bd4da2a449810b17e382ca2ed1292ced32480805d05da` |

[Prototype traces](general-call-native-path-traces-darwin-arm64.jsonl), [previous PR baseline traces](general-call-generality-merged-traces-darwin-arm64.jsonl)
