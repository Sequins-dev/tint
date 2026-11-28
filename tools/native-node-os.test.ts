// Native node:os (docs/native-ffi.md, "Foreign memory"): userInfo,
// networkInterfaces and loadavg read memory C owns through tint:ffi/unsafe
// views and match Node on this machine, executed under LLDB; and each target's
// node:os module fails to resolve on the other target. Kept apart from
// native-ffi.test.ts: these programs link the JavaScript object surface (24 MB
// images, minutes to build on the CI runner), so the gate can shard them
// separately.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { verifyOsFixture } from "./native-os-fixtures.ts";

test("node:os userInfo, networkInterfaces and loadavg match Node", () => {
  verifyOsFixture();
});
/** Build `module` as node:os for `target` in a child process (the fixture
 * target is fixed when hosted-fixture.ts loads). */
function buildOsFor(module: string, target: string) {
  const script = `import { osFixtureDependencies, osFixtureSource } from ${JSON.stringify(
    new URL("./native-os-fixtures.ts", import.meta.url).href,
  )};
import { verifyHostedFixture } from ${JSON.stringify(
    new URL("./hosted-fixture.ts", import.meta.url).href,
  )};
verifyHostedFixture(osFixtureSource(), "node-os-other", osFixtureDependencies(${JSON.stringify(module)}));`;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, TINT_NATIVE_TARGET: target, TINT_BUILD_ONLY: "1" },
  });
}
test("each target's node:os fails explicitly on the other target", () => {
  // No silent misreading of the other C library's records: resolution
  // rejects the binding import.
  for (const [module, target] of [
    ["darwin", "linux-aarch64"],
    ["linux", "darwin-aarch64"],
  ] as const) {
    const result = buildOsFor(
      "packages/native-runtime/src/node/os-" + module + ".ts",
      target,
    );
    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(
      result.stderr.includes(
        `"stage":"resolve","module":"packages/native-runtime/src/node/os-${module}-host.ts","message":"UNDECLARED_IMPORT: tint:c/${module}-os"`,
      ),
      result.stderr.slice(-2000),
    );
  }
});
