# @tint/native-runtime/allocators/linear

An allocation-free bounded linear range reservation primitive. `reserveLinear`
takes a caller-owned `Uint32Array` containing `[top, exclusiveLimit]`, a positive
byte count and power-of-two alignment (default 16). It aligns both the start and
size, changes only `top`, and returns the reserved offset. Failure returns undefined
without mutation. Padding consumes capacity; the limit need not be aligned.

This is reusable storage arithmetic, not a collector, OS mapping, object inventory,
or ownership policy. The caller exclusively owns the state, keeps it disjoint from
the reserved range, and authorizes its lifetime. Resetting the state while a prior
reference is live is invalid unless a separate relocation/lifetime mechanism has
handled every alias. The function accepts offsets, not absolute native addresses.

The checked implementation supplies reference behavior for a future generated
nursery fast path; no generated fast path or nursery is enabled by this package.
Native code may omit checks only after proving the same bounds and representation
invariants. Tests compare mixed reservations against an independent occupancy oracle
and cover failure preservation and the uint32 upper boundary.
