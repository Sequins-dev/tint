import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  classifierSource,
  mixedGeneralTypeofSource,
} from "./typed-general-typeof-fixture-source.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("mixed typeof fixture requires TINT_BUILD_ONLY=1");
const runtime = "trusted:typeof";
const bytes = new TextEncoder().encode(classifierSource);
const source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok, JSON.stringify(parsed));
let partition: readonly string[] | undefined;
const path = verifyHostedFixture(
  mixedGeneralTypeofSource,
  "mixed-general-typeof",
  [["trusted", runtime]],
  [{ id: runtime, module: parsed.value, dependencies: new Map() }],
  [],
  [{ module: runtime, namespace: "trusted-typeof" }],
  {
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    onGeneralFallback(modules) {
      partition = modules;
    },
  },
);
assert.deepEqual(partition, ["fixture"]);
console.log(path);
