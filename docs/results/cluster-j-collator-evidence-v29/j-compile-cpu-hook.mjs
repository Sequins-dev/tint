import {isMainThread} from 'node:worker_threads';
import {appendFileSync} from 'node:fs';
if(isMainThread&&process.env.TINT_J_COMPILE_CPU){
 const destination=process.env.TINT_J_COMPILE_CPU,original=process.stderr.write.bind(process.stderr);let buffer='',active;
 process.stderr.write=function(chunk,...args){const text=typeof chunk==='string'?chunk:chunk.toString();buffer+=text;for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const match=/\[Test262\] selection="[^"]*" phase="([^"]*)"/.exec(line);if(!match)continue;const phase=match[1];if(active&&phase!==active.phase){const cpu=process.cpuUsage(active.cpu);appendFileSync(destination,JSON.stringify({kind:'native-batch-compile-cpu',pid:process.pid,phase:active.phase,startedAt:active.at,endedAt:new Date().toISOString(),wallMs:performance.now()-active.clock,userUs:cpu.user,systemUs:cpu.system,totalUs:cpu.user+cpu.system,nextPhase:phase})+'\n');active=undefined;}if(!active&&/^compiling batch \d+ /.test(phase))active={phase,cpu:process.cpuUsage(),clock:performance.now(),at:new Date().toISOString()};}return original(chunk,...args);};
 process.on('exit',code=>{if(active)appendFileSync(destination,JSON.stringify({kind:'interrupted-compile-cpu',phase:active.phase,exitCode:code,cpu:process.cpuUsage(active.cpu)})+'\n');});
}
