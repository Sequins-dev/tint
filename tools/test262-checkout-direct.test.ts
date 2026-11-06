import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { test262Checkout } from "./test262-checkout.ts";

function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "tint-test262-selection-"));
  try {
    for (const [path, source] of [
      ["root.js", "root\r\n"],
      ["language/class/z.js", "z\r\n"],
      ["language/class/a.js", "a\r\n"],
      ["language/class/helper_FIXTURE.js", "fixture"],
      ["language/class/notes.txt", "notes"],
      ["language/class/elements/field.js", "field"],
      ["language/class/dstr/parameter.js", "parameter"],
    ] as const) {
      const file = join(root, "test", path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
    execFileSync("git", ["-C", root, "init", "--quiet"]);
    execFileSync("git", ["-C", root, "add", "test"]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Tint Test",
      "-c",
      "user.email=tint@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("recursive Test262 directory selections retain nested populations and omit fixtures", () => {
  fixture((root) => {
    const selected = test262Checkout(root, "language/class");
    assert.deepEqual(
      selected.files.map((file) => file.path),
      [
        "language/class/a.js",
        "language/class/dstr/parameter.js",
        "language/class/elements/field.js",
        "language/class/z.js",
      ],
    );
    assert.equal(selected.dirty, false);
    assert.match(selected.revision, /^[a-f0-9]{40}$/);
  });
});

test("terminal *.js selections cover only direct files with stable order and unchanged bytes", () => {
  fixture((root) => {
    const selection = "language/class/*.js";
    const selected = test262Checkout(root, selection);
    assert.equal(selected.selection, selection);
    assert.deepEqual(
      selected.files.map((file) => file.path),
      ["language/class/a.js", "language/class/z.js"],
    );
    assert.equal(readFileSync(selected.files[0]!.filename, "utf8"), "a\r\n");
    assert.equal(selected.dirty, false);
    writeFileSync(join(root, "test/language/class/a.js"), "changed");
    assert.equal(test262Checkout(root, selection).dirty, true);
  });
});

test("root direct-file selections preserve the pinned checkout boundary and missing-directory errors", () => {
  fixture((root) => {
    assert.deepEqual(
      test262Checkout(root, "*.js").files.map((file) => file.path),
      ["root.js"],
    );
    assert.throws(() => test262Checkout(root, "../*.js"), /must remain within/);
    assert.throws(() => test262Checkout(root, "/*.js"), /must remain within/);
    assert.throws(() => test262Checkout(root, "missing/*.js"), {
      code: "ENOENT",
    });
    assert.deepEqual(
      test262Checkout(root, "language/class/a.js").files.map(
        (file) => file.path,
      ),
      ["language/class/a.js"],
    );
  });
});
