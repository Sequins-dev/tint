// String transfer primitives natively (docs/design-one-byte-strings.md,
// "Transfer contract"): isFlatString and flattenStringInto bound from the
// memory intrinsics, as cross-isolate transfer binds them.
import test from "node:test";
import { nativeFixtureTarget } from "./native-host-target.ts";
import { stringTransferSource } from "./string-transfer-fixture-source.ts";

// The fixture must compile on the typed path, not the general fallback (the
// builder reads this when it is imported).
process.env.TINT_GENERAL_FALLBACK = "0";
const { verifyHostedFixture } = await import("./hosted-fixture.ts");

const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  shared = "packages/native-runtime/src/intrinsics/shared-atomics.ts",
  process_ = "packages/native-runtime/src/intrinsics/process.ts";

test(
  "flat images of flat strings and slices, and rejected windows",
  {
    skip:
      nativeFixtureTarget().arch === "x86_64" &&
      "linux-x86_64 does not implement initializeCopyingRuntime",
  },
  () => {
    verifyHostedFixture(
      stringTransferSource,
      "string-transfer",
      [
        ["memory", memory],
        ["shared", shared],
        ["process", process_],
      ],
      [],
      [],
      [
        {
          module: memory,
          namespace: "string-transfer-memory",
          retainedExports: [
            "mapMemory",
            "unmapMemory",
            "isFlatString",
            "flattenStringInto",
          ],
        },
        {
          module: shared,
          namespace: "string-transfer-shared",
          retainedExports: ["readSharedUnsigned", "writeSharedUnsigned"],
        },
      ],
      {
        managedBytes: 4194304,
        allocationCapacity: 65536,
        // Raw windows leave the closed world the generational mutator needs.
        runtimeEntry: "initializeCopyingRuntime",
        hostBindings: [
          { module: memory, name: "mapMemory", operation: "memory-map" },
          { module: memory, name: "unmapMemory", operation: "memory-unmap" },
          { module: memory, name: "isFlatString", operation: "string-flat" },
          {
            module: memory,
            name: "flattenStringInto",
            operation: "string-flatten-into",
          },
          {
            module: shared,
            name: "readSharedUnsigned",
            operation: "shared-read-unsigned",
          },
          {
            module: shared,
            name: "writeSharedUnsigned",
            operation: "shared-write-unsigned",
          },
        ],
      },
    );
  },
);
