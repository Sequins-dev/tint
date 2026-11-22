# Scoped literal tag tests on Octane

Retaining the literal `null` and `typeof` tag tests in linked Script code
recovers most of the Octane cost of removing them everywhere. All four
programs still run faster under Node 26.13.1.

Sixteen rotated rounds covered Node and three Tint arm64 debug images. Each
round ran the same pinned Octane sources through all four images under
the shared timing and launch lock. Each launch verified the workload's
completion result. A preliminary comparison mixed debug and release
settings. The earlier 98.5 ms NavierStokes difference combined the code
change and build settings. The matched comparison below supersedes it.

Every value is milliseconds per benchmark operation. Each change is the
median of the within-round differences from the shared-tag Tint image.
The brackets give the 25th and 75th percentiles of those differences.

| Program      | Node median | Shared tags | Scoped tags | Remove tags everywhere, paired change | Scoped tags, paired change |
| ------------ | ----------: | ----------: | ----------: | ------------------------------------: | -------------------------: |
| Richards     |      0.0462 |     12.3428 |     12.4461 |              +2.4395 [1.9740, 3.0389] |  +0.0749 [−0.1258, 0.4494] |
| DeltaBlue    |      0.0656 |     30.8744 |     31.0444 |              +3.4398 [2.5907, 4.3891] |  +0.5372 [−0.2299, 0.8988] |
| NavierStokes |      1.8317 |    193.5638 |    197.5050 |           +62.1127 [59.4783, 70.5698] |   +2.7399 [0.2655, 7.8046] |
| RayTrace     |      0.5012 |    301.5304 |    304.6077 |           +21.9297 [17.3189, 30.2704] |   +3.9904 [0.7682, 5.9367] |

The scoped image uses the checked general tag comparisons with the linked
JavaScript value representation. The frozen typed compiler retains the
baseline executable sections.
[Frozen code isolation and timings](general-call-frozen-v7-code-isolation-darwin-arm64.md)

The Octane input manifest records the upstream revision and SHA-256 for each
license and source. Native artifact hashes and the per-round samples identify
the builds used for these comparisons.
[Exact paired rounds](general-call-scoped-tag-octane-darwin-arm64.json)
