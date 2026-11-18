# Compiler link-memory probes, 2026-11-19

The Node 24.12.0 suite build used `TZ=UTC`, module support, and suite linking for
`language/expressions/object`. The probe forced GC at each instrumented seam.
Raw `.probe`, `.err`, and `.json` files are in the session's `scratchpad/bm`
directory (session `9f6a53a7-7af8-4730-8505-43ba9450ac72`).

| Run            | Source      | Old-space cap (MiB) | Result                 | Peak RSS (MiB) | Wall (s) |
| -------------- | ----------- | ------------------: | ---------------------- | -------------: | -------: |
| `obj-link`     | `eb1d822db` |             100,000 | 2,252 / 2,252          |          7,086 |   400.23 |
| `obj-lm-fine`  | `34a064ec7` |             100,000 | 2,252 / 2,252          |         11,677 |   635.76 |
| `obj-cap-3072` | `eb1d822db` |               3,072 | V8 OOM during linking  |          4,143 |    59.16 |
| `obj-lm-3g`    | `34a064ec7` |               3,072 | V8 OOM during checking |          4,152 |    96.12 |

The uncapped link-memory run included additional check-stage GC probes. RSS and
wall time are observations of those instrumented runs.
