# Cross-isolate wake for Atomics.waitAsync

The [Worker suite](../../tools/worker-threads-suite.mjs) adds a case where
the parent waits asynchronously on shared memory. The worker notifies the
parent, then blocks on a separate word. The parent must observe the notification
before releasing the worker. The worker sends no message during the wait.
A watchdog rejects a run that receives no reactor wake.

The suite passed under Node 26.13.1. Each native image stopped at entry under
LLDB and exited 42.

| Host | Source snapshot SHA-256 | Image SHA-256 |
| --- | --- | --- |
| macOS arm64 | `b25ce746b429e5ece94445e8ed488fcdeedb6cdb725e868918a7f7cfa3d028b5` | `ef817fe30599d0f2a092219a4760a6bb0c264ac105480610b6d0027c88e8ff6d` |
| Linux arm64 development VM | `bc72d4ed7a5a4c5dc4cbdd0a08a1f64b34c1c8cd9e0506445da710b33a1f2974` | `85a2dbd47bacfa58892c36e11892fe69e1b44cd585b6ae6e50a857603d18c37b` |
| Linux x86-64 Debian VM | `bc72d4ed7a5a4c5dc4cbdd0a08a1f64b34c1c8cd9e0506445da710b33a1f2974` | `f20d50b98d348aa53a50440d687e28a1cc25674ab62a3b0a00c63f059d7c0edd` |
