/**
 * Runs an image built by the ELF writer on Linux AArch64. Elsewhere it skips.
 * From macOS, with the worktree mounted at the same path in the `tint-linux`
 * container (after `pnpm build` on the host):
 *
 *   container exec tint-linux sh -c 'cd <worktree> && \
 *     node --test packages/image/test/elf-linux.test.ts'
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildElfExecutable } from "@tint/image/linux/elf";
import { ABSENT_SYMBOL, helloRequest } from "./support/elf-hello.ts";

const linux = process.platform === "linux" && process.arch === "arm64";
const skip = linux
  ? false
  : `ELF execution needs Linux arm64 (host is ${process.platform} ${process.arch})`;

function tool(...candidates: string[]): string | undefined {
  for (const candidate of candidates)
    if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0)
      return candidate;
  return undefined;
}

test(
  "a glibc-linked ELF image runs, binds imports and unwinds",
  { skip },
  async (t) => {
    const result = buildElfExecutable(helloRequest());
    assert.ok(result.ok);
    const directory = mkdtempSync(join(tmpdir(), "tint-elf-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const program = join(directory, "hello");
    writeFileSync(program, result.value.bytes);
    chmodSync(program, 0o755);

    await t.test("exits 42 after writing through libc", () => {
      const run = spawnSync(program, [], { encoding: "utf8" });
      assert.equal(run.signal, null);
      assert.equal(run.stdout, "hello\n");
      // 1 would mean glibc backtrace() failed to unwind main via .eh_frame_hdr.
      assert.equal(run.status, 42);
    });

    await t.test(
      "readelf accepts the headers, dynamic table and symbols",
      (t) => {
        const readelf = tool("readelf");
        if (readelf === undefined) return t.skip("readelf is unavailable");
        const out = spawnSync(readelf, ["-lSdrsW", program], {
          encoding: "utf8",
        });
        assert.equal(out.status, 0, out.stderr);
        assert.equal(out.stderr, "");
        for (const expected of [
          "DYN (Position-Independent Executable file)",
          "[Requesting program interpreter: /lib/ld-linux-aarch64.so.1]",
          "Shared library: [libc.so.6]",
          "Flags: NOW PIE",
          "BIND_NOW",
          "R_AARCH64_GLOB_DAT",
          "GNU_EH_FRAME",
          "GNU_RELRO",
        ])
          assert.ok(out.stdout.includes(expected), expected);
        assert.match(
          out.stdout,
          new RegExp(`WEAK +DEFAULT +UND ${ABSENT_SYMBOL}`),
        );
        assert.match(out.stdout, /FUNC +LOCAL +DEFAULT +\d+ main/);
      },
    );

    await t.test("llvm-dwarfdump verifies the debug information", (t) => {
      const dwarfdump = tool("llvm-dwarfdump", "llvm-dwarfdump-19");
      if (dwarfdump === undefined)
        return t.skip("llvm-dwarfdump is unavailable");
      const out = spawnSync(dwarfdump, ["--verify", program], {
        encoding: "utf8",
      });
      assert.equal(out.status, 0, out.stdout + out.stderr);
      assert.ok(out.stdout.includes("No errors."));
    });

    await t.test("gdb breaks on main and unwinds out of libc into it", (t) => {
      const gdb = tool("gdb");
      if (gdb === undefined) return t.skip("gdb is unavailable");
      const out = spawnSync(
        gdb,
        [
          "-batch",
          "-nx",
          "-ex",
          "set backtrace past-main on",
          "-ex",
          "b main",
          "-ex",
          "run",
          "-ex",
          "bt",
          "-ex",
          "b write",
          "-ex",
          "continue",
          "-ex",
          "bt",
          "-ex",
          "kill",
          program,
        ],
        { encoding: "utf8" },
      );
      assert.equal(out.status, 0, out.stderr);
      assert.match(out.stdout, /Breakpoint 1, main \(\) at hello\.ts:\d+/);
      // From write (libc) through main's .eh_frame FDE into glibc's startup.
      assert.match(
        out.stdout,
        /#0 .*(?:in )?(?:__GI___libc_)?write \([^]*#1 .* in main \(\) at hello\.ts[^]*__libc_start_main[^]*_start \(\)/,
      );
    });
  },
);
