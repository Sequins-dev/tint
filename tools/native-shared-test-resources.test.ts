import assert from "node:assert/strict";
import test from "node:test";
import { createNativeSharedBlockService } from "@tint/native-runtime/shared-blocks";
import { NodeSharedMemoryHost } from "./node-shared-memory-host.ts";
import { nativeTestResources } from "./test262-native.ts";

test("native conformance resources retain the shared conversion workload's small buffers", () => {
  const host = new NodeSharedMemoryHost();
  const created = createNativeSharedBlockService(host, {
    pageSize: nativeTestResources.sharedMemoryPageBytes,
    maxBlocks: nativeTestResources.sharedMemoryBlocks,
    maxReservedBytes: nativeTestResources.sharedMemoryBytes,
  });
  assert.ok(created.ok);
  const service = created.value;
  let first = 0;
  // The unchanged conversion matrix creates four SABs for each of 56 values
  // across five destination kinds. Native blocks outlive all agent mappings.
  const count = 4 * 56 * 5;
  for (let index = 0; index < count; index++) {
    const block = service.create(4, 4, false);
    assert.ok(block.ok, `shared allocation ${index + 1}/${count}`);
    if (index === 0) {
      first = block.value.handle;
      assert.equal(service.writeUnsigned(first, 0, 4, 42, "seq-cst"), "none");
    }
  }
  assert.deepEqual(service.readUnsigned(first, 0, 4, "seq-cst"), {
    ok: true,
    value: 42,
  });
});
