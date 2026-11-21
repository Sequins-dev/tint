# Native worker message transport

The [port fixture](../../tools/build-worker-ports-fixture.ts) checks FIFO
delivery through endpoint transfer, the callback checkpoint between messages,
peer close after delivery, and startup-port adoption by a detached worker.
The [message fixture](../../tools/build-worker-messages-fixture.ts) checks that
invalid transfer lists leave the sender intact. It also checks source detachment,
backing address identity at the receiver, shared block identity, and messaging
through a transferred port.

All six runs stopped at entry under LLDB and exited 42. The hosted builds used
`TZ=UTC TINT_BUILD_ONLY=1 TINT_GENERAL_FALLBACK=0`.

| Fixture | Target | Source snapshot SHA-256 | Image SHA-256 |
| --- | --- | --- | --- |
| worker-ports | darwin-aarch64 | `aa28bd5e812e62e0e376fcb6bbad281035a2a7e44cee0bfc19d926ec73f526fd` | `18f00ac726de4c578c5cb6a5ef1daf8eba954daf595c323ab27044daf8e5b699` |
| worker-ports | linux-aarch64 | `aa28bd5e812e62e0e376fcb6bbad281035a2a7e44cee0bfc19d926ec73f526fd` | `f017165b84a7eec396d64f72625c3d80fa9078207bb9f9499193b3a825f10aa4` |
| worker-ports | linux-x86_64 | `aa28bd5e812e62e0e376fcb6bbad281035a2a7e44cee0bfc19d926ec73f526fd` | `b6e768a1a841bce9c22c897902124d72970162143a1e8c36c85fcd333aecfe2e` |
| worker-messages | darwin-aarch64 | `aa28bd5e812e62e0e376fcb6bbad281035a2a7e44cee0bfc19d926ec73f526fd` | `84ef88b15d4a0229f6a766fdcf8a0a51b66c9b3c5eef95f5f0b015ce02fb8c6d` |
| worker-messages | linux-aarch64 | `aa28bd5e812e62e0e376fcb6bbad281035a2a7e44cee0bfc19d926ec73f526fd` | `7198e6a62ea50703cca0d308d03fd6cafa24fa90cc7bc71b307da9b9c3b18eb2` |
| worker-messages | linux-x86_64 | `aa28bd5e812e62e0e376fcb6bbad281035a2a7e44cee0bfc19d926ec73f526fd` | `649632e897ff9304cac907997110e4b7c27eb2da1cbf7aca485fe951f42a495d` |
