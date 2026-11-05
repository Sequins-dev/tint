import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceTextView} from "source";
import {parseModule,type Module} from "syntax";
import {checkClosureModule} from "checker";
import {reifyManagedSurfaceTypes,normalizeManagedSurfaceApplications} from "compiler";
function parse(text:string):Module{const p=parseModule(createSourceTextView(text));if(!p.ok)throw "PARSE";return p.value;}
export function run():number {
 const checked=checkClosureModule(parse('interface Box{readonly value:unknown;}function create(value:unknown):Box{return {value};}'));if(!checked.ok)return 1;
 const surface=reifyManagedSurfaceTypes(checked.value,[{name:"create",local:"create"}],"$Surface",[{name:"Box",local:"Box"}]);if(!surface.ok)return 2;
 const approved=new Set<string>();approved.add("runtime");
 const registry=new Map<string,readonly string[]>();registry.set("create",["unknown"]);registry.set("Box",["unknown"]);
 const module=parse('import {create as make,type Box as Wrapped} from "runtime";export function execute():unknown{const box:Wrapped<unknown>=make<unknown>(42);return box.value;}');
 const normalized=normalizeManagedSurfaceApplications(module,approved,registry,surface.value);if(!normalized.ok||normalized.value.erased!==2)return 3;
 const twice=normalizeManagedSurfaceApplications(normalized.value.module,approved,registry,surface.value);if(!twice.ok||twice.value.erased!==0)return 4;
 const wrong=normalizeManagedSurfaceApplications(parse('import {create} from "runtime";function f(){return create<number>(42);}'),approved,registry,surface.value);if(wrong.ok)return 5;
 const local=parse('import {create as make,type Box as Wrapped} from "runtime";function local<T>(value:T):T{return value;}function shadow(make:(value:number)=>number):number{return make<number>(42);}function typed():number{type Wrapped<T>={value:T};const local:Wrapped<number>={value:42};return local.value;}export function execute():unknown{const box:Wrapped<unknown>=make<unknown>(local<number>(42));return box.value;}');
 const shadowed=normalizeManagedSurfaceApplications(local,approved,registry,surface.value);if(!shadowed.ok||shadowed.value.erased!==2)return 6;
 return 42;
}`,
  "managed-applications",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
  ],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    rootCapacity: 16384,
    stackBytes: 16777216,
  },
);
