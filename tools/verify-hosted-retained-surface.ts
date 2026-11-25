import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const helpers = parseModule(
  createSourceTextView(`
import type {ManagedSurfaceExport} from "contracts";
export interface Item{readonly value:number;}
export interface Table{readonly view:(value:unknown)=>Item|undefined;}
export function view(value:unknown):Item|undefined{throw "UNBOUND_ITEM_VIEW";}
export function open(value:unknown):Table|undefined{throw "UNBOUND_TABLE_VIEW";}
export function bind():ManagedSurfaceExport{throw "MANAGED_SURFACE_UNBOUND";}
`),
);
assert.ok(helpers.ok);
verifyHostedFixture(
  `
import {bind,open,type Item} from "helpers";
export function run():number{
 const first=bind(),second=bind(),a=open(first.table),b=open(second.table);
 if(a===undefined||b===undefined||a.view!==b.view||first.functions[0]!==second.functions[0])return 60;
 const item:Item={value:42};if(a.view(item)!==item||a.view(undefined)!==undefined||a.view(19)!==undefined)return 61;
 for(let i=0;i<1024;i++){const bytes=new Uint32Array(8192);bytes[0]=i;if(bytes[0]!==i)return 62;}
 const third=bind(),c=open(third.table);if(c===undefined||c.view!==a.view||c.view(item)!==item)return 63;
 return 42;
}`,
  "retained-surface",
  [["helpers", "retained-surface-helpers"]],
  [
    {
      id: "retained-surface-helpers",
      module: helpers.value,
      dependencies: new Map([
        ["contracts", "packages/compiler/src/native/index.ts"],
      ]),
    },
  ],
  [
    { module: "retained-surface-helpers", name: "view", operation: "view" },
    { module: "retained-surface-helpers", name: "open", operation: "view" },
  ],
  [
    {
      module: "retained-surface-helpers",
      namespace: "retained-views",
      retainedExports: ["view", "open"],
    },
  ],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    managedSurfaces: [
      {
        name: "retained",
        values: [
          {
            module: "retained-surface-helpers",
            name: "view",
            typeArguments: [],
          },
        ],
        types: [],
        bind: { module: "retained-surface-helpers", name: "bind" },
      },
    ],
  },
);
