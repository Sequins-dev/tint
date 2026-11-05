import assert from "node:assert/strict";
import { createSourceText } from "@tint/source/text";
import { parseModule } from "@tint/typescript/syntax";
import { verify, type ModuleIR } from "@tint/ir/scalar";
import { verifyHostedFixture } from "./hosted-fixture.ts";
const memory = "packages/native-runtime/src/intrinsics/memory.ts",
  compiler = "packages/compiler/src/native/index.ts",
  emitter = "packages/codegen/src/aarch64/scalar/index.ts",
  ir = "packages/ir/src/scalar/index.ts",
  syntax = "packages/typescript/src/syntax/index.ts",
  textSource = "packages/source/src/text.ts";
const input: ModuleIR = {
  records: [
    {
      byteLength: 48,
      fields: [
        {
          offset: 16,
          type: "reference",
          mutable: false,
        },
        {
          offset: 24,
          type: "reference",
          mutable: false,
        },
        {
          offset: 32,
          type: "general",
          mutable: false,
        },
      ],
    },
  ],
  functions: [
    {
      id: 0,
      name: "entry",
      exported: true,
      parameters: [0],
      slots: ["reference", "reference", "reference", "general"],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            {
              kind: "load",
              id: 0,
              slot: 0,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "record",
            object: 0,
            record: 0,
            field: 0,
            operation: "read",
            slot: 1,
            consequent: 1,
            alternate: 3,
            start: 0,
            end: 0,
          },
        },
        {
          id: 1,
          instructions: [
            {
              kind: "load",
              id: 1,
              slot: 0,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "record",
            object: 1,
            record: 0,
            field: 1,
            operation: "read",
            slot: 2,
            consequent: 2,
            alternate: 3,
            start: 0,
            end: 0,
          },
        },
        {
          id: 2,
          instructions: [
            {
              kind: "load",
              id: 2,
              slot: 1,
              start: 0,
              end: 0,
            },
            {
              kind: "call-indirect",
              id: 3,
              target: 1,
              callee: 2,
              arguments: [],
              start: 0,
              end: 0,
            },
            {
              kind: "store",
              slot: 3,
              value: 3,
              start: 0,
              end: 0,
            },
            {
              kind: "load",
              id: 4,
              slot: 2,
              start: 0,
              end: 0,
            },
            {
              kind: "call-indirect",
              id: 5,
              target: 2,
              callee: 4,
              arguments: [],
              start: 0,
              end: 0,
            },
            {
              kind: "load",
              id: 6,
              slot: 3,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "return",
            value: 6,
            start: 0,
            end: 0,
          },
        },
        {
          id: 3,
          instructions: [],
          terminator: {
            kind: "throw-literal",
            value: "MANAGED_FRAME_LAYOUT",
            start: 0,
            end: 0,
          },
        },
      ],
    },
    {
      id: 1,
      name: "helper1",
      exported: false,
      parameters: [],
      slots: [],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            {
              kind: "general-none",
              id: 0,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "return",
            value: 0,
            start: 0,
            end: 0,
          },
        },
      ],
    },
    {
      id: 2,
      name: "helper2",
      exported: false,
      parameters: [],
      slots: [],
      returnType: "general",
      entry: 0,
      blocks: [
        {
          id: 0,
          instructions: [
            {
              kind: "general-none",
              id: 0,
              start: 0,
              end: 0,
            },
          ],
          terminator: {
            kind: "return",
            value: 0,
            start: 0,
            end: 0,
          },
        },
      ],
    },
  ],
};
const memberOnlyMode = process.argv.includes("--member-only-callback");
const callbackMode =
    memberOnlyMode || process.argv.includes("--local-callback"),
  sourceMode = process.argv.includes("--source-entry"),
  rejectMode = process.argv.includes("--reject");
if (Number(callbackMode) + Number(sourceMode) + Number(rejectMode) > 1)
  throw new Error("Select one managed-frame fixture mode");
const typedEntrySource =
  "interface Frame{readonly first:()=>unknown;readonly second:()=>unknown;readonly input:unknown} function unrelated():number{const nested=():number=>19;return nested();} export function entry(frame:Frame):unknown{const value=frame.first();frame.second();return value;}";
