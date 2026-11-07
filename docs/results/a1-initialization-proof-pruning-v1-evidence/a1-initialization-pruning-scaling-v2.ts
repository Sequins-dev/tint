import {workspaceSources,workspaceSourceIdentity} from '../tools/workspace-sources.ts';import fs from'node:fs';import assert from'node:assert/strict';import{pathToFileURL}from'node:url';import{performance}from'node:perf_hooks';import type{FunctionIR,Block}from'../packages/ir/src/scalar/model.ts';const span={start:0,end:0};
function diamonds(count: number): FunctionIR {
  const blocks: Block[] = [];
  for (let i = 0; i <= count; i++) {
    const instructions: Block["instructions"][number][] = [
      { kind: "load", id: i * 4, slot: 0, ...span },
    ];
    if (i > 0)
      instructions.push({ kind: "load", id: i * 4 + 1, slot: i, ...span });
    blocks.push({
      id: i * 3,
      instructions,
      terminator:
        i === count
          ? { kind: "return", value: undefined, ...span }
          : {
              kind: "branch",
              condition: i * 4,
              consequent: i * 3 + 1,
              alternate: i * 3 + 2,
              ...span,
            },
    });
    if (i === count) break;
    for (let arm = 1; arm <= 2; arm++)
      blocks.push({
        id: i * 3 + arm,
        instructions: [
          { kind: "constant", id: i * 4 + arm + 1, value: 42, ...span },
          { kind: "store", slot: i + 1, value: i * 4 + arm + 1, ...span },
        ],
        terminator: { kind: "jump", target: i * 3 + 3, ...span },
      });
  }
  return {
    id: 0,
    name: "diamonds",
    exported: true,
    parameters: [0],
    slots: [
      "boolean",
      ...Array.from({ length: count }, () => "number" as const),
    ],
    returnType: "void",
    entry: 0,
    blocks,
  };
}
const metadata=JSON.parse(fs.readFileSync('docs/results/frozen-node-toolchain-a1-phase1-v16-language-identifiers-remaining-large34-v1-heartbeat-v1.json','utf8')),before=await import(pathToFileURL(metadata.toolchain.directory+'/packages/ir/dist/scalar/index.js').href),beforeSlots=await import(pathToFileURL(metadata.toolchain.directory+'/packages/ir/dist/scalar/initialization-slots.js').href),after=await import('../packages/ir/dist/scalar/index.js'),afterSlots=await import('../packages/ir/dist/scalar/initialization-slots.js');const rows=[];
for(const count of[64,128,256,512,1024])for(const[label,api,slots]of[['before',before,beforeSlots],['after',after,afterSlots]]as const){const fn=diamonds(count),original=globalThis.Uint32Array;let allocatedBytes=0,largestBytes=0;globalThis.Uint32Array=new Proxy(original,{construct(target,args){const a=Reflect.construct(target,args);allocatedBytes+=a.byteLength;largestBytes=Math.max(largestBytes,a.byteLength);return a;}});const started=performance.now();let result;try{result=api.verify({functions:[fn]});}finally{globalThis.Uint32Array=original;}assert(result.ok);const row={label,branches:count,blocks:fn.blocks.length,slots:fn.slots.length,trackedSlots:slots.initializationSlots(fn).count,allocatedUint32Bytes:allocatedBytes,largestUint32Bytes:largestBytes,elapsedMs:performance.now()-started};rows.push(row);console.log(JSON.stringify(row));}
fs.writeFileSync('.tint-bootstrap/a1-initialization-pruning-scaling-v2.json',JSON.stringify({kind:'initialization-proof-pruning-scaling',beforeSource:metadata.sourceSnapshot,afterSource:workspaceSourceIdentity(workspaceSources()),rows,scope:'Matched verified IR graphs; typed-array allocation interception in isolated Node host. Counts describe verifier memory, not generated native program throughput.'},null,2)+'\n',{flag:'wx'});
