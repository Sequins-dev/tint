# Prelaunching the array-access worker

The deferred sidecar launch exceeded the overlap available in the
array-access pass on macOS. This experiment used the same compiler,
192 MiB worker, packed function and signed reference as the prior
rotation. The worker inferior stopped at entry before work was ready.
The debugger resumed it when the compiler published the request. Both
timed runs verified the initial stop and expected exit of each inferior.
Each adjacent pair used one timing and launch-lock admission.

| Order | Workers | Wall (s) | CPU (s) | Cycles (billions) | Peak combined RSS (KiB) | Array-access selection (s) | Emission (s) |
| ----: | ------: | -------: | ------: | ----------------: | ----------------------: | -------------------------: | -----------: |
|     1 |  Inline |  167.056 | 164.782 |           525.255 |               2,157,312 |                      7.041 |       61.999 |
|     2 |       1 |  142.162 | 161.310 |           525.161 |               2,174,064 |                      5.974 |       61.126 |
|     3 |       1 |  133.066 | 150.839 |           521.256 |               2,174,864 |                      5.315 |       59.829 |
|     4 |  Inline |  155.471 | 173.287 |           543.863 |               2,157,328 |                      6.694 |       69.218 |

Result waits fell to 5.8 ms and about 1 ms. The affected pass saved 1.07 s
and 1.38 s. Whole-build wall time fell 24.89 s and 22.41 s, and peak RSS
rose 16.4–17.1 MiB. The unchanged phases also ran faster in the worker
cells, including a 9.39 s reduction in emission in the reverse pair.
The paired pass measurements isolate the affected work more closely.
CPU and cycles sum the last compiler, worker and broker samples.
Peak RSS is the largest sampled concurrent total.

All four signed 50,163,978-byte images matched by `cmp`, SHA-256
`334b71602e62113f13c967a902a728df52e5445eacbe4eec1886bbf27eda9613`.
The binary provenance is in the
[deferred launch report](parallel-bounded-compile-array-plan-late-v1.md).
Raw logs are `bounds-prefork-darwin-rotation.log` and
`bounds-prefork-darwin-{control,pool1}-{a,b}/`.
