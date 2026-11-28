import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBoundaries, type PackageContract } from "./boundaries.ts";
const a: PackageContract = {
  name: "@tint/a",
  directory: "packages/a",
  dependencies: {},
  references: [],
  sources: [{ path: "packages/a/src/index.ts", text: "export const a = 1;" }],
};
const b: PackageContract = {
  name: "@tint/b",
  directory: "packages/b",
  dependencies: { "@tint/a": "workspace:*" },
  references: ["../a"],
  sources: [
    { path: "packages/b/src/index.ts", text: 'export { a } from "@tint/a";' },
  ],
};
const policy = { "@tint/a": [], "@tint/b": ["@tint/a"] };
test("accepts the documented DAG with public entrypoint imports", () => {
  assert.deepEqual(checkBoundaries([a, b], policy), []);
});
test("only same-package registered built-in sources can import each other by Node specifier", () => {
  const buffer = {
    path: "packages/native-runtime/src/node/buffer.ts",
    text: "export const Buffer = {};",
  };
  const decoder = "packages/native-runtime/src/node/string-decoder.ts";
  function check(source: string, specifier: string): string[] {
    const runtime: PackageContract = {
      ...a,
      name: "@tint/native-runtime",
      directory: "packages/native-runtime",
      sources: [
        buffer,
        { path: source, text: `export * from "${specifier}";` },
      ],
      exports: {
        "./buffer": {
          types: "./dist/node/buffer.d.ts",
          import: "./dist/node/buffer.js",
        },
      },
    };
    return checkBoundaries([runtime], { "@tint/native-runtime": [] });
  }
  assert.deepEqual(check(decoder, "node:buffer"), []);
  assert.equal(check(decoder, "node:fs").length, 1);
  assert.equal(check(decoder, "buffer").length, 1);
  assert.equal(
    check("packages/native-runtime/src/helper.ts", "node:buffer").length,
    1,
  );
});
test("rejects undeclared, deep, escaping, host and computed imports", () => {
  for (const source of [
    'import x from "@tint/a/src/internal.ts";',
    'import x from "../../a/src/index.ts";',
    'export * from "node:fs";',
    'import type { X } from "external";',
    'const x = import("@tint/a");',
    'const x = require("@tint/a");',
    'type X = import("node:fs").PathLike;',
    '/// <reference types="node" />\nexport {};',
    "const x = 1 as number;",
    "let x: any;",
    "declare const process: unknown;",
  ]) {
    const changed = {
      ...b,
      sources: [{ path: "packages/b/src/index.ts", text: source }],
    };
    assert.ok(checkBoundaries([a, changed], policy).length > 0, source);
  }
  assert.ok(
    checkBoundaries([a, { ...b, dependencies: {} }], policy).length > 0,
  );
});
test("rejects unapproved dependencies, missing project references and dependency cycles", () => {
  assert.ok(
    checkBoundaries([a, b], { "@tint/a": [], "@tint/b": [] }).length > 0,
  );
  assert.ok(checkBoundaries([a, { ...b, references: [] }], policy).length > 0);
  const cyclic = {
    ...a,
    dependencies: { "@tint/b": "workspace:*" },
    references: ["../b"],
  };
  assert.ok(
    checkBoundaries([cyclic, b], {
      "@tint/a": ["@tint/b"],
      "@tint/b": ["@tint/a"],
    }).some((e) => e.includes("cycle")),
  );
  assert.ok(
    checkBoundaries([a, b], { ...policy, "@tint/missing": [] }).length > 0,
  );
});
test("permits internal relative .ts imports, rejects missing and extensionless ones", () => {
  const index = "packages/a/src/index.ts";
  const helper = {
    path: "packages/a/src/helper.ts",
    text: "export const x = 1;",
  };
  assert.deepEqual(
    checkBoundaries(
      [
        {
          ...a,
          sources: [
            { path: index, text: 'export { x } from "./helper.ts";' },
            helper,
          ],
        },
      ],
      { "@tint/a": [] },
    ),
    [],
  );
  for (const spec of ["./helper", "./absent.ts"])
    assert.ok(
      checkBoundaries(
        [
          {
            ...a,
            sources: [
              { path: index, text: `export * from "${spec}";` },
              helper,
            ],
          },
        ],
        { "@tint/a": [] },
      ).length > 0,
    );
});

