import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const source=readFileSync(process.argv[2],'utf8');
assert.equal(source.split('root=$HOME/.t3/tint-slots/$cls').length,2);
const root=mkdtempSync(join(tmpdir(),'tint-j-slot-test-'));
const script=join(root,'slot');
writeFileSync(script,source.replace('root=$HOME/.t3/tint-slots/$cls','root=$TINT_SLOT_TEST_ROOT/$cls'));
const cls=join(root,'runner');mkdirSync(cls);writeFileSync(join(cls,'max'),'1\n');
const held=join(cls,'slot-1');mkdirSync(held);writeFileSync(join(held,'pid'),String(process.pid));writeFileSync(join(held,'cmd'),'held by isolated test\n');
const child=spawn('/bin/zsh',[script,'runner','2','--','/bin/echo','ACQUIRED'],{env:{...process.env,TINT_SLOT_TEST_ROOT:root},detached:true});
let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
const exited=new Promise(resolve=>child.on('close',code=>resolve(code)));
try {
 const start=Date.now();while(!stderr.includes('waiting for runner slot')){assert.ok(Date.now()-start<8000,'wrapper did not reach the queue');await delay(20)}
 writeFileSync(join(cls,'max'),'2\n');
 const result=await Promise.race([exited,delay(5500).then(()=> 'timeout')]);
 assert.notEqual(result,'timeout','queued wrapper did not observe raised central cap');
 assert.equal(result,0);assert.equal(stdout.trim(),'ACQUIRED');assert.match(stderr,/acquired .*slot-2/);
 console.log('PASS: existing queued wrapper observes central1->2 without restart; no shared slots touched');
}finally{
 try{process.kill(-child.pid,'SIGTERM')}catch{}
 await exited;rmSync(root,{recursive:true,force:true});
}
