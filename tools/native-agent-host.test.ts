import assert from "node:assert/strict";
import test from "node:test";
import * as objects from "@tint/js-runtime/objects";
test("native agent host uses the public realm-aware numeric coercion contract", () => {
  assert.equal(typeof Reflect.get(objects, "numberValue"), "function");
});
test("captured native host advertises agent authority through the explicit public provider", async () => {
  const { workspaceSources } = await import("./workspace-sources.ts");
  const { capturedNativeRuntimeCapabilities } =
    await import("./test262-native.ts");
  assert.equal(
    capturedNativeRuntimeCapabilities(workspaceSources()).agentHost,
    "packages/native-runtime/src/agents.ts",
  );
});
