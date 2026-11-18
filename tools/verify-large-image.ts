import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const memory = "packages/native-runtime/src/intrinsics/memory.ts";
const source = `import {collectGarbage} from "memory";
interface Box { readonly payload: number[]; }
export function retainAcrossCollection(input: number): number {
  const payload: number[] = [input, input + 1];
  const box: Box = { payload };
  collectGarbage();
  return box.payload[1] ?? -1;
}
export function run(): number {
  return retainAcrossCollection(41);
}
`;

const symbol = "retainAcrossCollection";

export function verifyLargeImage(fullSize: boolean): void {
  const previous = {
    build: process.env.TINT_BUILD_ONLY,
    debug: process.env.TINT_DEBUG_SYMBOLS,
    large: process.env.TINT_FORCE_LARGE_IMAGE,
    tmpdir: process.env.TINT_FIXTURE_TMPDIR,
  };
  const scratch = mkdtempSync(join(tmpdir(), "tint-large-image-"));
  process.env.TINT_FIXTURE_TMPDIR = scratch;
  process.env.TINT_BUILD_ONLY = "1";
  process.env.TINT_DEBUG_SYMBOLS = "1";
  if (!fullSize) process.env.TINT_FORCE_LARGE_IMAGE = "1";
  else delete process.env.TINT_FORCE_LARGE_IMAGE;
  try {
    const image = verifyHostedFixture(
      source,
      "large-image",
      [["memory", memory]],
      [],
      [],
      [{ module: memory, namespace: "native-memory" }],
      {
        managedBytes: 4194304,
        allocationCapacity: 65536,
        runtimeEntry: "initializeCopyingRuntime",
        hostBindings: [
          {
            module: memory,
            name: "collectGarbage",
            operation: "collect-garbage",
          },
        ],
        forceFarReach: true,
        optimization: "none",
        stackTraces: true,
        programPaddingBytes: fullSize ? 0x100010000 : 0x20000,
      },
    );
    const size = statSync(image).size;
    assert.ok(!fullSize || size > 0x100000000, `only ${size} image bytes`);
    const manifest = JSON.parse(readFileSync(image + ".manifest.json", "utf8"));
    console.log(
      JSON.stringify({
        size,
        imageSha256: manifest.imageSha256,
        sourceSnapshot: manifest.sourceSnapshot,
      }),
    );
    if (process.platform === "darwin") {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = spawnSync(
          "lldb",
          [
            "--no-lldbinit",
            "--batch",
            "-o",
            "settings set target.disable-aslr false",
            "-o",
            `breakpoint set -r '${symbol}'`,
            "-o",
            "process launch --stop-at-entry",
            "-o",
            "script assert lldb.process.GetState() == lldb.eStateStopped",
            "-o",
            "continue",
            "-o",
            "bt",
            "-o",
            "continue",
            "-o",
            "script assert lldb.process.GetState() == lldb.eStateExited and lldb.process.GetExitStatus() == 42",
            image,
          ],
          { encoding: "utf8", timeout: 60000 },
        );
        const output = result.stdout + result.stderr;
        console.log(output);
        if (attempt === 0 && output.includes("could not pause execution"))
          continue;
        assert.equal(result.error, undefined);
        assert.equal(result.status, 0, output);
        assert.match(output, /frame #0: .*retainAcrossCollection/);
        assert.match(output, /frame #1: .*__tint_invoke/);
        assert.match(output, /frame #2: .*tint:process-entry/);
        assert.match(output, /exited with status = 42/);
        break;
      }
    } else {
      const result = spawnSync(
        "gdb",
        [
          "--nx",
          "--batch",
          "-ex",
          "set disable-randomization off",
          "-ex",
          "starti",
          "-ex",
          "python assert gdb.selected_thread().is_stopped()",
          "-ex",
          `rbreak ${symbol}`,
          "-ex",
          "continue",
          "-ex",
          "bt",
          "-ex",
          "continue",
          "-ex",
          "python assert int(gdb.parse_and_eval('$_exitcode')) == 42",
          image,
        ],
        { encoding: "utf8", timeout: 60000 },
      );
      const output = result.stdout + result.stderr;
      console.log(output);
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, output);
      assert.match(output, /#0 .*retainAcrossCollection/);
      assert.match(output, /#\d+ .*__tint_invoke/);
      assert.match(output, /#\d+ .*tint:process-entry/);
    }
  } finally {
    rmSync(scratch, { recursive: true });
    for (const [name, value] of [
      ["TINT_BUILD_ONLY", previous.build],
      ["TINT_DEBUG_SYMBOLS", previous.debug],
      ["TINT_FORCE_LARGE_IMAGE", previous.large],
      ["TINT_FIXTURE_TMPDIR", previous.tmpdir],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

if (import.meta.main) verifyLargeImage(process.argv.includes("--full-size"));
