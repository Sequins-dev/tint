# Linux 6.12 arm64 live-code and USDT verification

The test guest was Debian 13.7 arm64 on `6.12.117+deb13-cloud-arm64`,
with 4 KiB pages, six vCPUs, `CONFIG_UPROBE_EVENTS=y` and tracefs available.
It ran headless in the HVF VM under `~/.t3/vms/start-arm64.sh`. The
`dev` container machine was used for the Linux self-build gate and a
separate static USDT check with perf 6.1.192. All native fixture
executions in the policy matrix and live tracing used the Debian 13
guest.

The guest used Node v24.12.0, pnpm 10.34.8, perf 6.12.117,
bpftrace 0.23.2, GDB 16.3, LLDB 19.1.7, binutils 2.44 and strace 6.13.
The checkout was transferred with `git archive HEAD | ssh -i
~/.t3/vms/tint-vm-key -p 2222 tint@127.0.0.1 'mkdir -p
~/tint-real-kernel && tar -xf - -C ~/tint-real-kernel'`. The verifier
updates were copied to that checkout after the failing observations.
The guest packages came from Debian via `sudo apt-get install -y
linux-perf bpftrace gdb lldb binutils python3 curl xz-utils strace`.
Node came from the official v24.12.0 Linux arm64 archive.

## Executable-memory policy

The guest started with `vm.memfd_noexec=0`. Each test set the real
kernel sysctl using `sudo sysctl -w "vm.memfd_noexec=$policy"`, for
`policy` in `0 1 2`. The original value was restored via the shell's
exit trap. An independent libc call with flags `0x11`
(`MFD_CLOEXEC | MFD_EXEC`) returned fd 3 at 0 and 1 and `EACCES` at 2.

The isolated thread fixture was built with
`TINT_BUILD_ONLY=1 TINT_FIXTURE_TMPDIR="$HOME/tint-kernel-early" node
tools/build-isolated-thread-fixture.ts`. It passed under LLDB and strace
at each policy. LLDB asserted stopped at entry, then exited with inferior
status 42. Strace also returned 42 for each policy.

```sh
lldb --no-lldbinit --batch -o 'settings set target.disable-aslr false' \
  -o 'process launch --stop-at-entry' \
  -o 'script assert lldb.process.GetState() == lldb.eStateStopped' \
  -o continue \
  -o 'script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42' \
  "$image"
strace -f -e trace=memfd_create,mmap,mprotect -o "threads-$policy.strace" "$image"
```

| `vm.memfd_noexec` | `MFD_EXEC` accepted | `EACCES` | File-backed writable and executable views | Anonymous executable views | RW → RX publications |
| ----------------- | ------------------- | -------- | ----------------------------------------- | -------------------------- | -------------------- |
| 0                 | 8                   | 0        | 8 pairs                                   | 0                          | 0                    |
| 1                 | 8                   | 0        | 8 pairs                                   | 0                          | 0                    |
| 2                 | 0                   | 8        | 0 pairs                                   | 8                          | 8                    |

Each fallback publication flipped its own 16 KiB view to
`PROT_READ|PROT_WRITE`, then restored `PROT_READ|PROT_EXEC` on the
same address. The kernel log showed the expected refusals at policy 2
and no `memfd_create() called without MFD_EXEC` warning. The fixture
manifest recorded source snapshot SHA-256
`bce2423fd229130fed9cb666bb0c049324fcc6485122596570d5c21d84d6adfb`
and image SHA-256
`f07a9f2715fe1413524b0e49af3024eca551bc9542c8003881b528c7d791c50e`.

### Native fixture matrix

Each fixture returned 42 under LLDB at every policy. The JIT debugger
fixture also returned 42 under GDB and resolved both pending breakpoints
with a JIT-to-native backtrace, source line `jit-source.ts:3`, and a perf
map entry for `jit:jitSum`. Its second publication into the page holding
the first breakpoint succeeded under both debuggers.

| Test                                 | Policy 0        | Policy 1        | Policy 2        |
| ------------------------------------ | --------------- | --------------- | --------------- |
| `verify-native-code`                 | Dual, exit 42   | Dual, exit 42   | Single, exit 42 |
| `verify-hosted-function-addresses`   | 42              | 42              | 42              |
| `verify-hosted-managed-runtime-link` | 42              | 42              | 42              |
| `verify-native-permanent-literals`   | 42              | 42              | 42              |
| `build-isolated-thread-fixture`      | 42              | 42              | 42              |
| `verify-hosted-jit-debug`            | LLDB and GDB 42 | LLDB and GDB 42 | LLDB and GDB 42 |

The guest built the dual-map fixture with its default AOT settings:

```sh
TINT_BUILD_ONLY=1 TINT_EXPECT_JIT_MAPPING=dual \
  node tools/verify-native-code.ts "$out/native-dual"
```

For policy 2, the development container built the unchanged fixture
with full AOT optimization, then copied the image and manifest to the guest:

```sh
TINT_BUILD_ONLY=1 TINT_EXPECT_JIT_MAPPING=single \
  node tools/verify-native-code.ts "$out/stock-native-single"
```

