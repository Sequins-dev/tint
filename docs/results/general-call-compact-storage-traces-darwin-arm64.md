# Compact property storage instruction and allocation traces

LLDB single-stepped 32 steady-state iterations at the same source counters
as the preceding native path traces and verified inferior exit 42. The
ranges cover the receiver or value variants inside each kernel. The raw
records list every call and allocation site observed in those windows.

| Kernel             | Instructions | Calls | Allocations | Allocated bytes |
| ------------------ | -----------: | ----: | ----------: | --------------: |
| allocateObjects    |         8038 |    70 |          14 |            1264 |
| arguments3         |         1433 |    11 |           0 |               0 |
| arguments4         |         1563 |    11 |           0 |               0 |
| arguments5         |         1693 |    11 |           0 |               0 |
| arguments6         |         1823 |    11 |           0 |               0 |
| buildString        |     538–4440 |  1–45 |        1–12 |          64–384 |
| catchInLoop        |    1138–1694 | 10–19 |           0 |               0 |
| concatenateStrings |      686–706 |   3–5 |           1 |              32 |
| mixedCall          |    1480–2736 | 16–31 |           0 |               0 |
| mutableCapture     |    1099–1100 |    10 |           0 |               0 |
| objectArray        |          864 |     4 |           0 |               0 |
| objectRoundTrip    |         1680 |    14 |           0 |               0 |
| receivers2         |    1704–2170 | 14–18 |           0 |               0 |
| receivers4         |    2176–2707 | 18–22 |           0 |               0 |
| receivers8         |    2242–2886 | 18–22 |           0 |               0 |

The six-argument iteration spent 771 instructions in the callee and
637 in the caller, with 76 in object projection. Remembered-object
barriers accounted for 104 instructions. Source-caller entry and cleanup
used 91 and 21. Execution-name entry and cleanup used 79 and 44. The
ordinary value was passed through the experimental native entry without
an argument list. The allocation-heavy iteration still made 14
allocations totaling 1,264 bytes, including a 616-byte object and its
separately allocated descriptor and property storage.

[Compact storage traces](general-call-compact-storage-traces-darwin-arm64.jsonl),
[previous instruction and allocation reports](general-call-native-path-traces-darwin-arm64.md)

The traced executable is the same debug image used in the compact
generality comparison. Its SHA-256 is
`edb8e2f4ec74c9ddbc69c2c5708832394e4fa1196d496b3704f5194da069976c`.
The build manifest SHA-256 is
`aca9c5121ecae936774cd1322de7f0cac7fd2ae97abd8f49469edbe2b8c08bce`.
