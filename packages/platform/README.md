# Platform

Host capabilities and operating-system policy, with portable services separated
from concrete adapters. Darwin arm64 is the first implemented host; Linux and
Windows implementations belong behind these boundaries.

| Public entry                     | Responsibility                                            |
| -------------------------------- | --------------------------------------------------------- |
| `@tint/platform/io/sync`         | Portable synchronous I/O protocols                        |
| `@tint/platform/files/service`   | Bounded file-service algorithms                           |
| `@tint/platform/files/system`    | Node-shaped filesystem facade over an injected raw host   |
| `@tint/platform/darwin/fs`       | Darwin filesystem binding and error policy                |
| `@tint/platform/darwin/host-abi` | Explicit Darwin symbol, flag and calling-policy data      |
| `@tint/platform/linux/fs`        | Linux filesystem binding and error policy                 |
| `@tint/platform/linux/host-abi`  | Explicit Linux/glibc symbol, flag and calling-policy data |
| `@tint/platform/target`          | `NativeTarget` output-target descriptions                 |

Trusted operation declarations live in `@tint/native-runtime/intrinsics/*`.
Their availability does not grant host authority; compiler requests supply the
verified bindings. Codegen consumes ABI data without importing platform policy.
