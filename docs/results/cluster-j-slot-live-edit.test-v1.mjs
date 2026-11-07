import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
let original=readFileSync('.tint-bootstrap/j-slot-cap-reload-proposed.zsh','utf8');
original=original.replace('  # Refresh the coordinator cap while queued; running jobs keep their slot.\n  [ -f $root/max ] && max=$(cat $root/max)\n','');
original=original.replace('start=$(date +%s);','# A coordinator-set cap in $root/max overrides the caller-supplied max.\n[ -f $root/max ] && max=$(cat $root/max)\nstart=$(date +%s);');
const saved=JSON.parse(readFileSync('docs/results/cluster-j-slot-cap-reload-proposal-v1.json','utf8'));
assert.equal(createHash('sha256').update(original).digest('hex'),saved.originalWrapperSha256);
const updated=readFileSync('/Users/stephenbelanger/.t3/tint-slots/slot','utf8');
const results=[];
for(const atomic of [false,true]){
 const root=mkdtempSync(join(tmpdir(),'tint-j-slot-edit-')),script=join(root,'slot');
 const local=s=>s.replace('root=$HOME/.t3/tint-slots/$cls','root=$TINT_SLOT_TEST_ROOT/$cls');
 writeFileSync(script,local(original));mkdirSync(join(root,'runner'));writeFileSync(join(root,'runner','max'),'1\n');
 const child=spawn('/bin/zsh',[script,'runner','1','--','/bin/sleep','1'],{env:{...process.env,TINT_SLOT_TEST_ROOT:root},detached:true});let stderr='';child.stderr.on('data',x=>stderr+=x);const exited=new Promise(resolve=>child.on('close',code=>resolve(code)));
 try{
  const start=Date.now();while(!stderr.includes('[slot] acquired')){assert.ok(Date.now()-start<8000,'wrapper did not acquire isolated slot');await delay(20)}
  if(atomic){const next=join(root,'next');writeFileSync(next,local(updated));renameSync(next,script)}else writeFileSync(script,local(updated));
  const code=await Promise.race([exited,delay(6000).then(()=> 'timeout')]);assert.notEqual(code,'timeout');
  if(atomic)assert.equal(code,0,stderr);else{assert.equal(code,1,stderr);assert.match(stderr,/parse error near/)}
  results.push({atomicReplace:atomic,wrapperExit:code,stderr});console.log(atomic?'PASS: atomic replacement preserves running wrapper':'REPRODUCED: in-place rewrite causes post-command wrapper parse error');
 }finally{if(child.exitCode===null){try{process.kill(-child.pid,'SIGTERM')}catch{}}await exited;rmSync(root,{recursive:true,force:true})}
}
writeFileSync('.tint-bootstrap/j-slot-live-edit-test-v1.json',JSON.stringify({at:new Date().toISOString(),sharedWrapperModified:false,originalWrapperSha256:saved.originalWrapperSha256,updatedWrapperSha256:createHash('sha256').update(updated).digest('hex'),results},null,2)+'\n');
