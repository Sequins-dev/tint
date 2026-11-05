import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import {
  compileArm64Program,
  type RuntimeSource,
} from "../src/native/index.ts";
function source(id: string, text: string) {
  const bytes = new TextEncoder().encode(text),
    decoded = createSourceText(bytes, bytes.length);
  assert.ok(decoded.ok);
  const parsed = parseModule(decoded.value);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return { id, module: parsed.value, dependencies: new Map<string, string>() };
}
function request(runtimes: readonly RuntimeSource[]) {
  return {
    modules: [
      source(
        "foundation/collections/one",
        "export function one():number{return 19;}",
      ),
      source(
        "foundation/collections/two",
        "export function two():number{return 23;}",
      ),
      source("main", "export function run():number{return 42;}"),
    ],
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes,
  };
}
test("runtime contract namespaces are independent from physical modules and retain helper output bytes", () => {
  const provider = "foundation/collections/sparse-list";
  const modules = [
    source(
      provider,
      readFileSync(
        new URL(
          "../../foundation/src/collections/sparse-list.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    source(
      "main",
      'export function run():boolean{const values=["a"];return values[0]==="a";}',
    ),
  ];
  const input = {
    modules,
    entry: "main",
    exports: ["run"],
    start: "run",
    runtimes: [{ module: provider, namespace: "sparse-list" }],
  };
  const result = compileArm64Program(input);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.native.code.length, 24608);
  assert.equal(
    createHash("sha256").update(result.value.native.code).digest("hex"),
    "f4d205607c80928de4990f0414f4784d748e58ff6e8dfe9155ad84542dc44804",
  );
  const wrong = compileArm64Program({
    ...input,
    runtimes: [{ module: provider, namespace: "foundation" }],
  });
  assert.equal(wrong.ok, false);
  if (!wrong.ok)
    assert.match(wrong.error.message, /missing runtime helper: sparse-list:/);
});
test("distinct versioned namespaces coexist within one framework", () => {
  const result = compileArm64Program(
    request([
      { module: "foundation/collections/one", namespace: "collections.one-v1" },
      { module: "foundation/collections/two", namespace: "collections.two.v2" },
    ]),
  );
  assert.ok(result.ok, JSON.stringify(result));
});
test("duplicate providers and namespaces fail registration before linking", () => {
  for (const runtimes of [
    [
      { module: "missing", namespace: "same" },
      { module: "missing", namespace: "other" },
    ],
    [
      { module: "missing-one", namespace: "same" },
      { module: "missing-two", namespace: "same" },
    ],
    [
      { module: "missing-two", namespace: "same" },
      { module: "missing-one", namespace: "same" },
    ],
  ]) {
    const result = compileArm64Program({ ...request(runtimes), modules: [] });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.stage, "link");
      assert.match(
        result.error.message,
        /duplicate runtime (module|namespace)/,
      );
    }
  }
});
test("invalid namespace IDs never infer labels from provider paths", () => {
  for (const namespace of [
    "",
    "with:separator",
    "with/slash",
    "with space",
    "with\ttab",
    "with\nnewline",
    "with\0nul",
    "../traversal",
    "café",
    "with\\backslash",
    "@scope",
  ]) {
    const result = compileArm64Program({
      ...request([{ module: "sparse-list", namespace }]),
      modules: [],
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.stage, "link");
      assert.match(result.error.message, /invalid runtime namespace/);
    }
  }
  for (const namespace of [
    "v1",
    "Runtime.v2-ABC",
    "0.numeric",
    "-private",
    ".version",
  ]) {
    const result = compileArm64Program(
      request([{ module: "foundation/collections/one", namespace }]),
    );
    assert.ok(result.ok, JSON.stringify(result));
  }
});
test("namespace identity does not authorize another provider module for host or record bindings", () => {
  for (const kind of ["host", "record"] as const) {
    const input = request([
      { module: "foundation/collections/one", namespace: "two" },
    ]);
    const result = compileArm64Program({
      ...input,
      ...(kind === "host"
        ? {
            hostBindings: [
              {
                module: "foundation/collections/two",
                name: "two",
                operation: "monotonic-time" as const,
              },
            ],
          }
        : {
            recordBindings: [
              {
                module: "foundation/collections/two",
                name: "two",
                operation: "test" as const,
              },
            ],
          }),
    });
    assert.equal(result.ok, false);
    if (!result.ok)
      assert.match(result.error.message, /require a declared runtime module/);
  }
});

test("legacy packageId is not accepted as a runtime namespace fallback", () => {
  const legacy = {
    module: "sparse-list",
    packageId: "sparse-list",
  } as unknown as RuntimeSource;
  const result = compileArm64Program({ ...request([legacy]), modules: [] });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.match(result.error.message, /invalid runtime namespace/);
});
