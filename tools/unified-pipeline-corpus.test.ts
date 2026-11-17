// Node reference for the unified-pipeline construct corpus: both forms of
// every construct return 42 under Node (or the declared Node result where an
// enforced annotation intentionally differs from type-erased execution), so a
// native result that differs is a Tint bug to investigate against the
// specification and the typing rule rather than a broken fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constructs } from "./unified-pipeline/corpus.ts";

test("construct names are unique and both forms export run", () => {
  const names = new Set<string>();
  for (const construct of constructs) {
    assert.ok(!names.has(construct.name), construct.name);
    names.add(construct.name);
    assert.match(construct.name, /^[a-z0-9-]+$/);
    for (const text of [construct.typed, construct.untyped])
      assert.match(text, /export function run\(\)/, construct.name);
  }
});

test("both forms of every construct give their expected result under Node", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-unified-corpus-"));
  try {
    const files: string[] = [],
      expected = new Map<string, number>();
    for (const construct of constructs) {
      // Each construct gets its own directory for its helper modules.
      const folder = join(directory, construct.name);
      mkdirSync(folder);
      for (const [file, text] of Object.entries(construct.helpers ?? {}))
        writeFileSync(join(folder, file), text);
      for (const form of ["typed", "untyped"] as const) {
        const file = construct.name + "/" + form + "-form.ts";
        writeFileSync(join(directory, file), construct[form]);
        files.push(file);
        expected.set(file, construct.node?.[form] ?? 42);
      }
    }
    writeFileSync(
      join(directory, "runner.mjs"),
      `const results = {};
for (const file of ${JSON.stringify(files)}) {
  try { results[file] = (await import("./" + file)).run(); }
  catch (error) { results[file] = String(error); }
}
console.log(JSON.stringify(results));
`,
    );
    // Parameter properties and enums need TypeScript's transform, not only
    // type stripping.
    const result = spawnSync(
      process.execPath,
      ["--experimental-transform-types", "--no-warnings", "runner.mjs"],
      { cwd: directory, encoding: "utf8", env: { ...process.env, TZ: "UTC" } },
    );
    assert.equal(result.status, 0, result.stderr);
    const results = JSON.parse(result.stdout) as Record<string, unknown>;
    for (const file of files)
      assert.equal(results[file], expected.get(file), file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
