import assert from "node:assert/strict";
import test from "node:test";
import { parseScript } from "@tint/typescript/syntax";
import { createSourceTextView } from "@tint/source/text";
import { lowerScript } from "@tint/js-engine/lowering";
import { prepareManagedSurfaceEntry } from "@tint/compiler/native";
import { createManagedScriptFixture } from "./managed-script-fixture.ts";
import { nativeTestResources } from "./test262-native.ts";
import {
  agentWaitCoercionWorkload,
  agentTimedWaitWorkload,
} from "./native-agent-wait-workloads.ts";

test("uniform native Script resources admit agent coercion and clock workloads", () => {
  const fixture = createManagedScriptFixture();
  for (const source of [agentWaitCoercionWorkload, agentTimedWaitWorkload]) {
    const parsed = parseScript(createSourceTextView(source));
    assert.ok(parsed.ok);
    const lowered = lowerScript(parsed.value, source);
    assert.ok(lowered.ok);
    const prepared = prepareManagedSurfaceEntry({
      ...fixture,
      module: lowered.value,
      entry: "execute",
    });
    assert.ok(prepared.ok);
    const bytes = prepared.value.native.code.length;
    assert.ok(
      bytes <= nativeTestResources.maxScriptCodeBytes,
      `agent entry ${bytes} bytes exceeds uniform budget ${nativeTestResources.maxScriptCodeBytes}`,
    );
  }
});
