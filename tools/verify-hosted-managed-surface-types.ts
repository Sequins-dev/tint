import { verifyHostedFixture } from "./hosted-fixture.ts";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createSourceTextView } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { checkClosureModule } from "@tint/typescript/checker";
import {
  reifyManagedSurfaceTypes,
  canonicalizeManagedSurfaceTypes,
  deriveManagedSurfacePhysicalFacts,
  createManagedSurfaceDirectory,
  encodeManagedSurfaceDirectory,
} from "@tint/compiler/native";
const hostFrameOnly = process.argv.includes("--host-frame");
const sparseListText = readFileSync(
  "packages/foundation/src/collections/sparse-list.ts",
  "utf8",
);
const sparseListSource = JSON.stringify(sparseListText);
const surfaceReferenceText =
  "interface Link{readonly value:number;readonly next:Link|undefined;}function add(a:number,b:number):number{return a+b;}function keep(value:Link):Link{return value;}function list(values:unknown[]):unknown[]{return values;}";
const referenceParsed = parseModule(createSourceTextView(surfaceReferenceText)),
  referenceRuntime = parseModule(createSourceTextView(sparseListText));
assert.ok(referenceParsed.ok && referenceRuntime.ok);
const referenceChecked = checkClosureModule(referenceParsed.value);
assert.ok(referenceChecked.ok, JSON.stringify(referenceChecked));
const referenceSurface = reifyManagedSurfaceTypes(
  referenceChecked.value,
  [
    { name: "add", local: "add" },
    { name: "keep", local: "keep" },
    { name: "list", local: "list" },
  ],
  "$Surface",
  [{ name: "Link", local: "Link" }],
);
assert.ok(referenceSurface.ok);
const referenceCanonical = canonicalizeManagedSurfaceTypes(
  referenceSurface.value,
);
assert.ok(referenceCanonical.ok);
const referenceFacts = deriveManagedSurfacePhysicalFacts(
  referenceCanonical.value,
  {
    modules: [
      {
        id: "sparse-layout",
        module: referenceRuntime.value,
        dependencies: new Map(),
      },
    ],
    runtimes: [{ module: "sparse-layout", namespace: "sparse-list" }],
    globals: ["undefined", "Number"],
  },
);
assert.ok(referenceFacts.ok, JSON.stringify(referenceFacts));
const referenceName = "native-surface\uD800";
const referenceDirectory = createManagedSurfaceDirectory(
  referenceName,
  referenceCanonical.value,
  referenceFacts.value,
);
assert.ok(referenceDirectory.ok);
const referenceEncoding = encodeManagedSurfaceDirectory(
  referenceDirectory.value.directory,
);
assert.ok(referenceEncoding.ok);
verifyHostedFixture(
  `import {createSourceTextView} from "source";
import {parseModule,rewriteModule,type Module,type Statement} from "syntax";
import {checkClosureModule} from "checker";
import {bindModule} from "binding";
import {linkModules,specializeModule,prepareModuleInstance} from "modules";
import {emitModule} from "emitter";
import {printReifiedTypes} from "reify";
import {readManagedSurfaceDirectory,verifyManagedSurfacePhysicalAgreement,materializeManagedSurfaceTable,createManagedSurfaceAnchors,resolveManagedSurfaceAnchors,createManagedSurfaceDirectory,encodeManagedSurfaceDirectory,deriveManagedSurfacePhysicalFacts,planManagedSurfaceContracts,canonicalizeManagedSurfaceTypes,resolveManagedSurfaceSelections,prepareManagedSurfaceTable,reifyManagedSurfaceTypes,prepareManagedSurfaceTypes,createManagedSurfaceFactory,createManagedSurfaceReflectors,createManagedSurfaceWitnessFactory,createManagedTypeContractIndex,planManagedSignatureGroups,lowerManagedSignatureGroups,compileArm64Program,serializeManagedSurfaceTypes,restoreManagedSurfaceTypes,adaptManagedSurfaceEntry,prepareNativeFunctionEntry} from "compiler";
function parse(text:string):Module{
 const source=createSourceTextView(text);
 const parsed=parseModule(source);if(!parsed.ok)throw "PARSE";return parsed.value;
}
function generated(text:string,shifted:boolean):Module{
 return rewriteModule(parse(text),{statement:(node,original)=>({...node,start:shifted?1000:0,end:shifted?1001:0,nodeHash:0}),expression:(node,original)=>({...node,start:0,end:0,nodeHash:0}),type:(node,original)=>({...node,start:0,end:0,nodeHash:0})});
}
export function run():number{
 if(${hostFrameOnly}){
  const checkedFrame=checkClosureModule(parse("interface Frame{readonly $imports:unknown;readonly $argument0:number;}function add(a:number,b:number):number{return a+b;}"));if(!checkedFrame.ok)return 101;
  const frameSurface=reifyManagedSurfaceTypes(checkedFrame.value,[{name:"add",local:"add"}],"$Host",[{name:"Frame",local:"Frame"}]);if(!frameSurface.ok)return 102;
  const entryModule=parse('import {add} from "runtime";export function execute(value:number):number{return add(value,2);}');
  const adapted=adaptManagedSurfaceEntry(entryModule,"execute","runtime",frameSurface.value,{frame:"Frame"});if(!adapted.ok)return 103;
  if(adapted.value.view===undefined||adapted.value.module.imports.length!==0)return 104;
  const adaptedEntry=adapted.value.entry;
  const wrapper=adapted.value.module.statements.find(statement=>statement!==undefined&&statement.kind==="function"&&statement.name===adaptedEntry);
  if(wrapper===undefined||wrapper.kind!=="function")return 105;
  const returned=wrapper.returnType;const wrapperBody=wrapper.body;
  if(returned===undefined||returned.kind!=="named"||returned.name!=="unknown"||wrapperBody.kind!=="block")return 105;
  if(wrapperBody.statements[0]?.kind!=="variable"||wrapperBody.statements[1]?.kind!=="if"||!checkClosureModule(adapted.value.module).ok)return 106;
  if(adaptManagedSurfaceEntry(entryModule,"execute","runtime",frameSurface.value,{frame:"Missing"}).ok)return 107;
  const invalid=checkClosureModule(parse("interface Frame{readonly $imports:number;readonly $argument0:number;}"));if(!invalid.ok)return 108;
  const invalidSurface=reifyManagedSurfaceTypes(invalid.value,[],"$Bad",[{name:"Frame",local:"Frame"}]);if(!invalidSurface.ok)return 109;
  if(adaptManagedSurfaceEntry(entryModule,"execute","runtime",invalidSurface.value,{frame:"Frame"}).ok)return 110;
  return 42;
 }
 const module=parse(${JSON.stringify(surfaceReferenceText)});
 const checked=checkClosureModule(module);if(!checked.ok)return 1;
 const surface=reifyManagedSurfaceTypes(checked.value,[{name:"add",local:"add"},{name:"keep",local:"keep"},{name:"list",local:"list"}],"$Surface",[{name:"Link",local:"Link"}]);if(!surface.ok)return 2;
 if(surface.value.entries.length!==3||surface.value.types.length!==1)return 3;
 const stub=parse("export function entry(table:unknown):number{return table.add(19,23);}");
 const entry=stub.statements[0];if(entry===undefined||entry.kind!=="function")return 4;
 const parameter=entry.parameters[0];if(parameter===undefined)return 5;
 const statements:Statement[]=surface.value.declarations.slice();
 statements.push({...entry,parameters:[{...parameter,type:surface.value.table}]});
 const prepared=prepareNativeFunctionEntry({...stub,statements},"entry",{recordTypes:true});if(!prepared.ok)return 6;
 if(prepared.value.fn.parameters.length!==1)return 7;
 const tableType=surface.value.table;if(tableType.kind!=="named")return 17;
 const recordTypes=prepared.value.recordTypes;if(recordTypes===undefined)return 18;
 const tableRecord=recordTypes.find(item=>item!==undefined&&item.name===tableType.name);
 if(tableRecord===undefined||prepared.value.module.records?.[tableRecord.record]===undefined)return 19;
 const bad=reifyManagedSurfaceTypes(checked.value,[{name:"add",local:"missing"}],"$Surface");if(bad.ok)return 8;
 const number=checked.value.types.findIndex(type=>type!==undefined&&type.kind==="number");if(number<0)return 9;
 const keep=checked.value.bindings.bindings.find(binding=>binding!==undefined&&binding.name==="keep");if(keep===undefined)return 10;
 const keepId=checked.value.bindingTypes[keep.id];if(keepId===undefined)return 11;
 const keepType=checked.value.types[keepId];if(keepType===undefined||keepType.kind!=="function")return 12;
 const link=keepType.parameters[0];if(link===undefined)return 13;
 const generic=parse("function identity<T>(value:T):T{return value;}function list<T>(values:T[]):T[]{return values;}");
 const specialized=prepareManagedSurfaceTypes(generic,checked.value.types,[{name:"numberIdentity",local:"identity",typeArguments:[number]},{name:"linkIdentity",local:"identity",typeArguments:[link]},{name:"links",local:"list",typeArguments:[link]},{name:"alias",local:"identity",typeArguments:[number]}],"$Specialized",["undefined"]);if(!specialized.ok)return 14;
 const entries=specialized.value.surface.entries;
 const first=entries[0],second=entries[1],alias=entries[3];if(first===undefined||second===undefined||alias===undefined)return 15;
 if(first.local!==alias.local||first.local===second.local)return 16;
 const functions=prepared.value.module.functions.slice();
 const duplicate=functions.length;functions.push({...prepared.value.fn,id:duplicate,name:"duplicate"});
 const native=emitModule({...prepared.value.module,functions},{localSignatures:[{name:"first",contract:"test.first.v1",functions:[prepared.value.entryId]},{name:"second",contract:"test.second.v1",functions:[duplicate]}]});if(!native.ok)return 20;
 const firstSignature=native.value.signatures.find(signature=>signature!==undefined&&signature.functions.includes(prepared.value.entryId));
 const secondSignature=native.value.signatures.find(signature=>signature!==undefined&&signature.functions.includes(duplicate));
 if(firstSignature===undefined||secondSignature===undefined||firstSignature.offset===secondSignature.offset)return 21;
 if(firstSignature.identity?.contract!=="test.first.v1"||secondSignature.identity?.contract!=="test.second.v1")return 22;
 const denied=emitModule({...prepared.value.module,functions},{managedABI:{version:1,functionBrand:{name:"brand",contract:"test.first.v1"},signatures:[]},localSignatures:[{name:"local",contract:"test.first.v1",functions:[prepared.value.entryId]}]});if(denied.ok)return 23;
 const created=createManagedSurfaceFactory({checked:checked.value,surface:surface.value},"createSurface");if(!created.ok)return 24;
 const direct=prepareManagedSurfaceTypes(module,checked.value.types,[{name:"add",local:"add",typeArguments:[]}],"$Direct",["undefined"]);if(!direct.ok)return 25;
 const directFactory=createManagedSurfaceFactory(direct.value,"createDirectSurface");if(!directFactory.ok)return 26;
 const reflectors=createManagedSurfaceReflectors(surface.value,"$Reflect");if(!reflectors.ok||reflectors.value.signatures.length!==3||reflectors.value.functionBrand===undefined)return 27;
 if(reflectors.value.recordDescriptors.length<2||reflectors.value.typeSignatures.length<3)return 28;
 for(const declaration of surface.value.declarations){
  if(declaration===undefined||declaration.kind!=="type-alias")continue;
  const id=reflectors.value.checked.typeNames.get(declaration.name);if(id===undefined)return 29;
  const type=reflectors.value.checked.types[id];if(type===undefined)return 30;
  if(type.kind==="object"&&!reflectors.value.recordDescriptors.some(item=>item.name===declaration.name))return 31;
  if(type.kind==="function"&&!reflectors.value.typeSignatures.some(item=>item.name===declaration.name))return 32;
 }
 const adapted=adaptManagedSurfaceEntry(parse('import {keep,type Link} from "runtime";export function execute(value:Link):Link{return keep(value);}'),"execute","runtime",surface.value);if(!adapted.ok)return 33;
 const managed=prepareNativeFunctionEntry(adapted.value.module,adapted.value.entry,{recordTypes:true,signatureTypes:true});if(!managed.ok||managed.value.fn.parameters.length!==1)return 34;
 const frame=adapted.value.frame,frameRecords=managed.value.recordTypes;if(frame.kind!=="named"||frameRecords===undefined)return 35;
 if(!frameRecords.some(item=>item!==undefined&&item.name===frame.name))return 36;
 const serialized=printReifiedTypes(surface.value.declarations);if(!serialized.ok)return 37;
 const restored=parse(serialized.value),restoredCheck=checkClosureModule(restored);if(!restoredCheck.ok)return 38;
 const stable=printReifiedTypes(restored.statements);if(!stable.ok||stable.value!==serialized.value)return 39;
 const wire=serializeManagedSurfaceTypes(surface.value);if(!wire.ok)return 40;
 const restoredSurface=restoreManagedSurfaceTypes(wire.value);if(!restoredSurface.ok)return 41;
 const again=serializeManagedSurfaceTypes(restoredSurface.value);if(!again.ok||again.value.declarations!==wire.value.declarations)return 46;
 const restoredEntry=adaptManagedSurfaceEntry(parse('import {keep,type Link} from "runtime";export function execute(value:Link):Link{return keep(value);}'),"execute","runtime",restoredSurface.value);if(!restoredEntry.ok)return 43;
 if(!prepareNativeFunctionEntry(restoredEntry.value.module,restoredEntry.value.entry).ok)return 44;
 if(restoreManagedSurfaceTypes({...wire.value,version:2}).ok)return 45;
 const witnesses=createManagedSurfaceWitnessFactory(restoredSurface.value,"$Witness");if(!witnesses.ok||witnesses.value.entries.length<3)return 47;
 const witnessCode=compileArm64Program({modules:[{id:"witnesses",module:witnesses.value.checked.module,dependencies:new Map<string,string>()},{id:"sparse-list-runtime",module:parse(${sparseListSource}),dependencies:new Map<string,string>()}],entry:"witnesses",exports:[witnesses.value.factory],runtimes:[{module:"sparse-list-runtime",namespace:"sparse-list"}]});if(!witnessCode.ok)return 48;
 const contracts=createManagedTypeContractIndex([{kind:"number"},{kind:"string"},{kind:"object",properties:[{name:"value",type:0,readonly:true},{name:"next",type:2,readonly:true}]},{kind:"object",properties:[{name:"value",type:0,readonly:true},{name:"next",type:3,readonly:true}]},{kind:"function",parameters:[2],result:2},{kind:"function",parameters:[3],result:3},{kind:"function",parameters:[1],result:1}]);if(!contracts.ok)return 49;
 const equivalent=contracts.value.matches(4,5),different=contracts.value.matches(4,6);if(!equivalent.ok||!equivalent.value||!different.ok||different.value)return 50;
 const cachedEqual=contracts.value.matches(4,5),cachedDifferent=contracts.value.matches(4,6);if(!cachedEqual.ok||!cachedEqual.value||!cachedDifferent.ok||cachedDifferent.value)return 51;
 const memberBinding=checked.value.bindings.bindings.find(binding=>binding!==undefined&&binding.kind==="function"&&binding.name==="add");if(memberBinding===undefined)return 52;
 const member=checked.value.bindings.functions.find(fn=>fn!==undefined&&fn.node===memberBinding.node),memberType=checked.value.bindingTypes[memberBinding.id];if(member===undefined||memberType===undefined)return 53;
 const groups=planManagedSignatureGroups(checked.value,[{name:"add",contract:"test.add.v1",type:memberType,functions:[member.id]}]);if(!groups.ok)return 54;
 const witnessTypes=new Uint32Array(checked.value.types.length);witnessTypes[memberType]=2;
 const mappedGroups=lowerManagedSignatureGroups(groups.value,[member.id],witnessTypes);if(!mappedGroups.ok)return 55;
 const group=mappedGroups.value[0];if(group===undefined||group.functions.length!==2||group.functions[0]!==0||group.functions[1]!==1)return 56;
 const selectionModule=parse("export type Key=string;export interface Box<T>{readonly value:T;}let count=0;export function identity<T>(value:T):T{count++;return value;}export function retain<T>(value:T):T{return value;}export function direct():number{return identity<number>(42);}");
 const linked=linkModules([{id:"helpers",module:selectionModule,dependencies:new Map<string,string>()}],"helpers",[],{evaluation:"instance"});if(!linked.ok)return 61;
 const bound=bindModule(linked.value.module);if(!bound.ok)return 62;
 const selections=resolveManagedSurfaceSelections(linked.value,bound.value,[{module:"helpers",name:"identity",typeArguments:[{kind:"keyword",name:"number"}]}],[{module:"helpers",name:"Box",typeArguments:[{kind:"export",name:"Key"}]},{module:"helpers",name:"Key",typeArguments:[]}]);if(!selections.ok||selections.value.roots.length!==1)return 63;
 const specializedTable=specializeModule(linked.value.module,bound.value,{roots:selections.value.roots});if(!specializedTable.ok||specializedTable.value.specializations.length!==1)return 64;
 const table=prepareManagedSurfaceTable(specializedTable.value.module,selections.value,specializedTable.value.roots,"$Table","createTable");if(!table.ok||table.value.surface.entries.length!==1||table.value.surface.types.length!==2)return 65;
 const selectedEntry=table.value.surface.entries[0];if(selectedEntry===undefined||selectedEntry.local!==specializedTable.value.roots[0])return 66;
 const identityDependencies=new Map<string,string>();identityDependencies.set("identity","identity");
 const identityCode=compileArm64Program({modules:[{id:"identity",module:parse('export interface Box{readonly value:number;}export function identity(witness:Box|undefined):number{throw "UNBOUND";}'),dependencies:new Map<string,string>()},{id:"app",module:parse('import {identity} from "identity";export function run():number{return identity(undefined);}'),dependencies:identityDependencies}],entry:"app",exports:["run"],runtimes:[{module:"identity",namespace:"identity"}],recordBindings:[{module:"identity",name:"identity",operation:"identity"}]});if(!identityCode.ok||identityCode.value.native.records.length===0)return 67;
 const canonical=canonicalizeManagedSurfaceTypes(surface.value);if(!canonical.ok)return 68;
 const canonicalWire=serializeManagedSurfaceTypes(canonical.value);if(!canonicalWire.ok)return 69;
 const renamedSurface=reifyManagedSurfaceTypes(checked.value,[{name:"add",local:"add"},{name:"keep",local:"keep"},{name:"list",local:"list"}],"$Renamed",[{name:"Link",local:"Link"}]);if(!renamedSurface.ok)return 70;
 const renamedCanonical=canonicalizeManagedSurfaceTypes(renamedSurface.value);if(!renamedCanonical.ok)return 71;
 const renamedWire=serializeManagedSurfaceTypes(renamedCanonical.value);if(!renamedWire.ok||renamedWire.value.declarations!==canonicalWire.value.declarations||canonicalWire.value.entries[0]?.local!=="$helper0")return 72;
 const surfaceContracts=planManagedSurfaceContracts(surface.value);if(!surfaceContracts.ok||surfaceContracts.value.signatures.length<2||surfaceContracts.value.records.length<2)return 73;
 if(reflectors.value.recordIdentities.length!==reflectors.value.recordDescriptors.length)return 74;
 const physical=deriveManagedSurfacePhysicalFacts(canonical.value,{modules:[{id:"sparse-layout",module:parse(${sparseListSource}),dependencies:new Map<string,string>()}],runtimes:[{module:"sparse-layout",namespace:"sparse-list"}],globals:["undefined","Number"]});if(!physical.ok||physical.value.records.length<2||physical.value.signatures.length!==3)return 75;
 const directory=createManagedSurfaceDirectory(${JSON.stringify(referenceName)},canonical.value,physical.value);if(!directory.ok)return 76;
 if(!verifyManagedSurfacePhysicalAgreement(directory.value.directory,physical.value).ok)return 93;
 const layoutSkew={...physical.value,records:physical.value.records.map(record=>({...record,layout:{...record.layout,byteLength:record.layout.byteLength+16}}))};if(verifyManagedSurfacePhysicalAgreement(directory.value.directory,layoutSkew).ok)return 94;
 const abiSkew={...physical.value,signatures:physical.value.signatures.map(signature=>({...signature,parameters:signature.parameters.slice(1)}))};if(verifyManagedSurfacePhysicalAgreement(directory.value.directory,abiSkew).ok)return 95;
 const known=():number=>42;const exportedFunctions:unknown[]=[];for(let i=0;i<directory.value.directory.types.entries.length+directory.value.witnesses.length;i++)exportedFunctions.push(known);
 const exportedRecords=new Float64Array(directory.value.directory.records.length);for(let i=0;i<exportedRecords.length;i++)exportedRecords[i]=0x4000+i*1024;
 let runtimeSlots=0;for(const provider of directory.value.directory.runtimes){if(provider===undefined)return 111;runtimeSlots+=provider.operations.length;}
 const exportedEntries=new Float64Array(runtimeSlots*2);for(let i=0;i<runtimeSlots;i++){exportedEntries[i*2]=0x8000+i*4;exportedEntries[i*2+1]=0x10000+i*8;}
 const exported={directory:directory.value.directory,table:undefined,functions:exportedFunctions,records:exportedRecords,entries:exportedEntries};
 const read=readManagedSurfaceDirectory(exported,${JSON.stringify(referenceName)},{domain:():number=>17,descriptor:(value:unknown):number=>0x1000,signature:(value:unknown):number=>0x2000});if(!read.ok||read.value.domain!==17||read.value.records.length!==exportedRecords.length)return 96;
 const directoryBytes=encodeManagedSurfaceDirectory(directory.value.directory);if(!directoryBytes.ok||directoryBytes.value.length!==${referenceEncoding.value.length})return 78;
 if(directory.value.directory.digest!==${JSON.stringify(referenceDirectory.value.directory.digest)})return 77;
 const keptModule=generated("let count=40;function helper():number{return 2;}function run():number{return count+helper();}",false);
 const keptBound=bindModule(keptModule);if(!keptBound.ok)return 79;
 const kept=prepareModuleInstance(keptModule,keptBound.value,[{name:"run",local:"run"}],["helper"]);if(!kept.ok||!checkClosureModule(kept.value.module).ok)return 80;
 const captureModule=generated("let count=40;function helper():()=>number{return ()=>count;}function run():number{return 42;}",true),captureBound=bindModule(captureModule);if(!captureBound.ok)return 81;
 if(prepareModuleInstance(captureModule,captureBound.value,[{name:"run",local:"run"}],["helper"]).ok)return 82;
 const demands=resolveManagedSurfaceSelections(linked.value,bound.value,[{module:"helpers",name:"identity",typeArguments:[{kind:"keyword",name:"number"}]},{module:"helpers",name:"retain",typeArguments:[{kind:"keyword",name:"string"}]}],[]);if(!demands.ok)return 83;
 const demandSpecialized=specializeModule(linked.value.module,bound.value,{roots:demands.value.roots});if(!demandSpecialized.ok)return 84;
 const demandTable=prepareManagedSurfaceTable(demandSpecialized.value.module,demands.value,demandSpecialized.value.roots,"$DemandSurface","$DemandTable");if(!demandTable.ok)return 85;
 const anchors=createManagedSurfaceAnchors(linked.value.module,demands.value,demandTable.value.surface,"$Demand");if(!anchors.ok)return 86;
 const anchorBound=bindModule(anchors.value.module);if(!anchorBound.ok)return 87;
 const anchored=specializeModule(anchors.value.module,anchorBound.value);if(!anchored.ok||anchored.value.specializations.length!==2)return 88;
 const anchorValues=resolveManagedSurfaceAnchors(anchored.value.module,anchors.value.entries);if(!anchorValues.ok||anchorValues.value.length!==2)return 89;
 const finalTable=materializeManagedSurfaceTable(anchored.value.module,anchors.value.entries,demandTable.value.surface,"$FinalTable");if(!finalTable.ok||!checkClosureModule(finalTable.value.module).ok)return 90;
 for(const demand of anchors.value.entries){if(demand===undefined)throw "demand invariant";const name=demand.anchor;if(name!==undefined&&finalTable.value.module.statements.some(statement=>statement!==undefined&&statement.kind==="function"&&statement.name===name))return 91;}
 if(materializeManagedSurfaceTable(anchored.value.module,anchors.value.entries,demandTable.value.surface,"$Demand_anchor_0").ok)return 92;
 const arrowChecked=checkClosureModule(parse("export function outer():(value:number)=>number{return (value:number):number=>value;}"));if(!arrowChecked.ok)return 57;
 const arrowGraph=arrowChecked.value,arrow=arrowGraph.bindings.functions.find(fn=>fn!==undefined&&fn.parent!==undefined);if(arrow===undefined)return 58;
 let arrowType:number|undefined=undefined;arrowGraph.expressions.forEach((type,expression)=>{if(expression===arrow.node)arrowType=type;});if(arrowType===undefined)return 59;
 const arrowGroups=planManagedSignatureGroups(arrowGraph,[{name:"arrow",contract:"test.arrow.v1",type:arrowType,functions:[arrow.id]}]);if(!arrowGroups.ok)return 60;
 return 42;
}`,
  hostFrameOnly ? "managed-host-frame-compiler" : "managed-surface-types",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["binding", "packages/typescript/src/binding/index.ts"],
    ["modules", "packages/ts-native/src/modules/index.ts"],
    ["reify", "packages/typescript/src/reify/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
    ["emitter", "packages/codegen/src/aarch64/scalar/index.ts"],
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
