# Controlled hash-host comparison

Holding the embedded native compiler source fixed, the hash change's original
roughly 12% CPU increase is **not reproduced**. In three sequential cold pairs,
the hash-fixed host uses less CPU each time and produces byte-identical images.
Both frozen hosts predate C2's checker fix. This is Node compilation, not a
native execution speedup and not Test262 coverage.

| Frozen Node host | Compile CPU seconds, median [min–max] | Compile wall seconds, median [min–max] |
|---|---:|---:|
| Before graph-local hash fix | 508.698 [395.600–528.028] | 892.717 [460.779–1118.000] |
| Hash-fixed | 390.422 [372.390–447.268] | 491.822 [386.295–747.798] |

The CPU median ratio is 1.303×. Order is old/fixed, fixed/old, old/fixed.
Substantial spread and differing load are retained per run in the
[structured report](native-hot-functions-v4-cross-source-hash.json). All six
compilations produce the same 158,070,527-byte image, SHA-256
`78fb1e18aadb32d49ef38127be0c67ab48b4cf0d51fae906a3548a3851f1ff74`.
Checker graph and emitted IR traces are also byte-identical: the main emitted
module has 21,328 functions, 1,042,712 blocks and 4,142,133 IR instructions.
There is no observed loss of structural sharing or output deduplication.

The original B pair changed both the Node linker and the linker source compiled
into the native image; that candidate image was 2.40% larger. The controlled
comparison supplies the same `bb9bce32…` source graph, same two unchanged
left-shift variants, harnesses and build settings to both hosts. Module execution,
dynamic import and JSON module support are enabled in both. A read-only wrapper
records structural counters; no V8 CPU profiler is enabled. `process.cpuUsage`
measures compile user+system CPU, separately from wall and load. The report retains
all frozen identities and inputs.

The evidence does not justify reverting the hash correctness fix. The new hashes
also avoid collisions among linked copies that previously shared source hashes
or generated spans, but this experiment does not measure probe counts or assign
the timing difference to one mechanism. The independent 64-variant interruption
still implicates checker flow facts and V8 named-property lookup; C2's merged
`63e5264` addresses declarations scanning unrelated facts. The [earlier table](native-hot-functions-v3.md)
retains that pre-fix profile. Fresh C2-based native compiler and addition runs
remain separate observations.

At an unproven constant cost per 64-variant batch, these CPU medians imply
228.07 versus 175.04 compilation-only CPU hours for 103,264 variants. The measured
selection contains two variants; the pathological large batch did not complete.
These are conditional scenarios, excluding execution and preparation, not suite
forecasts.
