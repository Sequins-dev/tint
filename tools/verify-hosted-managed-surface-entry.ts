import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule, type Module } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  reifyManagedSurfaceTypes,
  createManagedSurfaceFactory,
  adaptManagedSurfaceEntry,
} from "@tint/compiler/native";
import { verifyHostedFixture } from "./hosted-fixture.ts";
function parse(text: string): Module {
  const parsed = parseModule(createSourceTextView(text));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.value;
}
const hostFrame = process.argv.includes("--host-frame");
const checked = checkClosureModule(
  parse(
    (hostFrame
      ? "interface Frame{readonly $imports:unknown;readonly $argument0:Box;}"
      : "") +
      "interface Box{readonly value:number;}let calls:number=0;function read(box:Box):number{calls++;if(box.value<0)throw 99;return box.value;}function add(a:number,b:number):number{return a+b;}function count():number{return calls;}",
  ),
);
assert.ok(checked.ok, JSON.stringify(checked));
const surface = reifyManagedSurfaceTypes(
  checked.value,
  [
    { name: "read", local: "read" },
    { name: "add", local: "add" },
    { name: "count", local: "count" },
  ],
  "$Surface",
  [
    { name: "Box", local: "Box" },
    ...(hostFrame ? [{ name: "Frame", local: "Frame" }] : []),
  ],
);
assert.ok(surface.ok, JSON.stringify(surface));
const factory = createManagedSurfaceFactory(
  { checked: checked.value, surface: surface.value },
  "createSurface",
);
assert.ok(factory.ok, JSON.stringify(factory));
const adapted = adaptManagedSurfaceEntry(
  parse(
    'import {read} from "objects";import {add as sum} from "values";import {Box} from "types";function other(sum:number):number{return sum;}export function execute(box:Box):number{return sum(read(box),other(23));}',
  ),
  "execute",
  ["objects", "values", "types"],
  surface.value,
  hostFrame ? { frame: "Frame" } : undefined,
);
assert.ok(adapted.ok, JSON.stringify(adapted));
verifyHostedFixture(
  `import {createSurface} from "surface";
import {${adapted.value.entry} as invoke} from "managed";
export function run():number{
 const table=createSurface();
 ${hostFrame ? 'let rejected=false;try{invoke({$imports:{$other:42},$argument0:{value:19}});}catch(error){rejected=error==="MANAGED_SURFACE_TABLE";}if(!rejected||table.count()!==0)return 5;' : ""}
 if(invoke({$imports:table,$argument0:{value:19}})!==42||table.count()!==1)return 1;
 let caught=false;try{invoke({$imports:table,$argument0:{value:-1}});}catch(error){caught=error===99;}
 if(!caught||table.count()!==2)return 2;
 for(let i=0;i<640;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)return 3;}
 if(invoke({$imports:table,$argument0:{value:19}})!==42||table.count()!==3)return 4;
 return 42;
}`,
  hostFrame ? "managed-host-frame" : "managed-surface-entry",
  [
    ["surface", "surface-lib"],
    ["managed", "managed-lib"],
  ],
  [
    {
      id: "surface-lib",
      module: factory.value.checked.module,
      dependencies: new Map(),
    },
    {
      id: "managed-lib",
      module: {
        ...adapted.value.module,
        statements: adapted.value.module.statements.map((statement) =>
          statement.kind === "function" && statement.name === adapted.value.view
            ? { ...statement, exported: true }
            : statement,
        ),
      },
      dependencies: new Map(),
    },
  ],
  hostFrame && adapted.value.view !== undefined
    ? [{ module: "managed-lib", name: adapted.value.view, operation: "view" }]
    : [],
  hostFrame && adapted.value.view !== undefined
    ? [
        {
          module: "managed-lib",
          namespace: "host-frame",
          retainedExports: [adapted.value.view],
        },
      ]
    : [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 8388608,
    allocationCapacity: 262144,
    rootCapacity: 4096,
    stackBytes: 8388608,
  },
);
