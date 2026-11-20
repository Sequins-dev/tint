# Native Worker API suite

The [same Worker suite](../../tools/worker-threads-suite.mjs) ran on Node
26.13.1 and in hosted Tint images built by
[the native runner](../../tools/build-worker-threads-suite.ts). It covers
isolate metadata, worker data, local and transferred ports, clone errors,
cyclic objects, transferred ArrayBuffer storage, SharedArrayBuffer visibility,
the stack resource-limit field, error and exit ordering, and termination of
a worker in an allocation loop.

The native runs used `TZ=UTC TINT_BUILD_ONLY=1`. LLDB stopped each image at
entry and observed exit status 42.

| Host | Source snapshot SHA-256 | Image SHA-256 |
| --- | --- | --- |
| macOS arm64 | `3c038872fdb7e040c2780b54033478e0ae837f0a1b611720cb37f20dcb1e1dec` | `0bade5fd3dcd2991c68c68d1c931e0eaae4229d85152dd42ea9a48c9bc472129` |
| Linux arm64 development VM | `3c038872fdb7e040c2780b54033478e0ae837f0a1b611720cb37f20dcb1e1dec` | `9e3928e7b3a507cb45c21ae843969ed3b2cc44090e655de405e97d6ec31eb232` |
| Linux x86-64 Debian VM | `3c038872fdb7e040c2780b54033478e0ae837f0a1b611720cb37f20dcb1e1dec` | `a1d31be6f5da3bf0fae1c2fa18fc9e899362a9e3a9734e8eb08a44c65395c509` |

An earlier macOS build stopped after entry in the module promise rejection
tracker dispatch. The passing builds preserve the program realm's typed
tracker when installing the Promise constructor.
