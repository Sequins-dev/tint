# @tint/bench/native

Strict synchronous subset of the experimental Node.js 26.9+ `node:bench`
declaration API. The native benchmark builder maps `node:bench` imports here;
Node executes the real built-in module. Both run the same workload source.

Supported declarations are `bench(name, { warmup, samples }, callback)` and
`suite(name, callback)`. Contexts expose `name`, `phase`, `index`, `start()` and
`end(operations)`. Declarations finish before serial execution. Timing excludes
setup and result validation. Every invocation gets a fresh context.

`runBenchmarks(now, emit)` is Tint's host integration function, not Node's stream
API. It executes once, emits raw sample results and rejects later declarations.
The native profile does not expose Promise results, asynchronous callbacks,
streams, hooks, filtering, cancellation, context recording/details, or automatic
event-loop scheduling. A failure aborts this native run; the comparison driver
rejects partial output instead of comparing it with a successful Node run.
The supported context `end` return is unused/void; Node's returned sample object
is outside this initial profile. Names are joined with `>` for reporting.

No platform or filesystem imports are present. The caller supplies the clock
and result sink; registration and execution remain reusable independently.
