// Sequential per-directory native runs for the G staging plan (one runner at a time via the slot).
// Stops only between runs when .tint-bootstrap/g-staging-queue.stop exists. Never kills a runner.
import {readFileSync,writeFileSync,existsSync,appendFileSync,openSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const V=process.argv[2]??'v2',W=process.cwd(),F=W+'/.tint-bootstrap/node-toolchain-g-staging-'+V,plan=JSON.parse(readFileSync('docs/results/g-staging-plan-v1.json','utf8'));
const log=m=>appendFileSync('.tint-bootstrap/g-staging-queue-'+V+'.log',new Date().toISOString()+' '+m+'\n');
log('queue start pid '+process.pid);
for(const p of plan){
  const journal=`docs/results/test262-g-${p.name}-native-${V}.jsonl`,stem=`.tint-bootstrap/g-${p.name}-native-${V}`;
  const done=j=>existsSync(j)&&readFileSync(j,'utf8').trimEnd().split('\n').at(-1).includes('"kind":"complete"');if(done(journal)||done(`docs/results/test262-g-${p.name}-native-v1.jsonl`)){log('skip complete '+p.name);continue;}
  if(existsSync('.tint-bootstrap/g-staging-queue-'+V+'.stop')){log('stop requested before '+p.name);break;}
  log(`start ${p.name} (${p.variants} variants, root ${p.root})`);
  const env={...process.env,TINT_TEST262_SOURCES:F+'/source-snapshot.json',TINT_TEST262_CONTAINMENT_MS:'300000',TINT_TEST262_HEARTBEAT_MS:'30000',TINT_TEST262_STALL_MS:'150000',TINT_TEST262_MODULES:'1',TINT_TEST262_DEBUGGER_TRACE:'1',TINT_TEST262_DEBUGGER_LAUNCH:'debugserver-direct',TINT_TEST262_VARIANTS:W+'/'+p.manifest,TINT_TEST262_JOURNAL:W+'/'+journal};
  if(existsSync(journal))env.TINT_TEST262_RESUME='1';
  const out=openSync(stem+'.stdout.json','w'),err=openSync(stem+'.stderr.log','a');
  const r=spawnSync(process.env.HOME+'/.t3/tint-slots/slot',['runner','8','--','/Users/stephenbelanger/.nvm/versions/node/v24.12.0/bin/node',F+'/tools/test262-native-run.ts','/Users/stephenbelanger/Code/nodejs/tint/.tint-bootstrap/test262',p.root,'64'],{env,cwd:W,stdio:['ignore',out,err]});
  writeFileSync(stem+'.exit',String(r.status)+'\n');log(`end ${p.name} exit ${r.status}${r.signal?' signal '+r.signal:''}`);
}
log('queue end');
