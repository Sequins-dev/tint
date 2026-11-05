import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createNativeBatchBuilder,
  parsedNativeHost,
} from "./test262-native.ts";
import { workspaceSources } from "./workspace-sources.ts";

if (process.env.TINT_BUILD_ONLY !== "1")
  throw Error("agent policy fixture requires TINT_BUILD_ONLY=1");
const snapshot = workspaceSources();
const cases = [true, false].map((canSuspend, index) => ({
  scripts: [
    parsedNativeHost(
      `agent-policy-${index}`,
      `
import type {GlobalEnvironment} from "global";
import type {ScriptRecord,ScriptPropertyKey} from "object";
export function execute(global:GlobalEnvironment<ScriptPropertyKey,unknown>,script:ScriptRecord):{readonly error:string;readonly value:unknown}{
 const realm=script.realm;
 if(realm.agent.canSuspend!==${canSuspend ? "true" : "false"})throw "WRONG_AGENT_POLICY";
 return {error:"none",value:undefined};
}`,
      new Map([
        ["global", "packages/js-runtime/src/environments/global/index.ts"],
        ["object", "packages/js-runtime/src/objects/index.ts"],
      ]),
    ),
  ],
  asynchronous: false,
  canSuspend,
}));
const built = createNativeBatchBuilder(snapshot)(cases);
if (!built.ok) assert.fail(JSON.stringify(built.outcome));
const path = join(
  mkdtempSync(join(tmpdir(), "tint-native-agent-policy-")),
  "agent-policy",
);
writeFileSync(path, built.bytes, { mode: 0o755 });
console.log(path);
