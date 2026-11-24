// Hosted fixture builds in one process share the workspace parse and the
// compiled runtime units (BuildRequest.runtimeUnits), and the processes of one
// native batch share runtime units through a cache directory. Sharing must
// not change an image: each fixture built with the cache is byte-identical to
// the same fixture built from scratch (TINT_FIXTURE_CACHE=0). Units are
// shared only between builds that agree on the runtime's options; a
// different runtime entry compiles its own. Nothing is executed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nativeFixtureTarget } from "./native-host-target.ts";

process.env.TINT_GENERAL_FALLBACK = "0";
process.env.TINT_BUILD_ONLY = "defer-admission";
const { fixtureCacheStatistics, sharedFixtureImage, verifyHostedFixture } =
  await import("./hosted-fixture.ts");

const sum = `function total(values: number[]): number {
  let result = 0;
  for (let i = 0; i < values.length; i++) result += values[i] ?? 0;
  return result;
}
export function run(): number { return total([20, 22]); }
`;
const product = `function scale(value: number, factor: number): number {
  return value * factor;
}
export function run(): number { return scale(21, 2); }
`;

function imageSha256(path: string): string {
  return JSON.parse(readFileSync(path + ".manifest.json", "utf8")).imageSha256;
}

/** Builds each fixture and returns its image hash and the runtime unit
 * compiles and reuses the builds caused. */
function build(
  cache: boolean,
  fixtures: readonly (readonly [
    string,
    string,
    "initializeRuntime" | "initializeGenerationalRuntime",
  ])[],
) {
  const directory = mkdtempSync(join(tmpdir(), "tint-fixture-cache-"));
  const saved = {
    cache: process.env.TINT_FIXTURE_CACHE,
    tmpdir: process.env.TINT_FIXTURE_TMPDIR,
  };
  process.env.TINT_FIXTURE_CACHE = cache ? "1" : "0";
  process.env.TINT_FIXTURE_TMPDIR = directory;
  const before = { ...fixtureCacheStatistics };
  try {
    const images = fixtures.map(([source, name, runtimeEntry]) =>
      imageSha256(
        verifyHostedFixture(source, name, [], [], [], [], {
          runtimeEntry,
          managedBytes: 16777216,
          allocationCapacity: 262144,
        }),
      ),
    );
    return {
      images,
      compiled: fixtureCacheStatistics.compiled - before.compiled,
      shared: fixtureCacheStatistics.shared - before.shared,
    };
  } finally {
    for (const [key, value] of [
      ["TINT_FIXTURE_CACHE", saved.cache],
      ["TINT_FIXTURE_TMPDIR", saved.tmpdir],
    ] as const)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    rmSync(directory, { recursive: true, force: true });
  }
}

const runtimeUnitCacheSkip =
  nativeFixtureTarget().arch === "x86_64" &&
  "linux-x86_64 compiles runtime units inline without shared runtimeUnits caching";

test(
  "shared runtime units leave every image byte-identical",
  { skip: runtimeUnitCacheSkip },
  () => {
    const fixtures = [
      [sum, "cache-sum", "initializeGenerationalRuntime"],
      [product, "cache-product", "initializeGenerationalRuntime"],
      [product, "cache-product-region", "initializeRuntime"],
    ] as const;
    const fresh = build(false, fixtures);
    assert.deepEqual(
      { compiled: fresh.compiled, shared: fresh.shared },
      { compiled: 0, shared: 0 },
    );
    const cached = build(true, fixtures);
    assert.deepEqual(cached.images, fresh.images);
    // The two generational builds share one compile; the region runtime is a
    // different runtime entry. Earlier builds in this process may already hold
    // either, so count the total rather than the compiles.
    assert.equal(cached.compiled + cached.shared, 3);
    assert.ok(cached.shared >= 1, JSON.stringify(cached));
    assert.notEqual(fresh.images[1], fresh.images[2]);
  },
);

test(
  "another process restores the cached runtime units byte for byte",
  { skip: runtimeUnitCacheSkip },
  () => {
    const [fresh] = build(false, [
      [sum, "cache-restore", "initializeRuntime"],
    ]).images;
    const cache = mkdtempSync(join(tmpdir(), "tint-fixture-cache-dir-"));
    try {
      // Each child builds the fixture once; the second finds the first's entry.
      const child = () => {
        const result = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `const { fixtureCacheStatistics, verifyHostedFixture } = await import(${JSON.stringify(
              new URL("./hosted-fixture.ts", import.meta.url).href,
            )});
const { readFileSync } = await import("node:fs");
const path = verifyHostedFixture(process.argv[1], "cache-restore", [], [], [], [], {
  runtimeEntry: "initializeRuntime", managedBytes: 16777216, allocationCapacity: 262144,
});
const { imageSha256 } = JSON.parse(readFileSync(path + ".manifest.json", "utf8"));
console.log(JSON.stringify({ imageSha256, ...fixtureCacheStatistics }));`,
            sum,
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              TINT_FIXTURE_CACHE: "1",
              TINT_FIXTURE_CACHE_DIRECTORY: cache,
              TINT_FIXTURE_TMPDIR: cache,
            },
          },
        );
        assert.equal(result.status, 0, result.stderr);
        return JSON.parse(result.stdout.trimEnd().split("\n").pop() ?? "");
      };
      const first = child(),
        second = child();
      assert.deepEqual(
        [first.compiled, first.restored, second.compiled, second.restored],
        [1, 0, 0, 1],
      );
      assert.equal(first.imageSha256, fresh);
      assert.equal(second.imageSha256, fresh);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  },
);

test("a fixed fixture is built once and every caller gets its own copy", () => {
  const cache = mkdtempSync(join(tmpdir(), "tint-fixture-image-cache-"));
  const saved = process.env.TINT_FIXTURE_CACHE_DIRECTORY;
  process.env.TINT_FIXTURE_CACHE_DIRECTORY = cache;
  try {
    let builds = 0;
    const image = () =>
      sharedFixtureImage("cache-shared", [sum], () => {
        builds++;
        return verifyHostedFixture(sum, "cache-shared", [], [], [], [], {
          managedBytes: 16777216,
          allocationCapacity: 262144,
        });
      });
    const first = image(),
      second = image();
    assert.equal(builds, 1);
    assert.notEqual(first, second);
    assert.equal(imageSha256(first), imageSha256(second));
    assert.deepEqual(readFileSync(first), readFileSync(second));
    // A caller may delete its copy; the next caller still gets one.
    rmSync(first, { force: true });
    assert.equal(imageSha256(image()), imageSha256(second));
    assert.equal(builds, 1);
    assert.equal(
      JSON.parse(readFileSync(second + ".manifest.json", "utf8")).fixture,
      second + ".source.ts",
    );
  } finally {
    if (saved === undefined) delete process.env.TINT_FIXTURE_CACHE_DIRECTORY;
    else process.env.TINT_FIXTURE_CACHE_DIRECTORY = saved;
    rmSync(cache, { recursive: true, force: true });
  }
});
