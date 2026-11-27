# Parallel frame sharing and register homes

The Linux arm64 probe extended the native sidecar from register homes
to include frame-slot sharing. The serial emitter retained placement
and read each frame plan when it reached that function. The worker sent
slot colors and register homes. The emitter could rebuild owner queries
locally if conservative root clearing required them.

The two largest captured functions each had 6,025,422 occupied slot and
block pairs. Each also used 3,389 frame groups. The byte-per-block
group map required about 72 MB per function. The first sidecar omitted
the live owner table and still failed on the four selected bodies with
256 MiB per worker. Its peak RSS reached 517,404 KiB before the failure.

The replacement used typed occupancy rows and one bit per group and
block. At the same worker limits it reproduced all four frozen
frame color vectors and register-home records. The standalone
two-worker replay took 9.46 s wall, 18.41 s CPU and 544,476 KiB
peak RSS. The live coordinator's first native build failed on a
leftover reference to the removed cache. The corrected source built
and used the same frame plan decoder during the rotation below.

## Frozen native self-compile

All four builds reproduced the same 49,771,592-byte ELF by `cmp`,
with SHA-256
`30c2dcb3323529be64ba35c4ca114b112936bc6b2caccf34a2479e3903dcb440`.

| Order | Workers | Wall (s) | CPU (s) | Peak combined RSS (KiB) | AArch64 emission (s) |
| ----: | ------: | -------: | ------: | ----------------------: | -------------------: |
|     1 |  Inline |  166.985 | 186.755 |               2,093,740 |               73.008 |
|     2 |       2 |  172.176 | 215.245 |               2,445,112 |               76.532 |
|     3 |       2 |  151.475 | 186.255 |               2,443,912 |               61.657 |
|     4 |  Inline |  176.634 | 195.558 |               2,093,520 |               85.516 |

CPU includes the compiler, broker and sidecar. RSS is the largest
contemporaneous sum of the three process measurements. The Linux VM
did not expose cycle counters. The worker runs spent 1.85–2.54 s
preparing the requests and waited 1.82–2.70 s at the first selected
function. Each subsequent result handoff took less than 11 ms.

The first pair lost 5.19 s and the second saved 25.16 s. Both worker
runs raised peak RSS by about 342–343 MiB. The fused pool stays
experimental. The rotation did not qualify the pool for an Object
suite run.

Raw logs are `register-home-frame-plan-sharing-profile.log`,
`register-home-frame-plan-verify-2-256.log`,
`register-home-frame-plan-verify-packed-2-256.log`,
`register-home-frame-plan-compiler-build-r1.log` and
`register-home-frame-plan-{control,pool2}-{a,b}/`.
