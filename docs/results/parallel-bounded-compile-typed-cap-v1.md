# Typed streaming compiler at a 2,176 MiB heap setting

On November 21, 2026, the typed streaming prototype compiled the frozen
2,252-variant Object selection with Node 24.12.0 on macOS arm64. It used
8 MiB packed storage, 2,176 MiB V8 old space, and 4 MiB semi-spaces.
The frozen input SHA-256 was
`7d3f40ab7477dce55da4b3dff2f539c91678141eba2ee077a7556968fcbeed42`.

The prototype drops its linked application reference at ownership
transfer and keeps template origin records only for blocks with local
templates. The optimizer uses stored bodies and commits changed bodies
after each ordered pass. The AArch64 emitter resolves compact branches
within their owning function and retains symbolic cross-function
references. A small closure fixture produced identical code, symbols,
and line ranges in memory, budget, and forced-spill modes.

The Object build exhausted V8 heap in the collection-runtime retry
after the helper-specialization checkpoint, before it created a spill
segment for lowered Object IR. At that checkpoint, RSS was 2,064,236,544
bytes, JS heap use was 1,367,176,432 bytes, and external memory was
138,978,534 bytes, including 128,869,097 bytes of array buffers. The
last full collection left 2,127.9 MiB in use. The allocation stack
included V8 object cloning and array mapping.

Maximum RSS was 2,998,042,624 bytes, with 280.74 s wall time,
232.96 s CPU, and 604.064 billion cycles. The process aborted before
publishing an image. The RSS observation therefore falls within the
2.8 GiB limit for a failed build. The complete image comparison
remains open. The log is `object-packed-typed-low-2176.log`.
