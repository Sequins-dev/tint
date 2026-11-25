import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { runtimeSources } from "@tint/compiler/cli";
import { nativeServiceFixtureRequest } from "./native-service-fixture.ts";
import {
  prepareCachedNativeServiceUnit,
  createNativeServiceUnitIndex,
} from "./native-service-cache.ts";
import {
  workspaceSources,
  workspaceModules,
  workspaceSourceIdentity,
} from "./workspace-sources.ts";
import { frozenNativeRunIdentity } from "./native-run-journal.ts";
import { startNativeHeartbeat } from "./test262-native-heartbeat.ts";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const heartbeat = startNativeHeartbeat("native service unit fixture");
function parse(text: string) {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
try {
  const snapshot = workspaceSources(),
    identity = workspaceSourceIdentity(snapshot),
    toolchain = frozenNativeRunIdentity(import.meta.url, identity);
  assert.ok(toolchain, "freeze the native service fixture before compiling");
  const runtimes = runtimeSources(),
    runtime = {
      modules: workspaceModules(
        runtimes.map((item) => item.module),
        snapshot,
      ),
      runtimes,
      globals: [
        "undefined",
        "NaN",
        "Infinity",
        "Array",
        "Boolean",
        "String",
        "Number",
        "Math",
        "Map",
        "Set",
        "Uint8Array",
        "Uint16Array",
        "Uint32Array",
        "Float64Array",
        "ArrayBuffer",
        "SharedArrayBuffer",
        "DataView",
        "TextEncoder",
        "TextDecoder",
        "TypeError",
        "RangeError",
      ],
    };
  const request = nativeServiceFixtureRequest(runtime, true);
  const label = "unit\0\ud800😀";
  const module = parse(
    `import {seed,type Counter} from "host";let count:number=seed();const label:string=${JSON.stringify(label)};function next():number{count++;if(count===4)throw label;return count;}export function factory():Counter{return {next};}`,
  );
  heartbeat.phase("compiling/caching native counter factory");
  const input = {
    toolchainSha256: toolchain,
    sourceSnapshotSha256: identity.sha256,
    request: { ...request, module },
    data: [],
  };
  const first = prepareCachedNativeServiceUnit(
      resolve("native-service-cache"),
      input,
    ),
    second = prepareCachedNativeServiceUnit(
      resolve("native-service-cache"),
      input,
    );
  assert.equal(second.hit, true);
  assert.equal(second.digest, first.digest);
  const unitIndex = createNativeServiceUnitIndex([
    { cached: second, bind: { module: "counter-facade", name: "instantiate" } },
  ]);
  writeFileSync(
    resolve("native-service-fixture-unit.json"),
    JSON.stringify(
      {
        kind: "native-service-fixture-unit",
        sourceSnapshot: identity,
        toolchain,
        key: first.key,
        digest: first.digest,
        secondHit: second.hit,
        linkingMode: "aot-native-services-v1",
        ...unitIndex.identity,
        surface: first.unit.surface,
        unitBytes: first.unit.native.code.length,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  const helpers = parse(
    'import type {ManagedSurfaceExport} from "contracts";export interface Frame{readonly $imports:unknown;}export interface Counter{readonly next:()=>number;}export function seed():number{return 1;}export function bind():ManagedSurfaceExport{throw "MANAGED_SURFACE_UNBOUND";}export function view(value:unknown):Counter|undefined{throw "UNBOUND_COUNTER_VIEW";}',
  );
  const facade = parse(
    'interface Frame{readonly $imports:unknown;}export function instantiate(frame:Frame):unknown{throw "UNBOUND_SERVICE_FACTORY";}',
  );
  heartbeat.phase("building AOT executable with cached unit");
  verifyHostedFixture(
    `import {bind,view} from "helpers";import {instantiate} from "service";
 export function run():number{
  const table=bind().table,a=view(instantiate({$imports:table})),b=view(instantiate({$imports:table}));
  if(a===undefined||b===undefined||a===b||a.next===b.next)return 1;
  if(a.next()!==2||b.next()!==2)return 2;
  let checksum=0;for(let i=0;i<1024;i++){const bytes=new Uint8Array(65536);bytes[0]=i%256;checksum+=bytes[0]??0;}
  if(checksum!==130560||a.next()!==3||b.next()!==3)return 3;
  try{a.next();return 4;}catch(error){if(error!==${JSON.stringify(label)})return 5;}
  try{b.next();return 6;}catch(error){if(error!==${JSON.stringify(label)})return 7;}
  if(a.next()!==5||b.next()!==5)return 8;
  return 42;
 }`,
    "native-service-unit",
    [
      ["helpers", "counter-helpers"],
      ["service", "counter-facade"],
    ],
    [
      {
        id: "counter-helpers",
        module: helpers,
        dependencies: new Map([
          ["contracts", "packages/compiler/src/native/index.ts"],
        ]),
      },
      { id: "counter-facade", module: facade, dependencies: new Map() },
    ],
    [{ module: "counter-helpers", name: "view", operation: "view" }],
    [
      {
        module: "counter-helpers",
        namespace: "counter-host",
        retainedExports: ["view"],
      },
      { module: "counter-facade", namespace: "counter-service" },
    ],
    {
      nativeServices: unitIndex.services,
      nativeServiceIdentity: unitIndex.identity,
      managedSurfaces: [
        {
          name: "counter",
          values: [
            { module: "counter-helpers", name: "seed", typeArguments: [] },
          ],
          types: [
            { module: "counter-helpers", name: "Frame", typeArguments: [] },
            { module: "counter-helpers", name: "Counter", typeArguments: [] },
          ],
          frame: "Frame",
          bind: { module: "counter-helpers", name: "bind" },
        },
      ],
      runtimeEntry: "initializeGenerationalRuntime",
      managedBytes: 8388608,
      allocationCapacity: 262144,
      rootCapacity: 16384,
      stackBytes: 16777216,
    },
  );
} finally {
  await heartbeat.close();
}
