import { verifyHostedFixture } from "./hosted-fixture.ts";
const memory = "packages/native-runtime/src/intrinsics/memory.ts";
verifyHostedFixture(
  `
import {createSourceTextView} from "source";
import {parseModule} from "syntax";
import {checkClosureModule} from "checker";
import {lowerModuleEntries} from "lowering";
import type {TargetDataLayout} from "layout";
import {emitModule} from "emitter";
import {resolveManagedPointers,type ManagedIdentityBinding} from "compiler";
import {nativeSignatureVersion,nativeSignatureHeaderByteLength,nativeSignatureVersionOffset,nativeSignatureByteLengthOffset,nativeSignatureParameterCountOffset,nativeSignatureResultOffset,nativeSignatureNumberCode,nativeSignatureParameterByteLength} from "abi";
import {mapExecutableMemory,writeExecutableMemory,callExecutableNumber,readMemoryWord,unmapMemory,currentContextDomain} from "memory";
export function run():number {
 const parsed=parseModule(createSourceTextView('function first():number{return 42;}function second():number{return 43;}function entryFirst():number{throw "UNBOUND";}function entrySecond():number{throw "UNBOUND";}function signatureFirst():number{throw "UNBOUND";}function signatureSecond():number{throw "UNBOUND";}function thrower():number{throw 43;}function entryThrower():number{throw "UNBOUND";}function increment(value:number):number{return value+1;}function entryIncrement():number{throw "UNBOUND";}function signatureIncrement():number{throw "UNBOUND";}'));if(!parsed.ok)return 1;
 const checked=checkClosureModule(parsed.value);if(!checked.ok)return 2;
 const target:TargetDataLayout={pointerSize:8,wordSize:8,allocationAlignment:16,frameAlignment:16,maxAlignment:16};
 const lowered=lowerModuleEntries(checked.value,[0,1,2,3,4,5,6,7,8,9,10],target,4096,{functionAddressBindings:[{function:2,target:0,part:"entry"},{function:3,target:1,part:"entry"},{function:4,target:0,part:"signature"},{function:5,target:1,part:"signature"},{function:7,target:6,part:"entry"},{function:9,target:8,part:"entry"},{function:10,target:8,part:"signature"}]});if(!lowered.ok)return 3;
 const emitted=emitModule(lowered.value.module,{closedRoots:[2,3,4,5,7,9,10]});if(!emitted.ok)return 4;
 const native=emitted.value;
 if(native.linkage!=="local"||native.functionDescriptor!==undefined||native.signatures.length!==2||native.functions.length!==11)return 5;
 const first=native.functions[0],second=native.functions[1],entryFirst=native.functions[2],entrySecond=native.functions[3],signatureFirst=native.functions[4],signatureSecond=native.functions[5],signature=native.signatures[0],entryThrower=native.functions[7];
 if(first===undefined||second===undefined||entryFirst===undefined||entrySecond===undefined||signatureFirst===undefined||signatureSecond===undefined||signature===undefined||entryThrower===undefined)return 6;
 const capacity=65536;if(native.code.length>capacity)return 7;
 const arena=mapExecutableMemory(capacity);if(arena<=0)return 8;
 try {
  if(writeExecutableMemory(arena,capacity,0,native.code)!==0)return 9;
  const a=callExecutableNumber(arena+entryFirst.offset),b=callExecutableNumber(arena+entrySecond.offset);
  if(a!==arena+first.offset||b!==arena+second.offset||a===b||a%4!==0||b%4!==0)return 10;
  // The returned addresses use the public result-buffer ABI, despite having no
  // direct callers in the generated module.
  if(callExecutableNumber(a)!==42||callExecutableNumber(b)!==43)return 11;
  const sa=callExecutableNumber(arena+signatureFirst.offset),sb=callExecutableNumber(arena+signatureSecond.offset);
  if(sa!==sb||sa!==arena+signature.offset||sa%8!==0)return 12;
  if(readMemoryWord(sa,nativeSignatureHeaderByteLength,nativeSignatureVersionOffset)!==nativeSignatureVersion||readMemoryWord(sa,nativeSignatureHeaderByteLength,nativeSignatureByteLengthOffset)!==nativeSignatureHeaderByteLength||readMemoryWord(sa,nativeSignatureHeaderByteLength,nativeSignatureParameterCountOffset)!==0||readMemoryWord(sa,nativeSignatureHeaderByteLength,nativeSignatureResultOffset)!==nativeSignatureNumberCode)return 13;
  const consumerParsed=parseModule(createSourceTextView('function borrowed():number{throw "UNBOUND";}export function invoke():number{try{return borrowed();}catch(error){return 43;}}'));if(!consumerParsed.ok)return 14;
  const consumerChecked=checkClosureModule(consumerParsed.value);if(!consumerChecked.ok)return 15;
  const consumerLowered=lowerModuleEntries(consumerChecked.value,[1],target,4096,{importedFunctions:[0]});if(!consumerLowered.ok)return 16;
  // Lowering keeps the requested local entry first, followed by its import.
  const consumerEmitted=emitModule(consumerLowered.value.module,{closedRoots:[0],managedABI:{version:1,signatures:[],functions:[{function:1,name:"borrowed",contract:"fixture.borrowed.v1",parameters:[],returnType:"number"}]}});if(!consumerEmitted.ok)return 17;
  const consumer=consumerEmitted.value,entry=consumer.functions[0];if(entry===undefined||entry.import===true)return 18;
  const domain=currentContextDomain();
  const binding:ManagedIdentityBinding={name:"borrowed",contract:"fixture.borrowed.v1",role:"function-entry",domain,address:sa,byteLength:nativeSignatureHeaderByteLength,entry:a,parameters:[],returnType:"number"};
  const reads={count:0};
  const denied=resolveManagedPointers(consumer,[{...binding,domain:domain+1}],(address:number,byteLength:number,offset:number):number=>{reads.count++;return readMemoryWord(address,byteLength,offset);},domain);
  if(denied.ok||reads.count!==0)return 19;
  const linked=resolveManagedPointers(consumer,[binding],(address:number,byteLength:number,offset:number):number=>{reads.count++;return readMemoryWord(address,byteLength,offset);},domain);
  if(!linked.ok||reads.count!==4)return 20;
  const consumerOffset=Math.ceil(native.code.length/16)*16;
  if(consumerOffset+linked.value.code.length>capacity||writeExecutableMemory(arena,capacity,consumerOffset,linked.value.code)!==0)return 21;
  if(callExecutableNumber(arena+consumerOffset+entry.offset)!==42)return 22;
  const throwing=callExecutableNumber(arena+entryThrower.offset);
  const linkedThrower=resolveManagedPointers(consumer,[{...binding,entry:throwing}],(address:number,byteLength:number,offset:number):number=>readMemoryWord(address,byteLength,offset),domain);
  if(!linkedThrower.ok)return 23;
  const throwingOffset=Math.ceil((consumerOffset+linked.value.code.length)/16)*16;
  if(throwingOffset+linkedThrower.value.code.length>capacity||writeExecutableMemory(arena,capacity,throwingOffset,linkedThrower.value.code)!==0)return 24;
  if(callExecutableNumber(arena+throwingOffset+entry.offset)!==43)return 25;
  const incrementGetter=native.functions[9],incrementSignatureGetter=native.functions[10];if(incrementGetter===undefined||incrementSignatureGetter===undefined)return 26;
  const argumentParsed=parseModule(createSourceTextView('function borrowed(value:number):number{throw "UNBOUND";}export function invoke():number{return borrowed(41);}'));if(!argumentParsed.ok)return 27;
  const argumentChecked=checkClosureModule(argumentParsed.value);if(!argumentChecked.ok)return 28;
  const argumentLowered=lowerModuleEntries(argumentChecked.value,[1],target,4096,{importedFunctions:[0]});if(!argumentLowered.ok)return 29;
  const argumentEmitted=emitModule(argumentLowered.value.module,{closedRoots:[0],managedABI:{version:1,signatures:[],functions:[{function:1,name:"increment",contract:"fixture.increment.v1",parameters:["number"],returnType:"number"}]}});if(!argumentEmitted.ok)return 30;
  const argumentEntry=argumentEmitted.value.functions[0];if(argumentEntry===undefined)return 31;
  const argumentBinding:ManagedIdentityBinding={name:"increment",contract:"fixture.increment.v1",role:"function-entry",domain,address:callExecutableNumber(arena+incrementSignatureGetter.offset),byteLength:nativeSignatureHeaderByteLength+nativeSignatureParameterByteLength,entry:callExecutableNumber(arena+incrementGetter.offset),parameters:["number"],returnType:"number"};
  const argumentLinked=resolveManagedPointers(argumentEmitted.value,[argumentBinding],(address:number,byteLength:number,offset:number):number=>readMemoryWord(address,byteLength,offset),domain);if(!argumentLinked.ok)return 32;
  const argumentOffset=Math.ceil((throwingOffset+linkedThrower.value.code.length)/16)*16;
  if(argumentOffset+argumentLinked.value.code.length>capacity||writeExecutableMemory(arena,capacity,argumentOffset,argumentLinked.value.code)!==0)return 33;
  if(callExecutableNumber(arena+argumentOffset+argumentEntry.offset)!==42)return 34;
  return 42;
 } finally {if(unmapMemory(arena,capacity)!==0)throw "UNMAP";}
}
`,
  "function-addresses",
  [
    ["source", "packages/source/src/text.ts"],
    ["syntax", "packages/typescript/src/syntax/index.ts"],
    ["checker", "packages/typescript/src/checker/index.ts"],
    ["lowering", "packages/ts-native/src/closure/lowering/index.ts"],
    ["layout", "packages/ts-native/src/closure/layout.ts"],
    ["emitter", "packages/codegen/src/aarch64/scalar/index.ts"],
    ["compiler", "packages/compiler/src/native/index.ts"],
    ["abi", "packages/abi/src/function.ts"],
    ["memory", memory],
  ],
  [],
  [],
  [{ module: memory, namespace: "function-address-memory" }],
  {
    allowJit: true,
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 67108864,
    allocationCapacity: 1048576,
    rootCapacity: 16384,
    stackBytes: 16777216,
    hostBindings: [
      {
        module: memory,
        name: "mapExecutableMemory",
        operation: "executable-map",
      },
      {
        module: memory,
        name: "writeExecutableMemory",
        operation: "executable-write",
      },
      {
        module: memory,
        name: "callExecutableNumber",
        operation: "executable-call-number",
      },
      { module: memory, name: "readMemoryWord", operation: "memory-read-word" },
      { module: memory, name: "unmapMemory", operation: "memory-unmap" },
      {
        module: memory,
        name: "currentContextDomain",
        operation: "context-domain",
      },
    ],
  },
);
