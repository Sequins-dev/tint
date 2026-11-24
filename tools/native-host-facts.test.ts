// Host facts the runtime queries at run time instead of assuming them: the
// kernel page size (memory-release granule), the CPUs available to the
// process (collector worker count) and the SHA-256 instructions (the
// compiler's hashing intrinsic). Each native value is checked against the
// host's own report (cgroup v1 and hybrid hierarchies, which the
// development VM lacks, from fixture files), and SHA-256 digests against
// Node's crypto on both the instruction path and the portable path (forced
// by leaving cpu-sha256 unbound). On Linux, the processor count follows the
// affinity mask (taskset), and the generational collector keeps data intact
// with one (serial) or two collector threads.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import { nativeFixtureTarget } from "./native-host-target.ts";
import { cgroupProcessorLimitFrom } from "../packages/native-runtime/src/processors.ts";
import { stableScratchDirectory } from "./fixture-scratch.ts";

const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  rounds = "packages/foundation/src/binary/sha256-rounds.ts",
  digest = "packages/foundation/src/binary/sha256.ts";
const factBindings = [
  {
    module: memory,
    name: "memoryPageBytes",
    operation: "memory-page-bytes",
  },
  { module: memory, name: "processorCount", operation: "processor-count" },
  { module: memory, name: "openRuntimeFile", operation: "open-read" },
  { module: memory, name: "readRuntimeFile", operation: "read" },
  { module: memory, name: "closeRuntimeFile", operation: "close" },
] as const;
const processorsModule = "packages/native-runtime/src/processors.ts";

/** CPUs the process may run on: its affinity mask on Linux (nproc), the
 * online CPUs on macOS. */
function hostProcessors(): number {
  if (platform() !== "linux") return availableParallelism();
  const result = spawnSync("nproc", [], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout.trim());
}
/** The cgroup v2 CPU limit, read by the runtime's own parser through Node. */
function hostCgroupLimit(): number {
  return cgroupProcessorLimitFrom((path, buffer) => {
    const name = new TextDecoder().decode(path.subarray(0, path.indexOf(0)));
    let contents: Buffer;
    try {
      contents = readFileSync(name);
    } catch {
      return -2;
    }
    const count = Math.min(contents.length, buffer.length);
    buffer.set(contents.subarray(0, count));
    return count;
  });
}
function hostPageBytes(): number {
  const result = spawnSync("getconf", ["PAGESIZE"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const page = Number(result.stdout.trim());
  assert.ok(Number.isInteger(page) && page >= 4096, result.stdout);
  return page;
}
/** Whether this CPU implements the SHA-256 instructions, per the OS. */
function hostSha256(): boolean {
  if (nativeFixtureTarget().arch === "x86_64") return false;
  if (platform() === "darwin") return true;
  const features = /^Features\s*:(.*)$/m.exec(
    readFileSync("/proc/cpuinfo", "utf8"),
  );
  assert.ok(features !== null, "no Features line in /proc/cpuinfo");
  return features[1]!.split(/\s+/).includes("sha2");
}

// Padding boundaries: empty, one block minus the length field (55), the
// first two-block length (56), whole blocks and long inputs.
const lengths = [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 4099];
function input(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 151 + length * 7) & 255;
  return bytes;
}
function digestFixture(instructions: number): string {
  const cases = lengths.map((length) => {
    const bytes = input(length);
    return {
      length,
      digest: [...createHash("sha256").update(bytes).digest()],
    };
  });
  return `import {sha256} from "digest";
import {sha256InstructionsAvailable} from "rounds";
function input(length:number):Uint8Array{const bytes=new Uint8Array(length);for(let i=0;i<length;i++)bytes[i]=(i*151+length*7)&255;return bytes;}
function check(length:number,expected:readonly number[]):boolean{
 const actual=sha256(input(length));
 if(actual.length!==32)return false;
 for(let i=0;i<32;i++)if(actual[i]!==expected[i])return false;
 return true;
}
export function run():number{
 if(sha256InstructionsAvailable()!==${instructions})return 2;
${cases.map((item, index) => ` if(!check(${item.length},[${item.digest.join(",")}]))return ${10 + index};`).join("\n")}
 return 42;
}
`;
}
function verifyDigests(name: string, forcePortable: boolean): void {
  verifyHostedFixture(
    digestFixture(forcePortable ? 0 : hostSha256() ? 1 : 0),
    name,
    [
      ["digest", digest],
      ["rounds", rounds],
    ],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      ...(forcePortable ? { omittedHostOperations: ["cpu-sha256"] } : {}),
    },
  );
}