The image SHA-256 was
`534c66dde78482cb9853e9bb67f595898d7325d19f02ba74fed902ab65b46e79`
on both hosts. The initial guest build was still in loop invariant code
motion at the last debugger sample and was stopped with the first VM
shutdown after 19 minutes. The stock development-container build
supersedes the earlier limited-optimization diagnostic image.

The dual image asserted two writable and two executable file mappings
with no anonymous executable views. The single image asserted two
anonymous RX views with zero file-backed JIT views. Both asserted zero
RWX mappings and passed the fixture's publication and invalid-window
checks. Strace confirmed two successful `memfd_create` calls at policies
0 and 1 and two `EACCES` results at policy 2.

The three hosted fixtures for function addresses, managed linking and
permanent literals were built on the `dev` machine with
`TINT_BUILD_ONLY=1 node tools/<fixture>.ts`, then copied with their
build manifests to the guest using scp. The LLDB command above ran each
image once at each policy. The initial function-addresses attempt used
the wrong filename and stopped before launch. The corrected invocation
used the path printed by the fixture builder.

The guest built the stock JIT debugger fixture with
`TINT_BUILD_ONLY=1 node tools/verify-hosted-jit-debug.ts "$out/jit-debug"`.
For each policy the script's LLDB, GDB and perf-map assertions were
replayed on the same image by extracting its debugger block (from
`const session = spawnSync` to the end), supplying the same imports,
image path, output path and Linux target. The unmodified, fully
optimized image passed at all three policies. Its SHA-256 was
`7a2ea0f8d0324d0352be782251a4012f7696a91ea2dcbe73dfc8fa88f015f2d1`.

## Live USDT

On the guest, after installing the pinned Node and workspace dependencies:

```sh
export PATH="$HOME/tint-node/bin:$PATH" TZ=UTC
cd "$HOME/tint-real-kernel"
pnpm install --frozen-lockfile
pnpm build
sudo mountpoint -q /sys/kernel/tracing || sudo mount -t tracefs nodev /sys/kernel/tracing
mkdir -p "$HOME/tint-usdt-evidence"
TINT_BUILD_ONLY=1 TINT_FIXTURE_TMPDIR="$HOME/tint-usdt-evidence" \
  node --input-type=module -e 'import {buildSignpostFixture} from "./tools/verify-hosted-signposts.ts"; buildSignpostFixture("usdt-live")' \
  > "$HOME/tint-usdt-evidence/image.path"
node tools/linux/verify-usdt-live.ts "$HOME/tint-usdt-evidence/run-4" \
  --image "$(tail -1 "$HOME/tint-usdt-evidence/image.path")"
```

The guest built the fixture from `git archive eb1d822db89f747d0ad9a76d8400352704e8732c`.
The fixture manifest recorded 769 workspace sources, snapshot SHA-256
`bce2423fd229130fed9cb666bb0c049324fcc6485122596570d5c21d84d6adfb`
and image SHA-256
`13603ee9c8e325a9bf7b99411f1c01a21724be520b252d1068395de450b8a010`.
The ELF build ID was `af89b1e54e064022e5076237cde0f30a072fb03b`.

The full verifier exited 0 on both guest boots. Static checks agreed on 21 probes. GDB, perf
and bpftrace hit 17 names with identical counts, including 48 balanced
worker intervals across six threads for each tracer. The other four
declared probes had zero hits. GDB reported fixture exit 42. Perf returned
42 from the workload and captured 939 samples. bpftrace returned 0.

| Probe or pair of interval edges                       | Hits per probe, all three tools |
| ----------------------------------------------------- | ------------------------------- |
| `alloc_slow`, `gc_collect`, `gc__end`                 | 91                              |
| `gc_minor`                                            | 87                              |
| `gc_major`, `gc_parallel_forward`, `gc_parallel_mark` | 4                               |
| `gc_roots`                                            | 95                              |
| `gc_worker`                                           | 48                              |
| `gc_parallel_minor`, `gc_remembered`                  | 0                               |

All 91 ordered `gc__end` tuples (major, nursery bytes, copied bytes, old
bytes) matched GDB in the verifier. Comparing the raw perf and bpftrace
captures against a separate GDB run of the same image yielded SHA-256
`845c1bb86725377e8b46856e9c7b02c58fd549ae5cf75efdf423f2b23870a951`
for the JSON-encoded array of tuples.

Earlier attempts exposed three failures. The first started before the
package install completed and could not find `readelf`. With the tools
installed, perf listed the 21 events without the image and build-ID
suffix that the old parser required. After the listing fix, perf captured
939 samples but the verifier rejected the recording command's exit 42.
The final run accepted both listing forms using a private build-ID cache
and accepted the expected workload exit before checking the trace.

## Shutdown

The guest's `vm.memfd_noexec` was restored to 0 and tracefs contained
zero remaining uprobes. Both guest boots ended via `~/.t3/vms/stop.sh`.
On each shutdown the arm64 serial console logged filesystem sync and
`reboot: Power down`, and the QEMU process exited. The first invocation
also powered down the configured x86 guest. The second invocation
returned 255 from its final SSH attempt to the already powered-down
x86 guest.
