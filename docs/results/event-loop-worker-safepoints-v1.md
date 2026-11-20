# Worker interruption at managed safepoints

The [hosted fixture](../../tools/build-worker-safepoint-fixture.ts) runs two
detached workers from the same image. One enters an allocation loop. The
other resumes from an explicit host park after a stop request. The owner
expects status 1 from each worker, no error event, and no continuation or
catch-handler writes from either worker.

The initial macOS arm64 regression stopped at launch entry under LLDB and
exited 4. The allocation worker continued after the owner requested its
stop. With safepoint instrumentation, the completed fixture stopped at entry
and exited 42 on each target.

All images used `TZ=UTC`, `TINT_BUILD_ONLY=1`, and
`TINT_GENERAL_FALLBACK=0`. The source snapshot was
`692ff6a4dbe1d53504f9058bc4fb4c946c84c33d6c772817bd7a3b2b01c53068`
(807 files). The generated worker module SHA-256 recorded in its build
manifests was
`b578646e5c55c0ccec82302c5600cd26d90ff7102eae26026a8e5d6b2df88b17`.

| Host | Image SHA-256 |
| --- | --- |
| macOS arm64 | `fd657a043d76bbdaaa9a4cea66d001b693632ef93fb15215f5057e20e28ae4de` |
| Linux arm64 `dev` VM | `10ccce9940c4255598aa7b7f96c5ef1db001f6b87ba981e2476b3a39cea49f65` |
| Linux x86-64 Debian VM | `9188b7e11ff188b8ffbea4c80bef5706a69b2f356ad7baf19e8e2b4eceed811b` |

Workspace type checks, package boundaries and the native compiler
specialization check passed.
