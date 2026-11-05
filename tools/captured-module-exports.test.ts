import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { parsedNativeHost } from "./test262-native.ts";
async function api() {
  assert.ok(
    existsSync("tools/captured-module-exports.ts"),
    "captured public export resolver must exist",
  );
  return import("./captured-module-exports.ts");
}
test("captured public exports follow reexports independently of private file location", async () => {
  const { capturedModuleExports } = await api();
  for (const privateId of ["old-private", "framework/internal/relocated"]) {
    const modules = [
      parsedNativeHost(
        "public",
        'export {install as installSharedArrayBufferIntrinsics} from "private";',
        new Map([["private", privateId]]),
      ),
      parsedNativeHost(
        privateId,
        "export function install():void {}",
        new Map(),
      ),
    ];
    assert.deepEqual(
      [...capturedModuleExports(modules).get("public")!],
      ["installSharedArrayBufferIntrinsics"],
    );
  }
});
test("private presence and type-only names cannot enable runtime capabilities", async () => {
  const { capturedModuleExports } = await api();
  const modules = [
    parsedNativeHost(
      "public",
      'export type {install} from "private";',
      new Map([["private", "private"]]),
    ),
    parsedNativeHost("private", "export class install {}", new Map()),
  ];
  assert.deepEqual([...capturedModuleExports(modules).get("public")!], []);
});
test("unresolved public contracts fail setup instead of silently disabling capabilities", async () => {
  const { capturedModuleExports } = await api();
  assert.throws(
    () =>
      capturedModuleExports([
        parsedNativeHost(
          "public",
          'export {missing} from "absent";',
          new Map([["absent", "absent"]]),
        ),
      ]),
    /unresolved export module/,
  );
});

test("captured native capabilities ignore mutable workspace and private installer presence", async () => {
  const { workspaceSources } = await import("./workspace-sources.ts");
  const { capturedNativeRuntimeCapabilities } =
    await import("./test262-native.ts");
  const snapshot = workspaceSources();
  const id = "packages/js-runtime/src/objects/index.ts";
  const input = snapshot.inputs.find((input) => input.id === id)!;
  const source = new TextDecoder().decode(input.bytes);
  const stripped = source.replace(
    /export \{ installSharedArrayBufferIntrinsics \} from "\.\/shared-array-buffer\.ts";\n/,
    "",
  );
  assert.notEqual(stripped, source, "must remove the captured public export");
  const historical = {
    ...snapshot,
    inputs: snapshot.inputs.map((item) =>
      item === input
        ? { ...item, bytes: new TextEncoder().encode(stripped) }
        : item,
    ),
  };
  assert.equal(
    capturedNativeRuntimeCapabilities(historical).sharedBuffers,
    false,
  );
  assert.equal(capturedNativeRuntimeCapabilities(snapshot).sharedBuffers, true);
});

test("an advertised shared installer without its captured native provider fails setup", async () => {
  const { workspaceSources } = await import("./workspace-sources.ts");
  const { capturedNativeRuntimeCapabilities } =
    await import("./test262-native.ts");
  const snapshot = workspaceSources();
  const incomplete = {
    ...snapshot,
    inputs: snapshot.inputs.filter(
      (input) => input.id !== "packages/native-runtime/src/shared-blocks.ts",
    ),
  };
  assert.throws(
    () => capturedNativeRuntimeCapabilities(incomplete),
    /missing|unknown|unresolved|entry/i,
  );
});

test("captured public provider roles resolve exported subpaths without private-file probes", async () => {
  const { capturedPublicEntry } = await api();
  const entries = [
    {
      packageId: "a",
      specifier: "@runtime/spin",
      target: "framework/host/spin.ts",
    },
    {
      packageId: "b",
      specifier: "@runtime/spin",
      target: "framework/host/spin.ts",
    },
  ];
  assert.equal(
    capturedPublicEntry(entries, "@runtime/spin"),
    "framework/host/spin.ts",
  );
  assert.equal(capturedPublicEntry(entries, "@runtime/missing"), undefined);
  assert.throws(
    () =>
      capturedPublicEntry(
        [
          ...entries,
          {
            packageId: "c",
            specifier: "@runtime/spin",
            target: "other/spin.ts",
          },
        ],
        "@runtime/spin",
      ),
    /ambiguous/,
  );
});