const signatureRequests = [
  {
    witness: 1,
    name: "first",
    contract: "tint.test.frame-first.v1",
    parameters: [],
    returnType: "general",
    ...(callbackMode && !memberOnlyMode ? { localFunctions: [3] } : {}),
  },
  ...(sourceMode
    ? []
    : [
        {
          witness: 2,
          name: "second",
          contract: "tint.test.frame-second.v1",
          parameters: callbackMode ? ["reference"] : [],
          returnType: "general",
        },
      ]),
  ...(memberOnlyMode
    ? [
        {
          name: "callback",
          contract: "tint.test.frame-callback.v1",
          parameters: [],
          returnType: "general",
          localFunctions: [3],
        },
      ]
    : []),
];
const callbackBody = {
  id: 3,
  name: "localCallback",
  exported: false,
  parameters: [],
  slots: [],
  returnType: "general" as const,
  entry: 0,
  blocks: [
    {
      id: 0,
      instructions: [
        { kind: "constant" as const, id: 0, value: 42, start: 0, end: 0 },
        { kind: "general-wrap" as const, id: 1, value: 0, start: 0, end: 0 },
      ],
      terminator: { kind: "return" as const, value: 1, start: 0, end: 0 },
    },
  ],
};
const moduleInput: ModuleIR = callbackMode
  ? {
      ...input,
      functions: [
        ...input.functions.map((fn) =>
          fn.id === 0
            ? {
                ...fn,
                blocks: fn.blocks.map((block) =>
                  block.id === 2
                    ? {
                        ...block,
                        instructions: block.instructions.flatMap((op) =>
                          op.kind === "call-indirect" && op.target === 2
                            ? [
                                {
                                  kind: "function-new" as const,
                                  id: 7,
                                  target: 3,
                                  start: 0,
                                  end: 0,
                                },
                                { ...op, arguments: [7] },
                              ]
                            : [op],
                        ),
                      }
                    : block,
                ),
              }
            : fn.id === 2
              ? { ...fn, parameters: [0], slots: ["reference" as const] }
              : fn,
        ),
        callbackBody,
      ],
    }
  : input;
assert.deepEqual(verify(moduleInput), { ok: true });
const frameSource = `export interface Frame {readonly first:()=>unknown;readonly second:${callbackMode ? "(callback:()=>unknown)=>unknown" : "()=>unknown"};readonly input:unknown}
export function describe(value:unknown,witness:Frame):number{throw "UNBOUND_FRAME_DESCRIPTOR";}
export function invoke(address:number,frame:Frame):unknown{throw "UNBOUND_FRAME_CALL";}
export function signature(callback:(callback:()=>unknown)=>unknown):number{throw "UNBOUND_FRAME_SIGNATURE";}`;
const bytes = new TextEncoder().encode(frameSource),
  source = createSourceText(bytes, bytes.length);
