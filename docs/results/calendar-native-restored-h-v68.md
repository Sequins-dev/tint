# Non-ISO calendar native validation

All requested arithmetic families share the Intl calendar boundary, calendar field
resolution and reference-date rules. No host Intl service supplies their arithmetic.

| Native regression family | Completed / cases |
| --- | --- |
| Gregorian-derived calendars and eras | 9 / 9 |
| Coptic, Ethiopic and Ethioaa | 12 / 12 |
| Indian | 6 / 6 |
| Persian | 5 / 5 |
| Islamic variants | 6 / 6 |
| Hebrew | 8 / 8 |
| Chinese and Dangi | 8 / 8 |
| Hebrew postponement boundaries | 3 / 3 |

The [57-case native observation](calendar-all-families-native-h-v68.json) uses
frozen v68 and direct debugger launch, requiring both the initial stop and expected
exit for each case. It is bespoke regression evidence, not a Test262 pass count.

The [preceding integration probe](calendar-all-families-native-h-v66.json) retained
four runtime traps. A minimal [native callback comparison](native-callback-contract-direct-h-v2.json)
reproduces the defaulted-factory/required-callback signature mismatch. PlainDate's
private factory now requires its calendar argument, which every caller already
supplied. This removes an unused default and matches the existing callback
contract; all four failures pass in the complete v68 regression.

The [native self-build recheck](calendar-copy-callback-selfbuild-recheck-h-v68-v2.json)
produces byte-identical stage images, verifies signatures and DWARF, and compiles
and executes the native smoke image. Its first attempt remains separately recorded
as an interrupted launch with delayed initial entry and no final result; debugserver
sampling showed an exception-event wait rather than task_for_pid authorization.

All4701 workspace tests passed on the corrected arithmetic source. A refreshed
slotted gate covers the branch after rebasing onto main's checker-flow improvement;
its separate report records that exact base. Native evidence retains its original
frozen toolchain identities. Full per-calendar unchanged Test262 measurements are
still required; no old unsupported observations or launch failures are replaced.
