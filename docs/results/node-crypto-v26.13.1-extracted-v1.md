# Extracted Node crypto conformance

Node 26.13.1 and native Tint ran 41 case groups extracted from four
checksum-verified upstream files. LLVM LLDB observed every native
inferior stop at entry and exit with status 42. The extraction manifest
cites each case's file and lines and inventories 39 source ranges that
need APIs outside the proof of concept. [Extraction manifest](../../tools/node-crypto-cases.json)

| Runner                            |    Hash |    HMAC |  PBKDF2 |  Random |      Total |
| --------------------------------- | ------: | ------: | ------: | ------: | ---------: |
| Node 26.13.1, macOS arm64         |   16/16 |   13/13 |     9/9 |     3/3 |      41/41 |
| Native Tint, macOS arm64          |   16/16 |   13/13 |     9/9 |     3/3 |      41/41 |
| Native Tint, Linux arm64 on `dev` |   16/16 |   13/13 |     9/9 |     3/3 |      41/41 |
| Native Tint, Linux x86-64         | Pending | Pending | Pending | Pending | Pending CI |

The arm64 images use the same source snapshot of 828 files, SHA-256
`da64d5ad4ca2d03f2b1cb2c00cbeb351e7228a4bc5272bce73f99e840a4a0cd9`.
These are the first integrated host runs, prior to removing unused eager
Buffer exports. The current commit has its own CI runs.

| Suite  | macOS image SHA-256                                                | Linux image SHA-256                                                |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Hash   | `a6ce573b842784f7dd004e6125823d5c0d69666dabfa972300e6bf2affca09fa` | `4fe1d6abe7ce472bc7a4ab050506fd42800dca06044a74c1811b8fad21e5343d` |
| HMAC   | `97943fe34c01711ac2ec1fbfe6fde8e887729630846b0dd1e19fb49e83efb925` | `61b2fd8ab755f5799c8928a018643d311cf67d312fb2a2ec24ec204f58a826fe` |
| PBKDF2 | `71d8fb08f4e3f3fb19f5dfecb56703a3c934fb1575cff512f8ce8bd190157c6b` | `8a8f0958145a37fe2d8ab6404379651bd394b4e5b7ceeedef60f80557a761b14` |
| Random | `7bdec8919692c775d4037de5e71ad76be9466533a51f0295b5553b962bae900b` | `691ffeee4a38f386d3fa1eaa2b2a4b83c0773bd9331b41e7f0af147d81483af2` |

Separate fixtures exercised runtime `import()` and CommonJS `require`
identity, Buffer branding and unsupported operation errors on macOS.
The Linux arm64 ES module fixture verified asynchronous PBKDF2 callback
ordering and a branded Buffer with the expected derived key. The
development fixture source and output are retained in the host-validation
worktree identified by `.tint-bootstrap/crypto-host-dev-path`.
