# Slice 3 class and suspension checks

Node 24.12.0 built four Linux arm64 fixtures from source snapshot `3749685536aec1d93f72254406e77ad5803d8fec35c01245f98b91d58b953182` with source validation and unit fallback enabled. The manifests identify the general unit and its original source span. The companion numeric kernel stays typed. Each inferior stopped at entry and exited 42 under LLDB on `dev`.

| Fixture | General unit | Image SHA-256 |
| --- | --- | --- |
| `slice3-class-fields` | `Derived` | `591c2880c427dc53b49b6b5d1d6e8246fd38b4e9758520b370875c91d681982f` |
| `slice3-suspension-async` | `produce` | `257d3aec65a5545b986d7074c96813c487ac6172f18ca2125e5103ceb3b77bb4` |
| `slice3-suspension-generator` | `observe` | `53b96e333fc1e9211329a4c932ad1ac67fbc6f98ce6c00d6704515574ab55cba` |
| `slice3-suspension-async-generator` | `observe` | `4a5701d0765fc63bc65dada544512ad86fd995fa3449c6080f8cbe1e5242b934` |

The class fixture verifies heritage and constructor identity, `new.target`, decorator order, public, static and private field contracts, descriptor writes, accessor completion and the declared result of a replaced method. The replacement keeps its identity and its original behavior when called separately. The async fixture checks the settled fulfillment of an assimilated thenable. The iterator fixtures exercise yield errors inside the body, checked resume inputs, return contracts after finally, and async request rejection.

The compiler and engine lowering passed native-subset checking. The focused class, property contract, promise, generator and general-function suites passed 74 tests. A first wrapper invocation stopped before build evidence was produced because the shell reserves its `status` variable. The recorded batch used POSIX shell with a separate result variable.