test("explicit framework subpath grants remain scoped to declared bare owner dependencies", () => {
  const framework = {
    ...a,
    exports: {
      "./binary": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    },
  };
  const consumer = {
    ...b,
    sources: [
      {
        path: "packages/b/src/index.ts",
        text: 'export { a } from "@tint/a/binary";',
      },
    ],
  };
  assert.deepEqual(checkBoundaries([framework, consumer], policy), []);
  for (const specifier of [
    "@tint/a",
    "@tint/a/internal",
    "@tint/a/src/index.ts",
    "@tint/a/binary/private",
  ]) {
    assert.ok(
      checkBoundaries(
        [
          framework,
          {
            ...consumer,
            sources: [
              {
                path: "packages/b/src/index.ts",
                text: `export * from "${specifier}";`,
              },
            ],
          },
        ],
        policy,
      ).length > 0,
      specifier,
    );
  }
  assert.ok(
    checkBoundaries(
      [framework, { ...consumer, dependencies: {}, references: [] }],
      { "@tint/a": [], "@tint/b": [] },
    ).some((error) => error.includes("declared public")),
  );
});
test("C binding declaration modules are the trusted contract for their ambient declarations", () => {
  const binding = (path: string, text: string): PackageContract => ({
    ...a,
    sources: [
      {
        path: "packages/a/src/index.ts",
        text: 'import { f } from "tint:c/libsystem";\nexport const a = f();',
      },
      { path, text },
    ],
  });
  const declaration =
    'declare module "tint:c/libsystem" {\n  import type { i32 } from "tint:ffi";\n  export function f(): i32;\n}\n';
  assert.deepEqual(
    checkBoundaries([binding("packages/a/src/c/libsystem.d.ts", declaration)], {
      "@tint/a": [],
    }),
    [],
  );
  // A package declaring bindings may also import tint:ffi; others may not.
  const withFfi = binding("packages/a/src/c/libsystem.d.ts", declaration);
  assert.deepEqual(
    checkBoundaries(
      [
        {
          ...withFfi,
          sources: [
            ...withFfi.sources,
            {
              path: "packages/a/src/view.ts",
              text: 'import { type View } from "tint:ffi";\nexport type V = View<number>;',
            },
          ],
        },
      ],
      { "@tint/a": [] },
    ),
    [],
  );
  assert.ok(
    checkBoundaries(
      [
        {
          ...a,
          sources: [
            {
              path: "packages/a/src/view.ts",
              text: 'import { allocate } from "tint:ffi";\nexport const b = allocate(1);',
            },
          ],
        },
      ],
      { "@tint/a": [] },
    ).some((error) =>
      error.includes("declared public package entrypoint: tint:ffi"),
    ),
  );
  // tint:ffi/unsafe is importable only from listed modules of a package
  // declaring bindings; listed modules that stop importing it are stale.
  const unsafeUser = {
    ...withFfi,
    sources: [
      ...withFfi.sources,
      {
        path: "packages/a/src/peek.ts",
        text: 'import { bytesAt } from "tint:ffi/unsafe";\nexport const b = bytesAt(8, 1);',
      },
    ],
  };
  assert.deepEqual(
    checkBoundaries([unsafeUser], { "@tint/a": [] }, [
      "packages/a/src/peek.ts",
    ]),
    [],
  );
  assert.ok(
    checkBoundaries([unsafeUser], { "@tint/a": [] }).some((error) =>
      error.includes("listed in unsafeForeignMemoryModules"),
    ),
  );
  assert.ok(
    checkBoundaries([withFfi], { "@tint/a": [] }, [
      "packages/a/src/peek.ts",
    ]).some((error) => error.includes("does not import tint:ffi/unsafe")),
  );
  assert.ok(
    checkBoundaries(
      [
        {
          ...a,
          sources: [
            {
              path: "packages/a/src/peek.ts",
              text: 'import { bytesAt } from "tint:ffi/unsafe";',
            },
          ],
        },
      ],
      { "@tint/a": [] },
      ["packages/a/src/peek.ts"],
    ).some((error) =>
      error.includes("declared public package entrypoint: tint:ffi/unsafe"),
    ),
  );
  // Outside src/c, as a second statement, importing anything else, or from
  // a package that does not declare the binding, the rules still apply.
  assert.ok(
    checkBoundaries([binding("packages/a/src/libsystem.d.ts", declaration)], {
      "@tint/a": [],
    }).some((error) => error.includes("ambient declarations")),
  );
  assert.ok(
    checkBoundaries(
      [
        binding(
          "packages/a/src/c/libsystem.d.ts",
          declaration + "declare const x: number;\n",
        ),
      ],
      { "@tint/a": [] },
    ).some((error) => error.includes("ambient declarations")),
  );
  assert.ok(
    checkBoundaries(
      [
        binding(
          "packages/a/src/c/libsystem.d.ts",
          declaration.replace('"tint:ffi"', '"@tint/b"'),
        ),
      ],
      { "@tint/a": [] },
    ).some((error) => error.includes("import only tint:ffi")),
  );
  assert.ok(
    checkBoundaries(
      [
        a,
        {
          ...b,
          sources: [
            {
              path: "packages/b/src/index.ts",
              text: 'import { f } from "tint:c/libsystem";',
            },
          ],
        },
      ],
      policy,
    ).some((error) =>
      error.includes("declared public package entrypoint: tint:c/libsystem"),
    ),
  );
});
