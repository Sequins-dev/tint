import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  createNativeBatchBuilder,
  prepareNativeModuleProgram,
} from "./test262-native.ts";
import {
  workspaceSources,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { startNativeHeartbeat } from "./test262-native-heartbeat.ts";
assert.equal(
  process.env.TINT_BUILD_ONLY,
  "1",
  "Build only; execute under the serial LLDB recorder",
);
const heartbeat = startNativeHeartbeat(
  "native A3 module/ShadowRealm host fixture",
);
try {
  const directory = mkdtempSync(join(tmpdir(), "tint-a3-combined-host-"));
  const source = `import text from './text.txt' with {type:'text'};import bytes from './bytes.bin' with {type:'bytes'};import {read} from './dep.js';if(text!=='hello\\n'||bytes.length!==3||bytes[1]!==255)throw 1;globalThis.identity='outer';if(Function("function g(){return g.caller;}function f(){return g();}return f()===f;")()!==true)throw 2;const realm=new ShadowRealm();const fn=realm.evaluate('()=>42');if(fn()!==42)throw 3;realm.importValue('./dep.js','read').then(imported=>{if(read()!=='outer'||imported()!==undefined)throw 4;print('Test262:AsyncTestComplete');});`;
  writeFileSync(join(directory, "root.js"), source);
  writeFileSync(join(directory, "text.txt"), "hello\n");
  writeFileSync(join(directory, "bytes.bin"), new Uint8Array([0, 255, 137]));
  writeFileSync(
    join(directory, "dep.js"),
    "export function read(){return globalThis.identity;}",
  );
  const snapshot = workspaceSources();
  heartbeat.phase("preparing unchanged bespoke source and graph");
  const prepared = prepareNativeModuleProgram(
    {
      source,
      goal: "module",
      harness: [],
      asynchronous: true,
      canSuspend: true,
    },
    [],
    join(directory, "root.js"),
    undefined,
    true,
    true,
  );
  assert.ok(prepared.ok, JSON.stringify(prepared));
  heartbeat.phase("compiling one native host fixture");
  const built = createNativeBatchBuilder(
    snapshot,
    true,
  )([
    {
      scripts: prepared.harness,
      modules: prepared.entries,
      moduleAbsent: prepared.absent ?? [],
      asynchronous: true,
    },
  ]);
  if (!built.ok) throw Error(JSON.stringify(built.outcome));
  const binary = join(directory, "combined-host");
  writeFileSync(binary, built.bytes, { mode: 0o755, flag: "wx" });
  writeFileSync(
    binary + ".manifest.json",
    JSON.stringify(
      {
        kind: "native-bespoke-module-assets-shadow-realm",
        conformance: false,
        source,
        sourceSnapshot: workspaceSourceIdentity(snapshot),
        fixtureFiles: prepared.fixtures,
        compilations: built.compilations,
        imageSha256: createHash("sha256").update(built.bytes).digest("hex"),
        expectedExit: 42,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(binary);
} finally {
  await heartbeat.close();
}