test("atomic backing authority follows captured exports rather than current workspace", async () => {
  const { workspaceSources } = await import("./workspace-sources.ts");
  const { capturedNativeRuntimeCapabilities } =
    await import("./test262-native.ts");
  const snapshot = workspaceSources();
  const id = "packages/native-runtime/src/shared-blocks.ts";
  const input = snapshot.inputs.find((input) => input.id === id)!;
  const original = new TextDecoder().decode(input.bytes);
  const text = original.replace(
    "export function nativeSharedAtomicMemoryHost",
    "function nativeSharedAtomicMemoryHost",
  );
  assert.notEqual(text, original);
  const historical = {
    ...snapshot,
    inputs: snapshot.inputs.map((item) =>
      item === input
        ? { ...item, bytes: new TextEncoder().encode(text) }
        : item,
    ),
  };
  assert.equal(
    capturedNativeRuntimeCapabilities(historical).sharedAtomics,
    false,
  );
  assert.equal(capturedNativeRuntimeCapabilities(snapshot).sharedAtomics, true);
});
test("weak capability requires both captured installer and the complete public native provider", async () => {
  const { workspaceSources } = await import("./workspace-sources.ts"),
    { capturedNativeRuntimeCapabilities } = await import("./test262-native.ts");
  const snapshot = workspaceSources();
  assert.equal(
    capturedNativeRuntimeCapabilities(snapshot).weakStorage,
    "packages/native-runtime/src/intrinsics/weak.ts",
  );
  const id = "packages/js-runtime/src/objects/index.ts",
    input = snapshot.inputs.find((item) => item.id === id)!;
  const original = new TextDecoder().decode(input.bytes),
    text = original.replace(
      /export \{ install(?:WeakCollection|WeakRef|FinalizationRegistry)Intrinsics \} from "\.\/[^"\n]+";\n/g,
      "",
    );
  assert.notEqual(text, original);
  const historical = {
    ...snapshot,
    inputs: snapshot.inputs.map((item) =>
      item === input
        ? { ...item, bytes: new TextEncoder().encode(text) }
        : item,
    ),
  };
  assert.equal(
    capturedNativeRuntimeCapabilities(historical).weakStorage,
    undefined,
  );
  const incomplete = {
    ...snapshot,
    inputs: snapshot.inputs.filter(
      (item) => item.id !== "packages/native-runtime/src/intrinsics/weak.ts",
    ),
  };
  assert.throws(
    () => capturedNativeRuntimeCapabilities(incomplete),
    /missing|unknown|entry|unresolved/i,
  );
});

test("direct-eval site image binding follows only the captured public view", async () => {
  const { workspaceSources } = await import("./workspace-sources.ts");
  const api = await import("./test262-native.ts");
  const snapshot = workspaceSources();
  const id = "packages/js-runtime/src/environments/global/index.ts";
  const input = snapshot.inputs.find((x) => x.id === id)!;
  const text = new TextDecoder().decode(input.bytes);
  const historicalText = text.replace("  viewDirectEvalSite,\n", "");
  assert.notEqual(text, historicalText);
  const historical = {
    ...snapshot,
    inputs: snapshot.inputs.map((x) =>
      x === input
        ? { ...x, bytes: new TextEncoder().encode(historicalText) }
        : x,
    ),
  };
  assert.equal(
    api.capturedNativeRuntimeCapabilities(snapshot).directEvalSiteView,
    true,
  );
  assert.equal(
    api.capturedNativeRuntimeCapabilities(historical).directEvalSiteView,
    false,
  );
  assert.deepEqual(api.directEvalSiteImageContract(false), {
    runtimes: [],
    recordBindings: [],
  });
  assert.deepEqual(api.directEvalSiteImageContract(true), {
    runtimes: [
      {
        module: id,
        namespace: "global-environment",
        retainedExports: ["viewDirectEvalSite"],
      },
    ],
    recordBindings: [
      { module: id, name: "viewDirectEvalSite", operation: "view" },
    ],
  });
});
