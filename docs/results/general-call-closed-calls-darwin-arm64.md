# Closed source calls on Darwin arm64

Sixteen rotated rounds compared the property-cache image with the closed-call
trial. The typed image was byte identical. Each native execution stopped at
entry, matched the expected checksums and exited with status 42.
[Raw paired rounds](general-call-closed-calls-darwin-arm64.json)

| Kernel          | Node 26.13.1 median (ns) | Property caches (ns) | Closed calls (ns) | Paired change (ns) |      Paired IQR (ns) |
| --------------- | -----------------------: | -------------------: | ----------------: | -----------------: | -------------------: |
| Array           |                    18.22 |               206.72 |            185.09 |              −6.39 |      −49.03 to 19.96 |
| Closure         |                    22.64 |               113.15 |            101.90 |             −15.78 |      −65.18 to 14.61 |
| Control         |                     9.06 |                 1.99 |              1.97 |              −0.03 |        −0.21 to 0.54 |
| Method          |                    12.89 |               176.49 |            151.39 |             −23.49 |      −46.42 to −0.02 |
| Property        |                     4.86 |                74.48 |             69.17 |              −8.45 |       −22.08 to 0.11 |
| Recursive       |                   741.10 |              8383.46 |            224.81 |           −8133.68 | −9639.19 to −7451.92 |
| Rest            |                    36.90 |              2168.96 |           2372.30 |              20.68 |    −239.88 to 539.63 |
| String equality |                    13.69 |                60.79 |             58.75 |              −1.02 |       −47.74 to 3.21 |

The recursive kernel's paired median was 468.03 ns below Node's, with an
IQR of 378.01 to 826.67 ns below Node. A separate LLDB run on debug image
`c68864f9b20aa0e66c4dda72f8b611bb9a7b014bcc4449f7d1ede8c17d3e40a4`
verified input `d0 = 2`, the return PC, the caller's stack pointer and exit 42.
`fib(2)` retired 65 instructions with two direct recursive branches and zero
managed allocations. The general path had retired 10,963 instructions and
allocated 31 objects (1,304 B) for the same call tree.
[Closed fib trace](general-call-closed-fib-2-darwin-arm64.json),
[general kernel traces](general-call-control-and-kernel-traces-darwin-arm64-77ae22dbe.md)
