import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  nativeArtifact,
  runNativeBatch,
  type NativeRunnerName,
} from "./native-target-runner.ts";

function rawElf(code: readonly number[]): Buffer {
  // ELF64 header and one executable PT_LOAD, followed by x86-64 instructions.
  const image = Buffer.alloc(120 + code.length);
  image.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  image.writeUInt16LE(2, 16);
  image.writeUInt16LE(62, 18);
  image.writeUInt32LE(1, 20);
  image.writeBigUInt64LE(0x400078n, 24);
  image.writeBigUInt64LE(64n, 32);
  image.writeUInt16LE(64, 52);
  image.writeUInt16LE(56, 54);
  image.writeUInt16LE(1, 56);
  image.writeUInt32LE(1, 64);
  image.writeUInt32LE(5, 68);
  image.writeBigUInt64LE(0x400000n, 80);
  image.writeBigUInt64LE(0x400000n, 88);
  image.writeBigUInt64LE(BigInt(image.length), 96);
  image.writeBigUInt64LE(BigInt(image.length), 104);
  image.writeBigUInt64LE(4096n, 112);
  image.set(code, 120);
  return image;
}

function probes(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "tint x64 probes-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const probe = (name: string, code: number[]) => {
    const path = join(directory, name);
    writeFileSync(path, rawElf(code), { mode: 0o755 });
    return nativeArtifact("linux-x86_64", path);
  };
  return {
    exit42: probe("exit 42", [0xb8, 60, 0, 0, 0, 0xbf, 42, 0, 0, 0, 0x0f, 5]),
    trap: probe("ud2", [0x0f, 0x0b]),
    exit132: probe(
      "exit 132",
      [0xb8, 60, 0, 0, 0, 0xbf, 132, 0, 0, 0, 0x0f, 5],
    ),
    spin: probe("spin", [0xeb, 0xfe]),
    // write(1, argv[1], 5), then exit(0).
    printArgument: probe(
      "print argument",
      [
        0x48, 0x8b, 0x74, 0x24, 0x10, 0xba, 5, 0, 0, 0, 0xbf, 1, 0, 0, 0, 0xb8,
        1, 0, 0, 0, 0x0f, 5, 0xb8, 60, 0, 0, 0, 0x31, 0xff, 0x0f, 5,
      ],
    ),
  };
}

test("an x86-64 image requires an explicit runner", (t) => {
  const { exit42 } = probes(t);
  const [result] = runNativeBatch([{ artifact: exit42 }], {});
  assert.equal(result?.kind, "execution-unavailable");
  assert.match(JSON.stringify(result), /linux-x86_64.*TINT_NATIVE_RUNNER/);
});

test("runner target and artifact bytes are checked before launch", (t) => {
  const { exit42 } = probes(t);
  assert.throws(
    () => nativeArtifact("linux-aarch64", exit42.path),
    /linux-aarch64/,
  );
  const [wrongRunner] = runNativeBatch([{ artifact: exit42 }], {
    TINT_NATIVE_RUNNER: "linux-dev",
  });
  assert.equal(wrongRunner?.kind, "execution-unavailable");
  writeFileSync(exit42.path, rawElf([0x0f, 0x0b]));
  assert.throws(
    () =>
      runNativeBatch([{ artifact: exit42 }], { TINT_NATIVE_RUNNER: "x64-ssh" }),
    /artifact.*changed/,
  );
});

test("unreachable SSH transport reports execution unavailable", (t) => {
  const { exit42 } = probes(t);
  const [result] = runNativeBatch([{ artifact: exit42 }], {
    ...process.env,
    TINT_NATIVE_RUNNER: "x64-ssh",
    TINT_X64_SSH_PORT: "0",
  });
  assert.equal(result?.kind, "execution-unavailable");
  assert.match(JSON.stringify(result), /x64-ssh/);
});

for (const runner of ["x64-qemu-dev", "x64-ssh"] satisfies NativeRunnerName[]) {
  test(
    `${runner} executes a batch of x86-64 probes`,
    {
      skip: process.env.TINT_X64_RUNNER_TEST !== runner,
    },
    (t) => {
      const { exit42, trap, exit132, spin, printArgument } = probes(t);
      const glibc = nativeArtifact(
        "linux-x86_64",
        join(homedir(), ".t3/tint-x64-sysroot/usr/bin/true"),
      );
      const results = runNativeBatch(
        [exit42, trap, exit132, spin, glibc, exit42, printArgument].map(
          (artifact) => ({
            artifact,
            timeoutMs: artifact === spin ? 500 : 5000,
            args: ["x ' y"],
          }),
        ),
        { ...process.env, TINT_NATIVE_RUNNER: runner },
      );
      assert.deepEqual(
        results.map((result) =>
          result.kind === "exited"
            ? result.status
            : result.kind === "signaled"
              ? result.signal
              : result.kind,
        ),
        [42, "SIGILL", 132, "timed-out", 0, 42, 0],
        JSON.stringify(results, null, 2),
      );
      assert.equal(results[6]?.stdout, "x ' y");
      assert.equal(results[0]?.artifact.imageSha256, exit42.imageSha256);
      assert.equal(results[0]?.executor?.runner, runner);
      assert.match(results[0]?.executor?.identity ?? "", /Linux/);
      if (runner === "x64-qemu-dev")
        assert.match(
          results[0]?.executor?.sysrootSha256 ?? "",
          /^[a-f0-9]{64}$/,
        );
      console.log(JSON.stringify(results));
    },
  );
}
