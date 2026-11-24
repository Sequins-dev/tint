// Hosted fixture builds in one process share the workspace parse and the
// compiled runtime units (BuildRequest.runtimeUnits). Sharing must not change
// an image: each fixture built with the cache is byte-identical to the same
// fixture built from scratch (TINT_FIXTURE_CACHE=0). Units are shared only
// between builds that agree on the runtime's options; a different runtime
// entry compiles its own. Nothing is executed.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.TINT_GENERAL_FALLBACK = "0";
process.env.TINT_BUILD_ONLY = "defer-admission";
const { fixtureCacheStatistics, verifyHostedFixture } =
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

test("shared runtime units leave every image byte-identical", () => {
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
});