assert.ok(source.ok);
const parsed = parseModule(source.value);
assert.ok(parsed.ok);
const text = `import {nativeFunctionDescriptor,nativeFunctionSignature,readMemoryWord,mapExecutableMemory,writeExecutableMemory,registerExternalMemory,currentRootHead,currentContextDomain} from "memory";
import {resolveManagedPointers,prepareNativeFunctionEntry,type ManagedIdentityBinding} from "compiler";
import {parseModule} from "syntax";
import {createSourceTextView} from "source-text";
import {emitModule} from "emitter";
import type {ModuleIR} from "ir";
import {describe,invoke,signature,type Frame} from "frame-runtime";
function read(address:number,length:number,offset:number):number{return readMemoryWord(address,length,offset);}
function churn():void{for(let i=0;i<640;i++){const garbage=new Uint32Array(8192);garbage[0]=i;if(garbage[0]!==i)throw "ALLOCATION";}}
export function run():number {
 const domain=currentContextDomain();if(!Number.isSafeInteger(domain)||domain<=0)return 80;
 let order=0;
 ${callbackMode ? "let saved:(()=>unknown)|undefined=undefined;" : ""}
 const captured={value:42};
 const first=():unknown=>{churn();order=order*10+1;return captured;};
 const second=${callbackMode ? "(callback:()=>unknown):unknown=>" : "():unknown=>"}{churn();order=order*10+2;${callbackMode ? 'saved=callback;if(callback()!==42)throw "LOCAL_CALLBACK";' : ""}return undefined;};
 const frame:Frame={first,second,input:42};
 const frameAddress=describe(frame,frame),brand=nativeFunctionDescriptor(first),firstSignature=nativeFunctionSignature(first),secondSignature=${callbackMode ? "signature(second)" : "nativeFunctionSignature(second)"};
 if(frameAddress<=0||brand<=0||firstSignature<=0||secondSignature<=0)return 1;
 ${sourceMode ? `const parsedEntry=parseModule(createSourceTextView(${JSON.stringify(typedEntrySource)}));if(!parsedEntry.ok)return 18;const preparedEntry=prepareNativeFunctionEntry(parsedEntry.value,"entry");if(!preparedEntry.ok)return 19;const module=preparedEntry.value.module,entryId=preparedEntry.value.entryId;if(module.records?.length!==1||module.functions.length!==2||firstSignature!==secondSignature)return 20;` : `const module:ModuleIR=${JSON.stringify(moduleInput)},entryId=0;`}
 const emitted=emitModule(module,{managedABI:{version:1,functionBrand:{name:"brand",contract:"tint.function.v1"},signatures:${JSON.stringify(signatureRequests)},records:[{witness:0,name:"frame",contract:"${callbackMode ? "tint.test.callback-frame.v1" : "tint.test.two-helper-frame.v1"}"}]}});
 if(!emitted.ok)return 2;
 const bindings:readonly ManagedIdentityBinding[]=[
 {domain,role:"function-brand",name:"brand",contract:"tint.function.v1",address:brand,byteLength:32,parameters:[],returnType:undefined},
 {domain,role:"signature",name:"first",contract:"tint.test.frame-first.v1",address:firstSignature,byteLength:32,parameters:[],returnType:"general"},
 ${sourceMode ? "" : `{domain,role:"signature",name:"second",contract:"tint.test.frame-second.v1",address:secondSignature,byteLength:${callbackMode ? 40 : 32},parameters:${callbackMode ? '["reference"]' : "[]"},returnType:"general"},`}
 ${memberOnlyMode ? `{domain,role:"signature",name:"callback",contract:"tint.test.frame-callback.v1",address:firstSignature,byteLength:32,parameters:[],returnType:"general"},` : ""}
 {domain,role:"record",name:"frame",contract:"${callbackMode ? "tint.test.callback-frame.v1" : "tint.test.two-helper-frame.v1"}",address:frameAddress,byteLength:48,parameters:[],returnType:undefined,recordLayout:${JSON.stringify(input.records?.[0])}}];
 const native=emitted.value;
 ${
   rejectMode
     ? `for(let testCase=0;testCase<5;testCase++){
  const denied:ManagedIdentityBinding[]=[];
  for(let i=0;i<bindings.length;i++){
   const binding=bindings[i];if(binding===undefined)throw "BINDING";
   if(i!==bindings.length-1)denied.push(binding);
   else if(testCase===0)denied.push({...binding,contract:"tint.test.frame.wrong-version"});
   else if(testCase===1)denied.push({...binding,returnType:"general"});
   else if(testCase===2)denied.push({...binding,byteLength:binding.byteLength+8});
   else if(testCase===4)denied.push({...binding,domain:domain+1});
   else denied.push({...binding,recordLayout:{byteLength:48,fields:[{offset:16,type:"reference",mutable:true},{offset:24,type:"reference",mutable:false},{offset:32,type:"general",mutable:false}]}});
  }
  let reads=0;
  const rejected=resolveManagedPointers(native,denied,(address:number,length:number,offset:number):number=>{reads++;return read(address,length,offset);},domain);
  if(rejected.ok||reads!==0||order!==0)return 70+testCase;
 }`
     : ""
 }
 const linked=resolveManagedPointers(native,bindings,read,domain);if(!linked.ok)return 3;
 const arenaBytes=65536,arena=mapExecutableMemory(arenaBytes);
 if(arena<=0||registerExternalMemory(arena,arenaBytes)!==0)return 4;
 if(writeExecutableMemory(arena,arenaBytes,0,linked.value.code)!==0)return 5;
 const entry=native.functions.find(fn=>fn!==undefined&&fn.id===entryId);if(entry===undefined)throw "ENTRY";
 const address=arena+entry.offset,head=currentRootHead();
 const returned=invoke(address,frame);
 if(returned!==captured||order!==12||currentRootHead()!==head)return 6;
 churn();if(returned!==captured||describe(frame,frame)!==frameAddress)return 7;
 ${callbackMode ? "const savedCallback=saved;if(savedCallback===undefined||savedCallback()!==42)return 14;" : ""}
 let freshValue:unknown=undefined;
 const freshFirst=():unknown=>{churn();const object={value:43};freshValue=object;return object;};
 const freshFrame:Frame={first:freshFirst,second,input:0};
 const fresh=invoke(address,freshFrame);churn();if(fresh!==freshValue||currentRootHead()!==head)return 8;
 let produced:(()=>unknown)|undefined=undefined;
 const closureFirst=():unknown=>{churn();const value={value:44};const closure=():unknown=>value;produced=closure;return closure;};
 const closureFrame:Frame={first:closureFirst,second,input:0};
 const closure=invoke(address,closureFrame);churn();if(closure!==produced||currentRootHead()!==head)return 9;
 const called=produced;if(called===undefined||called()===undefined)return 10;
 const marker={value:45},throwing=():unknown=>{churn();throw marker;};
 const throwFirst:Frame={first:throwing,second,input:0};
 order=0;let caught:unknown=undefined;try{invoke(address,throwFirst);}catch(error){caught=error;}
 if(caught!==marker||order!==0||currentRootHead()!==head)return 11;
 ${callbackMode ? "const throwingSecond=(callback:()=>unknown):unknown=>{churn();throw marker;};" : ""}
 const throwSecond:Frame={first,second:${callbackMode ? "throwingSecond" : "throwing"},input:0};
 caught=undefined;try{invoke(address,throwSecond);}catch(error){caught=error;}
 if(caught!==marker||order!==1||currentRootHead()!==head)return 12;
 const nested=():unknown=>invoke(address,frame),nestedFrame:Frame={first:nested,second,input:0};
 if(invoke(address,nestedFrame)!==captured||currentRootHead()!==head)return 13;
 if(currentContextDomain()!==domain)return 81;
 return 42;
}`;
verifyHostedFixture(
  text,
  rejectMode
    ? "managed-frame-reject"
    : sourceMode
      ? "managed-frame-source"
      : memberOnlyMode
        ? "managed-frame-member-callback"
        : callbackMode
          ? "managed-frame-callback"
          : "managed-frame",
  [
    ["memory", memory],
    ["compiler", compiler],
    ["emitter", emitter],
    ["ir", ir],
    ["syntax", syntax],
    ["source-text", textSource],
    ["frame-runtime", "frame-runtime"],
  ],
  [{ id: "frame-runtime", module: parsed.value, dependencies: new Map() }],
  [{ module: "frame-runtime", name: "describe", operation: "descriptor" }],
  [
    { module: memory, namespace: "native-memory" },
    { module: "frame-runtime", namespace: "managed-frame-test" },
  ],
  {
    allowJit: true,
    runtimeEntry: "initializeCopyingRuntime",
    managedBytes: 16777216,
    allocationCapacity: 262144,
    hostBindings: [
      {
        module: "frame-runtime",
        name: "signature",
        operation: "native-function-signature",
      },
      {
        module: memory,
        name: "nativeFunctionDescriptor",
        operation: "native-function-descriptor",
      },
      {
        module: memory,
        name: "nativeFunctionSignature",
        operation: "native-function-signature",
      },
      { module: memory, name: "readMemoryWord", operation: "memory-read-word" },
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
        name: "registerExternalMemory",
        operation: "external-memory-register",
      },
      { module: memory, name: "currentRootHead", operation: "root-head" },
      {
        module: memory,
        name: "currentContextDomain",
        operation: "context-domain",
      },
      {
        module: "frame-runtime",
        name: "invoke",
        operation: "executable-call-managed",
      },
    ],
  },
);
