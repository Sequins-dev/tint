import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {createSourceTextView} from "source";
import {parseModule,type Module} from "syntax";
import {checkClosureModule} from "checker";
import {reifyManagedSurfaceTypes,adaptManagedSurfaceEntry,type ManagedSurfaceLayoutRuntime} from "compiler";
import {prepareManagedJitProgram,lowerManagedJitProgram,verifyManagedJitFrame} from "program";
function parse(text:string):Module{const parsed=parseModule(createSourceTextView(text));if(!parsed.ok)throw "PARSE";return parsed.value;}
export function run():number{
 const checked=checkClosureModule(parse("interface Frame{readonly $imports:unknown;readonly $argument0:number;}function add(a:number,b:number):number{return a+b;}"));if(!checked.ok)return 1;
 const surface=reifyManagedSurfaceTypes(checked.value,[{name:"add",local:"add"}],"$Surface",[{name:"Frame",local:"Frame"}]);if(!surface.ok)return 2;
 const adapted=adaptManagedSurfaceEntry(parse('import {add} from "runtime";export function execute(x:number):number{return add(x,2);}'),"execute","runtime",surface.value,{frame:"Frame"});if(!adapted.ok)return 3;
 const view=adapted.value.view;if(view===undefined)return 4;
 const aliases:string[]=[];for(const statement of surface.value.declarations){if(statement===undefined||(statement.kind!=="interface"&&statement.kind!=="type-alias"))return 5;aliases.push(statement.name);}
 const runtime:ManagedSurfaceLayoutRuntime={modules:[],runtimes:[],globals:["undefined"]};
 const prepared=prepareManagedJitProgram(adapted.value.module,adapted.value.entry,view,aliases,runtime);if(!prepared.ok)return 6;
 if(prepared.value.entry===prepared.value.view||prepared.value.aliasTypes.size!==aliases.length)return 7;
 const entry=prepared.value.checked.bindings.functions[prepared.value.entry],viewFunction=prepared.value.checked.bindings.functions[prepared.value.view];
 if(entry===undefined||viewFunction===undefined||entry.parent!==undefined||viewFunction.parent!==undefined)return 8;
 for(const alias of aliases){if(alias===undefined)return 9;const type=prepared.value.aliasTypes.get(alias);if(type===undefined||prepared.value.checked.types[type]===undefined)return 10;}
 const exportedFrame=surface.value.types[0];if(exportedFrame===undefined)return 17;const frameType=exportedFrame.type;if(frameType.kind!=="named")return 18;
 if(!verifyManagedJitFrame(prepared.value,frameType.name).ok)return 19;
 const lowered=lowerManagedJitProgram(prepared.value);if(!lowered.ok)return 14;
 const machine=lowered.value.module.functions[lowered.value.entry];if(machine===undefined||machine.returnType!=="general"||machine.parameters.length!==1||machine.slots[machine.parameters[0]??-1]!=="reference")return 15;
 if(lowered.value.sources[lowered.value.entry]!==prepared.value.entry)return 16;
 if(prepareManagedJitProgram(adapted.value.module,"Missing",view,aliases,runtime).ok)return 11;
 if(prepareManagedJitProgram(adapted.value.module,adapted.value.entry,view,["Missing"],runtime).ok)return 12;
 if(prepareManagedJitProgram(adapted.value.module,adapted.value.entry,view,[aliases[0]??"Missing",aliases[0]??"Missing"],runtime).ok)return 13;
 return 42;
}`,
  "managed-jit-program",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
    ["program", "packages/compiler/src/native/managed-jit-program.ts"],
  ],
  [],
  [],
  [],
  {
    runtimeEntry: "initializeGenerationalRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    rootCapacity: 16384,
    stackBytes: 16777216,
  },
);
