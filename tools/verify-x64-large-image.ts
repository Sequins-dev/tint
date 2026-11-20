import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, ftruncateSync, openSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { appendHostedEntry } from "@tint/codegen/x86_64/startup";
import { compileX64HostedProgram } from "@tint/compiler/native";
import { buildElfExecutable } from "@tint/image/linux/elf";
import { linuxX86_64Target as target } from "@tint/platform/target";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";

const source = `
function answer(value: number, layout: string): number {
  if (layout !== "large") return 1;
  return value + 22.5;
}
export function run(): number { return answer(19.5, "large"); }
`;

/** Place the managed code more than 2 GiB below startup, its GOT and data.
 * Write the empty portion as a hole so transport need only carry its extent. */
export function writeLargeX64Image(path: string): void {
  const parsed = parseModule(createSourceTextView(source));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const compiled = compileX64HostedProgram(
    {
      modules: [
        { id: "large-x64", module: parsed.value, dependencies: new Map() },
      ],
      entry: "large-x64",
      start: "run",
      exports: ["run"],
      runtimes: [],
      hostBindings: [],
      optimization: "none",
    },
    target.hostABI,
    { forceFarReach: true },
  );
  assert.ok(compiled.ok, JSON.stringify(compiled));
  const invocation = compiled.native.functions[compiled.invocation]?.offset;
  const startMain = target.hostABI.processStart?.startMainSymbol;
  assert.ok(invocation !== undefined && startMain !== undefined);
  const image = appendHostedEntry({
    native: compiled.native,
    host: target.hostABI,
    invocation,
    returnType: "number",
    stackBytes: 1048576,
    managedBytes: 4096,
    pageBytes: target.memoryPageBytes,
    programPaddingBytes: 0x80010000,
  });
  const built = buildElfExecutable({
    ...image,
    code: new Uint8Array(0),
    linux: {
      arch: target.arch,
      interpreter: target.interpreter,
      libcVersion: { symbol: startMain, version: target.glibcStartVersion },
      identifier: "tint-x64-large-image",
    },
  });
  if (!built.ok) throw Error(built.error);
  const bytes = built.value.bytes;
  assert.ok(bytes.length > 0x80000000);
  const fd = openSync(path, "wx", 0o755);
  const hash = createHash("sha256");
  try {
    ftruncateSync(fd, bytes.length);
    const zero = Buffer.alloc(1 << 20);
    for (let offset = 0; offset < bytes.length; offset += zero.length) {
      const chunk = bytes.subarray(offset, offset + zero.length);
      hash.update(chunk);
      if (Buffer.compare(chunk, zero.subarray(0, chunk.length)) === 0) continue;
      assert.equal(writeSync(fd, chunk, 0, chunk.length, offset), chunk.length);
    }
  } finally {
    closeSync(fd);
  }
  const sha256 = hash.digest("hex");
  console.log(
    JSON.stringify({
      path,
      bytes: bytes.length,
      sha256,
      entry: image.entryOffset,
    }),
  );
}

if (import.meta.main) {
  const path = process.argv[2];
  assert.ok(path, "usage: node tools/verify-x64-large-image.ts OUTPUT");
  writeLargeX64Image(resolve(path));
}
