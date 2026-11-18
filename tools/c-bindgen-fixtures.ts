// The binding generator's native fixture (docs/native-ffi.md, "Binding
// generator"): libc calls through a binding generated fresh from this
// host's headers, compiled by Tint and run under LLDB.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { darwinSystemLibrary } from "@tint/abi/c";
import { emitBinding } from "./c-bindgen/emit.ts";
import { extractFacts, hostTarget } from "./c-bindgen/extract.ts";
import type { BindingSpec } from "./c-bindgen/spec.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";

/** Records with nested records, fixed arrays and aliases (`struct stat`,
 * `struct utsname`), a variadic call shape (`open` with a mode), errno
 * results and constants. `struct stat` has different members on the two
 * targets, so the fixture binds the host's alone. */
export const sampleSpec: BindingSpec = {
  library: "bindgen-sample",
  summary: ["libc calls bound fresh from this host's headers."],
  targets: ["darwin-arm64", "linux-arm64"],
  headers: ["sys/stat.h", "sys/utsname.h", "fcntl.h", "unistd.h", "errno.h"],
  aliases: ["mode_t", "off_t"],
  constants: ["O_WRONLY", "O_CREAT", "O_TRUNC", "S_IFMT", "S_IFREG", "ENOENT"],
  records: ["stat", "utsname"],
  functions: [
    {
      name: "open",
      variant: "create",
      variadic: ["mode_t"],
      result: "OrErrno",
    },
    { name: "write", result: "OrErrno" },
    { name: "fstat", result: "OrErrno" },
    { name: "close", result: "OrErrno" },
    { name: "unlink", result: "OrErrno" },
    { name: "uname", result: "OrErrno" },
    "getpid",
  ],
};

/** The fixture's binding for this host, generated now. */
export async function sampleBinding(): Promise<string> {
  const target = hostTarget();
  if (target === undefined) throw new Error("no native target on this host");
  const facts = extractFacts(sampleSpec, target);
  const emission = await emitBinding(sampleSpec, new Map([[target, facts]]), {
    specPath: "tools/c-bindgen-fixtures.ts",
    targets: [target],
  });
  if (emission.report.length !== 0)
    throw new Error(
      "the sample binding left out: " + emission.report.join("; "),
    );
  return emission.text;
}

export function sampleFixtureSource(path: string, machine: string): string {
  const codes = [...machine].map((character) => character.charCodeAt(0));
  return `import {
  stat,
  utsname,
  open$create,
  write,
  fstat,
  close,
  unlink,
  uname,
  getpid,
  O_WRONLY,
  O_CREAT,
  O_TRUNC,
  S_IFMT,
  S_IFREG,
  ENOENT,
} from "sample";
const machine: number[] = ${JSON.stringify(codes)};
export function run(): number {
  // uname fills a record of fixed char arrays; read one through a view.
  const names = new Uint8Array(utsname.size);
  if (uname(names) !== 0) return 1;
  const system = utsname.view(names);
  for (let i = 0; i < machine.length; i++)
    if (system.machine[i] !== machine[i]) return 2;
  if (system.machine[machine.length] !== 0) return 3;
  // A variadic open, a write and fstat's nested record.
  const path = ${JSON.stringify(path)};
  const fd = open$create(path, O_WRONLY | O_CREAT | O_TRUNC, 420);
  if (fd < 0) return 4;
  const data = new Uint8Array(1234);
  for (let i = 0; i < data.length; i++) data[i] = i & 255;
  if (write(fd, data, data.length) !== 1234) return 5;
  const bytes = new Uint8Array(stat.size);
  if (fstat(fd, bytes) !== 0) return 6;
  const info = stat.view(bytes);
  if (info.st_size !== 1234) return 7;
  if ((info.st_mode & S_IFMT) !== S_IFREG) return 8;
  if ((info.st_mode & 511) !== 420) return 9;
  if (close(fd) !== 0) return 10;
  if (close(fd) !== -9) return 11;
  if (unlink(path) !== 0) return 12;
  if (unlink(path) !== -ENOENT) return 13;
  if (getpid() <= 0) return 14;
  return 42;
}
`;
}

/** Builds the fixture against a fresh binding and runs it under LLDB. */
export async function verifySampleFixture(): Promise<string> {
  const text = await sampleBinding();
  const machine = process.platform === "darwin" ? "arm64" : "aarch64";
  const path = join(tmpdir(), `tint-bindgen-sample-${process.pid}`);
  const declaration = {
    id: "fixture/bindgen-sample.d.ts",
    text,
    manifest: [
      {
        module: "tint:c/bindgen-sample",
        darwin: {
          name: darwinSystemLibrary,
          optional: false,
          currentVersion: 0x10000,
          compatibilityVersion: 0x10000,
        },
        linux: {
          name: "libc.so.6",
          optional: false,
          currentVersion: 0,
          compatibilityVersion: 0,
        },
      },
    ],
  };
  return verifyHostedFixture(
    sampleFixtureSource(path, machine),
    "bindgen-sample",
    [["sample", declaration.id]],
    [],
    [],
    [],
    {
      managedBytes: 4194304,
      allocationCapacity: 65536,
      foreignDeclarations: [declaration],
    },
  );
}