// Typed churn (the trusted memory module rules out general fallback):
// survivors and old-to-young edges through minor and major collections.
const churn = `function fill(id: number, length: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < length; i++) values.push(id * 31 + i);
  return values;
}
function churn(): number {
  const window: number[][] = [];
  let total = 0;
  for (let round = 0; round < 30000; round++) {
    // Garbage: dies young, or after promotion once the window drops it.
    for (let i = 0; i < 20; i++) {
      const junk = fill(i + round, 16);
      total = (total + (junk[i % 16] ?? 0)) % 1000003;
    }
    const values = fill(round, 8 + (round % 9));
    if (window.length < 3000) window.push(values);
    else window[round % 3000] = values;
    // An old-to-young edge: a promoted array grows with a young value.
    const old = window[(round * 7) % window.length];
    if (old !== undefined && old.length < 64) old.push(round);
  }
  for (let i = 0; i < window.length; i++) {
    const values = window[i];
    if (values === undefined) continue;
    for (let j = 0; j < values.length; j++)
      total = (total * 3 + (values[j] ?? 5)) % 1000003;
  }
  return total;
}
`;
/** The same program in Node gives the expected checksum. */
async function churnChecksum(): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "tint-host-facts-"));
  try {
    const file = join(directory, "churn.ts");
    writeFileSync(file, churn + "export { churn };\n");
    const module = (await import(pathToFileURL(file).href)) as {
      churn(): number;
    };
    return module.churn();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
const expectedChurn = await churnChecksum();

function factsFixture(page: number, processors: number): string {
  return `import {memoryPageBytes,processorCount} from "memory";
import {cgroupProcessorLimit} from "processors";
${churn}
export function run():number{
 const page=memoryPageBytes(),processors=processorCount();
 if(page!==${page})return 2;
 if((page&(page-1))!==0)return 3;
 if(processors!==${processors})return 4;
 if(cgroupProcessorLimit()!==${hostCgroupLimit()})return 6;
 if(churn()!==${expectedChurn})return 5;
 return 42;
}
`;
}
function buildFacts(name: string, processors: number): string {
  return verifyHostedFixture(
    factsFixture(hostPageBytes(), processors),
    name,
    [
      ["memory", memory],
      ["processors", processorsModule],
    ],
    [],
    [],
    [{ module: memory, namespace: "native-memory" }],
    {
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 33554432,
      allocationCapacity: 262144,
      rootCapacity: 65536,
      hostBindings: factBindings,
    },
  );
}

test("page size, processor count and CPU limit match the host's report", () => {
  const processors = hostProcessors(),
    limit = hostCgroupLimit();
  // libuv (Node) bounds its parallelism by the same two facts.
  assert.equal(
    limit > 0 && limit < processors ? limit : processors,
    availableParallelism(),
  );
  buildFacts("host-facts", processors);
});

// cgroup hierarchies the development VM lacks (it runs cgroup v2 only), as
// files below a root that the native reader prepends: each case's limit.
const cgroupCases: readonly {
  readonly files: Readonly<Record<string, string>>;
  readonly limit: number;
}[] = [
  {
    // cgroup v1, 2.5 CPUs at the leaf, unlimited ancestors; a mountinfo
    // longer than one page (proc files return a page per read).
    files: {
      "/proc/self/cgroup":
        "12:memory:/a/b\n4:cpu,cpuacct:/a/b\n1:name=systemd:/a/b\n",
      "/proc/self/mountinfo":
        "22 1 259:1 / / rw shared:1 - ext4 /dev/root rw\n".repeat(120) +
        "31 25 0:28 / /sys/fs/cgroup/cpu,cpuacct rw shared:10 - cgroup cgroup rw,cpu,cpuacct\n",
      "/sys/fs/cgroup/cpu,cpuacct/a/b/cpu.cfs_quota_us": "250000\n",
      "/sys/fs/cgroup/cpu,cpuacct/a/b/cpu.cfs_period_us": "100000\n",
      "/sys/fs/cgroup/cpu,cpuacct/a/cpu.cfs_quota_us": "-1\n",
      "/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us": "-1\n",
    },
    limit: 3,
  },
  {
    // A container's own cgroup as the mounted root, mount point escaped.
    files: {
      "/proc/self/cgroup": "5:cpu:/docker/abc\n",
      "/proc/self/mountinfo":
        "40 30 0:30 /docker/abc /sys/fs/cgroup/cpu\\040x rw - cgroup cgroup rw,cpu\n",
      "/sys/fs/cgroup/cpu x/cpu.cfs_quota_us": "400000\n",
      "/sys/fs/cgroup/cpu x/cpu.cfs_period_us": "100000\n",
    },
    limit: 4,
  },
  {
    // Hybrid: the tighter of v2 cpu.max and the v1 quota.
    files: {
      "/proc/self/cgroup": "4:cpu:/\n0::/x\n",
      "/proc/self/mountinfo":
        "31 25 0:28 / /sys/fs/cgroup/cpu rw - cgroup cgroup rw,cpu\n",
      "/sys/fs/cgroup/x/cpu.max": "600000 100000\n",
      "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "200000\n",
      "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000\n",
    },
    limit: 2,
  },
];

test("cgroup v1, v2 and hybrid limits parse natively from fixture files", () => {
  const directory = stableScratchDirectory("cgroups");
  try {
    const roots = cgroupCases.map((item, index) => {
      const root = join(directory, String(index));
      for (const [path, contents] of Object.entries(item.files)) {
        mkdirSync(dirname(root + path), { recursive: true });
        writeFileSync(root + path, contents);
      }
      return root;
    });
    const fixture = `import {openRuntimeFile,readRuntimeFile,closeRuntimeFile} from "memory";
import {cgroupProcessorLimitFrom} from "processors";
let root="";
function readBelowRoot(path:Uint8Array,buffer:Uint8Array):number{
 let length=0;while((path[length]??0)!==0)length++;
 const full=new Uint8Array(root.length+length+1);
 for(let i=0;i<root.length;i++)full[i]=root.charCodeAt(i);
 for(let i=0;i<length;i++)full[root.length+i]=path[i]??0;
 const fd=openRuntimeFile(full);if(fd<0)return -1;
 let total=0;const chunk=new Uint8Array(4096);
 while(total<buffer.length){const count=readRuntimeFile(fd,chunk);if(count<=0)break;for(let i=0;i<count&&total<buffer.length;i++)buffer[total++]=chunk[i]??0;}
 closeRuntimeFile(fd);return total;
}
export function run():number{
${roots.map((root, index) => ` root=${JSON.stringify(root)};if(cgroupProcessorLimitFrom(readBelowRoot)!==${cgroupCases[index]!.limit})return ${10 + index};`).join("\n")}
 return 42;
}
`;
    for (const [index, root] of roots.entries())
      assert.equal(
        cgroupProcessorLimitFrom((path, buffer) => {
          const name = new TextDecoder().decode(
            path.subarray(0, path.indexOf(0)),
          );
          let contents: Buffer;
          try {
            contents = readFileSync(root + name);
          } catch {
            return -2;
          }
          const count = Math.min(contents.length, buffer.length);
          buffer.set(contents.subarray(0, count));
          return count;
        }),
        cgroupCases[index]!.limit,
      );
    verifyHostedFixture(
      fixture,
      "cgroup-files",
      [
        ["memory", memory],
        ["processors", processorsModule],
      ],
      [],
      [],
      [{ module: memory, namespace: "native-memory" }],
      {
        managedBytes: 4194304,
        allocationCapacity: 65536,
        hostBindings: factBindings,
      },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SHA-256 digests match Node on the instruction path", () => {
  verifyDigests("sha256-instructions", false);
});

test("SHA-256 digests match Node on the forced portable path", () => {
  verifyDigests("sha256-portable", true);
});

test(
  "the processor count follows the affinity mask",
  {
    skip:
      platform() !== "linux"
        ? "affinity masks are Linux-only"
        : spawnSync("taskset", ["--version"]).status !== 0
          ? "taskset is not installed"
          : false,
  },
  () => {
    for (const cpus of ["0", "0,1"]) {
      const count = cpus.split(",").length,
        previous = process.env.TINT_BUILD_ONLY;
      process.env.TINT_BUILD_ONLY = "1";
      let path: string;
      try {
        path = buildFacts("host-facts-affinity-" + String(count), count);
      } finally {
        if (previous === undefined) delete process.env.TINT_BUILD_ONLY;
        else process.env.TINT_BUILD_ONLY = previous;
      }
      try {
        const result = spawnSync(
          "taskset",
          [
            "-c",
            cpus,
            "lldb",
            "--no-lldbinit",
            "--batch",
            "-o",
            "process launch --stop-at-entry",
            "-o",
            "script assert lldb.process.GetState() == lldb.eStateStopped",
            "-o",
            "continue",
            "-o",
            "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
            path,
          ],
          { encoding: "utf8", timeout: 120000 },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /exited with status = 42 /, result.stdout);
      } finally {
        rmSync(dirname(path), { recursive: true, force: true });
      }
    }
  },
);
