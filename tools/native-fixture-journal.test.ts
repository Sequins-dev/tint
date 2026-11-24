// The native batch journal (tools/gate/native-fixture.ts): build records name
// the general fallback a fixture program took, and the gate summary counts
// those fallbacks and the images large enough to link the general runtime
// surface or the in-image compiler.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildNativeFixture } from "./gate/native-fixture.ts";

test("build records carry a fixture's general fallback reason", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-native-journal-"));
  try {
    const journal = join(directory, "native-images.jsonl"),
      image = join(directory, "image");
    writeFileSync(image, "not an image");
    const env = {
      TINT_GATE_NATIVE_IMAGES: journal,
      TINT_GATE_MEMORY_DIRECTORY: join(directory, "memory"),
      TINT_GATE_MEMORY_SLOTS: "1",
    };
    assert.equal(
      buildNativeFixture("typed", () => image, env),
      image,
    );
    assert.equal(
      buildNativeFixture(
        "general",
        () => ({ path: image, generalFallback: "check: invalid read" }),
        env,
      ),
      image,
    );
    const builds = readFileSync(journal, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((event) => event.phase === "build");
    assert.deepEqual(
      builds.map((event) => [event.fixture, event.general]),
      [
        ["typed", undefined],
        ["general", "check: invalid read"],
      ],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the gate summary counts general fallbacks and large images", () => {
  const directory = mkdtempSync(join(tmpdir(), "tint-native-journal-"));
  try {
    const journal = join(directory, "native-images.jsonl");
    const build = (fixture: string, bytes: number, general?: string) =>
      JSON.stringify({
        phase: "build",
        fixture,
        path: join(directory, fixture),
        bytes,
        ...(general === undefined ? {} : { general }),
      });
    writeFileSync(
      journal,
      [
        build("small", 700000),
        build("fallback", 24000000, "check: invalid read"),
        build("compiler", 80000000),
        JSON.stringify({ phase: "build", fixture: "failed", failed: true }),
      ].join("\n") + "\n",
    );
    const result = spawnSync(
      process.execPath,
      [new URL("./gate/native-fixture.ts", import.meta.url).pathname, journal],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trimEnd().split("\n");
    assert.match(
      lines[0] ?? "",
      /^native-images built=3 admitted=0 launch-attempted=0 general-fallbacks=1 large-images=2 journal=/,
    );
    assert.deepEqual(lines.slice(1), [
      "native-images general fallback: fallback: check: invalid read",
      "native-images large image: fallback: 24000000 bytes",
      "native-images large image: compiler: 80000000 bytes",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
