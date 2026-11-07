import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const source=readFileSync(process.argv[2],'utf8');assert.equal(source.split('root=$HOME/.t3/tint-slots/$cls').length,2);
const root=mkdtempSync(join(tmpdir(),'tint-j-slot-lower-')),script=join(root,'slot'),cls=join(root,'runner');
writeFileSync(script,source.replace('root=$HOME/.t3/tint-slots/$cls','root=$TINT_SLOT_TEST_ROOT/$cls'));mkdirSync(cls);writeFileSync(join(cls,'max'),'2\n');
for(const i of [1,2]){const d=join(cls,'slot-'+i);mkdirSync(d);writeFileSync(join(d,'pid'),String(process.pid));writeFileSync(join(d,'cmd'),'held by isolated test\n')}
const child=spawn('/bin/zsh',[script,'runner','2','--','/bin/echo','ACQUIRED'],{env:{...process.env,TINT_SLOT_TEST_ROOT:root},detached:true});
let stdout='',stderr='',closed;child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);const exited=new Promise(resolve=>child.on('close',code=>{closed=code;resolve(code)}));
try{
 const start=Date.now();while(!stderr.includes('waiting for runner slot')){assert.ok(Date.now()-start<8000,'wrapper did not queue');await delay(20)}
 writeFileSync(join(cls,'max'),'1\n');rmSync(join(cls,'slot-2'),{recursive:true});await delay(2600);
 assert.equal(closed,undefined,'queued wrapper admitted slot2 after central cap fell to1');
 rmSync(join(cls,'slot-1'),{recursive:true});const result=await Promise.race([exited,delay(5500).then(()=> 'timeout')]);assert.equal(result,0);assert.equal(stdout.trim(),'ACQUIRED');assert.match(stderr,/acquired .*slot-1/);
 console.log('PASS: queued wrapper respects central2->1 and waits for legal slot; no shared slots touched');
}finally{try{process.kill(-child.pid,'SIGTERM')}catch{}await exited;rmSync(root,{recursive:true,force:true})}
