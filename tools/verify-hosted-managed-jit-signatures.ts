import { verifyHostedFixture } from "./hosted-fixture.ts";
import {
  managedJitFixtureText,
  managedJitFixtureValues,
  managedJitFixtureTypes,
} from "./managed-jit-fixture.ts";
const entryMode = process.argv.includes("--entry");
verifyHostedFixture(
  `
import {createSourceTextView} from "source";
import {parseModule,type Module} from "syntax";
import {checkClosureModule} from "checker";
import {reifyManagedSurfaceTypes,canonicalizeManagedSurfaceTypes,deriveManagedSurfacePhysicalFacts,createManagedSurfaceDirectory,adaptManagedSurfaceEntry,managedDirectCallDeclarations,readManagedSurfaceDirectory,type ManagedSurfaceTypeEntry,type ManagedSurfaceTypeDescription,type SerializedManagedSurfaceDirectory,type ManagedSurfaceLayoutRuntime} from "compiler";
import {prepareManagedJitProgram,lowerManagedJitProgram} from "program";
import {bindManagedJitSignatures} from "signatures";
import {prepareManagedSurfaceEntry} from "entry";
function parse(text:string):Module{const parsed=parseModule(createSourceTextView(text));if(!parsed.ok)throw "PARSE";return parsed.value;}
function check(text:string,surface:ManagedSurfaceTypeDescription,directory:SerializedManagedSurfaceDirectory,expected:string):number{
 const adapted=adaptManagedSurfaceEntry(parse('import {apply,useLeft,useRight,keep,box,tag,getInc,getWide,type Box,type Tag,type Wide} from "runtime";'+text),"execute","runtime",surface,{frame:"Frame"});if(!adapted.ok)throw "ADAPT";
 const view=adapted.value.view;if(view===undefined)throw "VIEW";
 const aliases:string[]=[];for(const statement of surface.declarations){if(statement===undefined||(statement.kind!=="type-alias"&&statement.kind!=="interface"))throw "ALIAS";aliases.push(statement.name);}
 const runtime:ManagedSurfaceLayoutRuntime={modules:[],runtimes:[],globals:["undefined"]};
 const prepared=prepareManagedJitProgram(adapted.value.module,adapted.value.entry,view,aliases,runtime);if(!prepared.ok)throw "PREPARE";
 const direct=managedDirectCallDeclarations(prepared.value.checked,prepared.value.entry);if(!direct.ok)throw "PROOF";
 const lowered=lowerManagedJitProgram(prepared.value);if(!lowered.ok)throw "LOWER";
 const bound=bindManagedJitSignatures(prepared.value,lowered.value,directory,direct.value);
 if(expected!==""){if(bound.ok)return 1;return bound.error.includes(expected)?0:2;}
 if(!bound.ok)return 3;if((bound.value.signatures.length===0)!==(bound.value.brand===undefined))return 3;
 return 0;
}
export function run():number{
 const checked=checkClosureModule(parse(${JSON.stringify(managedJitFixtureText)}));if(!checked.ok)return 1;
 const values:ManagedSurfaceTypeEntry[]=[],types:ManagedSurfaceTypeEntry[]=[];
 const valueNames:readonly string[]=${JSON.stringify(managedJitFixtureValues)},typeNames:readonly string[]=${JSON.stringify(managedJitFixtureTypes)};
 for(const name of valueNames){if(name===undefined)return 2;values.push({name,local:name});}for(const name of typeNames){if(name===undefined)return 3;types.push({name,local:name});}
 const described=reifyManagedSurfaceTypes(checked.value,values,"$S",types);if(!described.ok)return 4;
 const canonical=canonicalizeManagedSurfaceTypes(described.value);if(!canonical.ok)return 5;
 const runtime:ManagedSurfaceLayoutRuntime={modules:[],runtimes:[],globals:["undefined"]};
 const facts=deriveManagedSurfacePhysicalFacts(canonical.value,runtime);if(!facts.ok)return 6;
 const directory=createManagedSurfaceDirectory("typed",canonical.value,facts.value,"Frame");if(!directory.ok)return 7;
 if(${entryMode}){
  const functions:unknown[]=[];const known=():unknown=>undefined;for(let i=0;i<canonical.value.entries.length+directory.value.witnesses.length;i++)functions.push(known);
  const records=new Float64Array(directory.value.directory.records.length);for(let i=0;i<records.length;i++)records[i]=0x100000+i*1024;
  const read=readManagedSurfaceDirectory({directory:directory.value.directory,table:undefined,functions,records,entries:new Float64Array(0)},"typed",{domain:():number=>17,descriptor:(value:unknown):number=>0x200000,signature:(value:unknown):number=>0x300000});if(!read.ok)return 61;
  const specifiers=new Set<string>();specifiers.add("runtime");
  const prepared=prepareManagedSurfaceEntry({module:parse('import {apply} from "runtime";export function execute(x:number):number{return apply((v:number):number=>v+1,x);}'),entry:"execute",specifiers,instantiations:new Map<string,readonly string[]>(),read:read.value,runtime});
  if(!prepared.ok)return 62;if(prepared.value.native.linkage!=="unresolved-managed"||prepared.value.native.managedImports.length===0||prepared.value.counts.signatures===0||prepared.value.entryOffset<0)return 63;
 }
 if(check('export function execute(x:number):number{const inc=(v:number):number=>v+1;return apply(inc,x);}',canonical.value,directory.value.directory,"")!==0)return 8;
 if(check('export function execute(x:number):number{return useLeft((v:Box):number=>v.n)+useRight((v:Tag):number=>v.m);}',canonical.value,directory.value.directory,"")!==0)return 9;
 if(check('export function execute(x:number):number{function h(v:boolean):number{return x;}return h(true)+h(false);}',canonical.value,directory.value.directory,"")!==0)return 10;
 if(check('export function execute(x:number):number{return keep((v:string):string=>v);}',canonical.value,directory.value.directory,"without an exact surface")!==0)return 11;
 if(check('export function execute(x:number):number{const f=(v:number):number=>v;const w:Wide=f;return w(x)??0;}',canonical.value,directory.value.directory,"variance crosses")!==0)return 12;
 return 42;
}`,
  entryMode ? "managed-jit-entry" : "managed-jit-signatures",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
    ["program", "packages/compiler/src/native/managed-jit-program.ts"],
    ["signatures", "packages/compiler/src/native/managed-jit-signatures.ts"],
    ["entry", "packages/compiler/src/native/managed-jit-entry.ts"],
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
