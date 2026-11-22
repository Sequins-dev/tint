# Steady-state control and kernel traces

The control used 25 million iterations in each of 24 rotated rounds.
Each native inferior exited with status 42 under LLDB, and every
checksum matched. The controls used the earlier general result path,
the direct leaf trial, and the numeric loop version at `9b86718bb`.

| Version                            | Median ns/iteration |                IQR |
| ---------------------------------- | ------------------: | -----------------: |
| Node 26.13.1                       |               0.820 |     0.616 to 1.205 |
| General baseline                   |             220.622 | 198.964 to 257.137 |
| Direct leaf                        |              58.292 |   55.344 to 68.975 |
| Numeric loop                       |               2.026 |     1.929 to 2.297 |
| Typed loop from numeric loop build |               2.059 |     1.887 to 2.123 |

The paired numeric-loop gap to Node was 1.215 ns, with an IQR of 0.933 to 1.452 ns. [Raw control rounds](general-call-control-25m-darwin-arm64.json)

## Other kernel paths

The `77ae22dbe` debug image was single-stepped at successive loop updates.
The fib trace covers an invocation with argument 2 and its two child
invocations. Its endpoint matches the original return PC and stack
pointer. Each allocation row measures the bump-pointer publication
instruction and its aligned size.

| Window                           | Retired instructions | Calls | Managed allocations | Bytes |
| -------------------------------- | -------------------: | ----: | ------------------: | ----: |
| array                            |                 2767 |    25 |                   4 |   160 |
| closure                          |                 4812 |    47 |                  13 |   528 |
| fib-2                            |                10963 |   115 |                  31 |  1304 |
| method                           |                 7028 |    78 |                  15 |   608 |
| property                         |                 4283 |    44 |                   6 |   232 |
| rest                             |                21438 |   213 |                  45 |  2752 |
| string equality (two iterations) |                 5327 |    60 |                  11 |   608 |

The combined trace reached the array, closure, method and property
windows. The rest window exhausted the 20,000-instruction trace bound.
A separate run captured the rest and string equality windows after 20,063
loop updates. The fib run and the rest and string equality run each exited
with status 42. [Instruction summaries](general-call-kernel-instructions-77ae22dbe.jsonl)

The rest window made 45 allocations totaling 2,752 B, with 2,034 instructions
in the two property key classification helpers. Across two string-equality
iterations, `findBinding`, `lookupIdentifierValue` and `scriptBoolean`
accounted for 1,692 instructions.

The separate PProfessor run sampled the full eight-kernel image at 997 Hz.
The biggest self-time functions in the rest kernel included
`stringPropertyKeyOrder`, `scriptPropertyKeyOrder`, `hashString` and
`ordinaryGetOwnProperty`. The string equality samples included
`lookupIdentifierValue`, `scriptStrictEqual`, `findBinding` and
`scriptBoolean`. Recursion spent substantial self-time in both binding
lookup and `callObject`. The captured CPU profile SHA-256 was
`d62d1333d256c12e246c657e6b5f9fa28645db97caca1c4261b96cf6f8396603`.
