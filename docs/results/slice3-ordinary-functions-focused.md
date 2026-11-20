# Slice 3 ordinary function fallback checks

Node 24.12.0 built these Linux arm64 images with source validation, source replay and function fallback enabled. Each inferior stopped at entry and exited 42 under LLDB on `dev`.

| Fixture | Selected function | Executable bytes | Image SHA-256 |
| --- | --- | ---: | --- |
| `function-fallback-defaults-mixed` | `observe` | 24,740,440 | `3b53d2b7504d522073b52b309562dd7fd9497e8feba54393c270fd162d40bca4` |
| `function-fallback-reexport-identity` | Module fallback with a typed kernel | 24,698,120 | `a159e503a3c14eefc40e93ad334a4e7816f8ada1cc724fed98b730a242667e2c` |
| `function-fallback-mixed-throw-object` | `exchange` | 24,625,032 | `ab248fc0b82f614365585bbb264a5e1a7d8c5ca86fdd9f7d5f7a7e5914094dfe` |
| `function-fallback-primitive-contracts` | Module fallback | 24,740,040 | `64f69e36649ba7c4cdc85f2f64959201838182a0b1ad73cb9f6002094d484e6e` |
| `function-fallback-rest-spread` | `read` | 24,703,272 | `892a5b12f55ddbe0ef93cae35f259cbf438c38920d440a69dff070c131ce1c6b` |

The first two build manifests captured source snapshot `301925e07457fab44c390bb5b5588a40065339a067ab2f5b5ba871e1cb6aa327`. The throw and contract manifests captured `2e7b84b6231163eda22a6367e669c9e52a5e568279e065002f924aa049ee52d1`. The spread manifest captured `0a46603c01ac902ea3f0524efc973b068b5f84cb5859f7ba6bf87ce1f3823e0f`.

The default fixture reenters the general function through its typed sibling and distinguishes omission from explicit undefined. The thrown object comes from the general function and is compared in typed code after a round trip. The alias fixture uses one checked callable across two imports and a re-export. The primitive contracts fixture checks a method receiver, argument and parameter write rejection, and completion after a finalizer. The spread fixture exercises fixed and variable argument counts with a required prefix.

The isolated unit planner currently handles private declarations with directly callable primitive and unknown signatures. Receiver and alias tests exercise the existing module boundary. The focused checks did not measure startup, call cycles or allocation.
