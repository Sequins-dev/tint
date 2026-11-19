import test from "node:test";
import { verifyHostedFixture } from "./hosted-fixture.ts";

const x64 = process.env.TINT_NATIVE_TARGET === "linux-x86_64";

test(
  "SysV static bindings call a glibc scalar with integer and SSE arguments",
  {
    skip: x64 ? false : "requires the linux-x86_64 fixture target",
  },
  () => {
    process.env.TINT_GENERAL_FALLBACK = "0";
    verifyHostedFixture(
      `import { difftime } from "tint:c/sysv-libc";
    export function run(): number { return difftime(84, 42); }`,
      "sysv-libc",
      [["tint:c/sysv-libc", "sysv-libc.d.ts"]],
      [],
      [],
      [],
      {
        managedBytes: 4194304,
        allocationCapacity: 65536,
        foreignDeclarations: [
          {
            id: "sysv-libc.d.ts",
            text: `declare module "tint:c/sysv-libc" {
          import type { f64, i64 } from "tint:ffi";
          export function difftime(end: i64, start: i64): f64;
        }`,
            manifest: [
              {
                module: "tint:c/sysv-libc",
                linux: {
                  name: "libc.so.6",
                  optional: false,
                  currentVersion: 0,
                  compatibilityVersion: 0,
                },
              },
            ],
          },
        ],
      },
    );
  },
);

test("SysV foreignFunction invokes a dynamic scalar binding", {
  skip: x64 ? false : "requires the linux-x86_64 fixture target",
}, () => {
  process.env.TINT_GENERAL_FALLBACK = "0";
  verifyHostedFixture(
    `import { openProgram, findSymbol, foreignFunction, setNumber, invoke, resultNumber } from "tint:ffi/unsafe";
    export function run(): number {
      const handle = openProgram();
      const fn = foreignFunction(findSymbol(handle, "difftime"), {
        parameters: [{ kind: "scalar", scalar: "i64" }, { kind: "scalar", scalar: "i64" }],
        result: { kind: "scalar", scalar: "f64" }, fixedParameters: 2, callClass: "leaf", errno: "none",
      });
      setNumber(fn, 0, 84); setNumber(fn, 1, 42); invoke(fn);
      return resultNumber(fn);
    }`,
    "sysv-dynamic",
    [["tint:ffi/unsafe", "packages/native-runtime/src/ffi/unsafe.ts"]],
  );
});
