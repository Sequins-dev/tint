import {readWorkspaceSourceSnapshot,workspaceModules} from '../../.tint-bootstrap/cluster-j-toolchain-v5/tools/workspace-sources.ts';
import {projectRoots,projectBuildRequest} from '../../.tint-bootstrap/cluster-j-toolchain-v5/packages/compiler/dist/cli.js';
import {compileArm64Program} from '../../.tint-bootstrap/cluster-j-toolchain-v5/packages/compiler/dist/native/index.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
console.log(new Date().toISOString(),'loading frozen v5 runtime graph');
const snapshot=readWorkspaceSourceSnapshot('.tint-bootstrap/cluster-j-toolchain-v5/source-snapshot.json');
const modules=workspaceModules(projectRoots(),snapshot),request=projectBuildRequest(modules,()=>{});
const operations=[['configureExternalMemory','external-memory-configure'],['configureGenerationalAllocation','generational-state'],['configureLinearAllocation','allocation-state'],['readMemoryWord','memory-read-word'],['currentRootHead','root-head'],['writeMemoryWord','memory-write-word'],['moveMemory','memory-move']];
console.log(new Date().toISOString(),'compiling copying runtime with source symbols',request.runtimeModule);
const result=compileArm64Program({optimization:'basic',debugSymbols:true,maxSpecializations:4096,modules,entry:request.runtimeModule,exports:['initializeCopyingRuntime'],start:'initializeCopyingRuntime',runtimes:[{module:request.memoryModule,namespace:'native-memory'}],hostBindings:operations.map(([name,operation])=>({module:request.memoryModule,name,operation}))});
if(!result.ok)throw Error(JSON.stringify(result));
const code=Buffer.from(result.value.native.code);
writeFileSync('.tint-bootstrap/j-copy-runtime-v5.bin',code,{flag:'wx'});
writeFileSync('.tint-bootstrap/j-copy-runtime-symbols-v5.json',JSON.stringify(result.value.symbols,null,2)+'\n',{flag:'wx'});
const matches=[];
for(const file of ['13-74968','19-45502']){
 const image=readFileSync('.tint-bootstrap/j-profiles-v5/'+file+'.image');
 for(const hotOffset of [0x12f364,0xf380c,0xd852c,0x2a910,0x291c4,0x24b08,0x23240]){
  let match;
  for(const size of [128,64,32,16]){
   const before=size/2,pattern=image.subarray(hotOffset-before,hotOffset+size-before);
   const offset=code.indexOf(pattern);
   if(offset<0||code.indexOf(pattern,offset+1)>=0)continue;
   const mapped=offset+before,fn=result.value.symbols.find(fn=>mapped>=fn.offset&&mapped<fn.offset+fn.byteLength);
   match={image:file,hotOffset:'0x'+hotOffset.toString(16),runtimeOffset:mapped,matchedBytes:size,matchedSha256:createHash('sha256').update(pattern).digest('hex'),function:fn};break;
  }
  matches.push(match??{image:file,hotOffset:'0x'+hotOffset.toString(16),unresolved:true});
 }
}
const report={kind:'cluster-j-copy-runtime-profile-symbolization',conformance:false,timestamp:new Date().toISOString(),sourceSnapshot:'eb810121f9ab6bf004b75f1f6903afa64e7c6c96bcd751f5d94a361acf737990',method:'Recompiled only the frozen copying runtime with debug symbols and identical runtime host bindings; matched unique instruction-byte windows from exact copied native images. This does not assign unsymbolized program caller frames.',codeSha256:createHash('sha256').update(code).digest('hex'),codeBytes:code.length,matches};
writeFileSync('docs/results/cluster-j-copy-runtime-profile-symbolization-v5.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
