import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";

async function graphTool() {
  const module = await import("./test262-module-graph.ts");
  return module.discoverModuleGraph;
}
function fixture(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "tint-module-graph-"));
  for (const [name, source] of Object.entries(files))
    writeFileSync(join(directory, name), source);
  return {
    directory,
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}
function hash(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

test("discovery retains invalid UTF8 bytes and their original resource hash", async () => {
  const discover = await graphTool(),
    root = 'import data from "./image.png" with {type:"bytes"};';
  const f = fixture({ "root.js": root });
  const bytes = new Uint8Array([137, 80, 255]);
  try {
    writeFileSync(join(f.directory, "image.png"), bytes);
    const graph = discover(join(f.directory, "root.js"), root, "module");
    assert.deepEqual(graph.nodes[0]?.bytes, bytes);
    assert.equal(
      graph.nodes[0]?.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
  } finally {
    f.close();
  }
});

test("module discovery terminates cycles and retains sorted unique siblings", async () => {
  const discover = await graphTool(),
    root = 'import "./b.js";';
  const f = fixture({
    "a.js": root,
    "b.js": 'export * from "./a.js";',
    "unused.js": "",
  });
  try {
    const graph = discover(join(f.directory, "a.js"), root, "module");
    assert.equal(graph.root, "a.js");
    assert.deepEqual(
      graph.nodes.map((n) => n.name),
      ["a.js", "b.js"],
    );
    assert.deepEqual(graph.siblings, ["a.js", "b.js", "unused.js"]);
  } finally {
    f.close();
  }
});
test("self-import preserves the root file's byte hash", async () => {
  const discover = await graphTool(),
    source = 'import "./self.js";';
  const f = fixture({ "self.js": source });
  try {
    const graph = discover(join(f.directory, "self.js"), source, "module");
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0]?.sha256, hash(source));
    assert.equal(graph.nodes[0]?.source, source);
  } finally {
    f.close();
  }
});
test("discovery includes comment paths but does not invent missing fixtures", async () => {
  const discover = await graphTool(),
    source = '// path assembled at runtime: "./b.js"\nimport("./missing.js");';
  const f = fixture({ "a.js": source, "b.js": "export const x=1" });
  try {
    const graph = discover(join(f.directory, "a.js"), source, "script");
    assert.deepEqual(
      graph.nodes.map((n) => n.name),
      ["b.js"],
    );
    assert.ok(!graph.siblings.includes("missing.js"));
  } finally {
    f.close();
  }
});
test("discovery ignores non-sibling paths and special host specifiers", async () => {
  const discover = await graphTool(),
    source =
      'import "./../outside.js";import "./sub/file.js";import "<module source>";';
  const f = fixture({ "a.js": source });
  try {
    assert.deepEqual(
      discover(join(f.directory, "a.js"), source, "module").nodes,
      [],
    );
  } finally {
    f.close();
  }
});
test("JSON fixtures are edgeless even when their strings name other siblings", async () => {
  const discover = await graphTool(),
    source = 'import data from "./data.json" with {type:"json"};';
  const f = fixture({
    "a.js": source,
    "data.json": '{"path":"./b.js"}',
    "b.js": "export {}",
  });
  try {
    const graph = discover(join(f.directory, "a.js"), source, "module");
    assert.deepEqual(
      graph.nodes.map((n) => [n.name, n.kind]),
      [["data.json", "json"]],
    );
  } finally {
    f.close();
  }
});
test("unparsed fixtures retain their source and contribute literal edges without a syntax verdict", async () => {
  const discover = await graphTool(),
    source = 'import "./bad.js";';
  const f = fixture({
    "a.js": source,
    "bad.js": 'const = ; // "./b.js"',
    "b.js": "export {}",
  });
  try {
    const graph = discover(join(f.directory, "a.js"), source, "module");
    assert.deepEqual(
      graph.nodes.map((n) => n.name),
      ["b.js", "bad.js"],
    );
    assert.equal(graph.nodes.find((n) => n.name === "bad.js")?.parsed, false);
  } finally {
    f.close();
  }
});
test("static requests use decoded specifiers and fixture changes update their own hashes", async () => {
  const discover = await graphTool(),
    source = 'import "\\u002e/b.js";';
  const f = fixture({ "a.js": source, "b.js": "export const x=1;" });
  try {
    const before = discover(join(f.directory, "a.js"), source, "module");
    assert.deepEqual(
      before.nodes.map((n) => n.name),
      ["b.js"],
    );
    writeFileSync(join(f.directory, "b.js"), "export const x=2;");
    const after = discover(join(f.directory, "a.js"), source, "module");
    assert.notEqual(before.nodes[0]?.sha256, after.nodes[0]?.sha256);
    assert.deepEqual(before.siblings, after.siblings);
    assert.deepEqual(
      discover(join(f.directory, "a.js"), source, "script").nodes,
      [],
    );
  } finally {
    f.close();
  }
});

test("pinned module fixtures include resolution errors, computed imports and sibling tests", async () => {
  const discover = await graphTool();
  const cases: [string, "script" | "module", string[]][] = [
    [
      "language/module-code/instn-resolve-order-src.js",
      "module",
      [
        "instn-resolve-order-src-reference_FIXTURE.js",
        "instn-resolve-order-src-syntax_FIXTURE.js",
        "instn-resolve-order-src-valid_FIXTURE.js",
      ],
    ],
    [
      "language/expressions/dynamic-import/assignment-expression/additive-expr.js",
      "script",
      ["module-code-other_FIXTURE.js", "module-code_FIXTURE.js"],
    ],
    [
      "language/module-code/ambiguous-export-bindings/namespace-unambiguous-if-export-star-as-from-and-import-star-as-and-export.js",
      "module",
      ["namespace-unambiguous-if-import-star-as-and-export.js"],
    ],
  ];
  for (const [path, goal, expected] of cases) {
    const filename = join(".tint-bootstrap/test262/test", path),
      graph = discover(filename, readFileSync(filename, "utf8"), goal);
    for (const name of expected)
      assert.ok(
        graph.nodes.some((node) => node.name === name),
        name,
      );
    assert.equal(graph.root, basename(filename));
  }
});

test("discovery records only absent single-segment sibling literals", async () => {
  const discover = await graphTool(),
    source =
      'import("./gone.js");import("./gone.js");import("./exists.js");import("./sub/no.js");import("../outside.js");';
  const f = fixture({
    "root.js": source,
    "exists.js": '// "./nested-missing.js"\nexport const x=1;',
  });
  try {
    const graph = discover(join(f.directory, "root.js"), source, "script");
    assert.deepEqual(graph.absent, ["gone.js", "nested-missing.js"]);
    assert.deepEqual(
      graph.nodes.map((n) => n.name),
      ["exists.js"],
    );
  } finally {
    f.close();
  }
});
test("Script self-import is retained as a module fixture with original bytes", async () => {
  const discover = await graphTool(),
    source = 'import("./root.js");';
  const f = fixture({ "root.js": source });
  try {
    const graph = discover(join(f.directory, "root.js"), source, "script");
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0]?.sha256, hash(source));
    assert.deepEqual(graph.absent, []);
  } finally {
    f.close();
  }
});
