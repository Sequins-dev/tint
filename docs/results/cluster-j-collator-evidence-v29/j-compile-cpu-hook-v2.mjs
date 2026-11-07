import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {isMainThread} from 'node:worker_threads';
import {createHash} from 'node:crypto';
if(isMainThread&&process.env.TINT_J_COMPILE_CPU){
 const destination=process.env.TINT_J_COMPILE_CPU,original=fs.writeSync,hookSha256=createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex');let buffer='',active;
 function inspect(chunk){buffer+=typeof chunk==='string'?chunk:Buffer.from(chunk).toString();for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);const match=/\[Test262\] selection="[^"]*" phase="([^"]*)"/.exec(line);if(!match)continue;const phase=match[1];if(active&&phase!==active.phase){const cpu=process.cpuUsage(active.cpu);fs.appendFileSync(destination,JSON.stringify({kind:'native-batch-compile-cpu',pid:process.pid,hookSha256,phase:active.phase,startedAt:active.at,endedAt:new Date().toISOString(),wallMs:performance.now()-active.clock,userUs:cpu.user,systemUs:cpu.system,totalUs:cpu.user+cpu.system,peakRSSKiB:process.resourceUsage().maxRSS,nextPhase:phase})+'\n');active=undefined;}if(!active&&/^compiling batch \d+ /.test(phase))active={phase,cpu:process.cpuUsage(),clock:performance.now(),at:new Date().toISOString()};}}
 fs.writeSync=function(fd,chunk,...args){if(fd===2)inspect(chunk);return original(fd,chunk,...args);};syncBuiltinESMExports();
 process.on('exit',code=>{if(active)fs.appendFileSync(destination,JSON.stringify({kind:'interrupted-compile-cpu',hookSha256,phase:active.phase,exitCode:code,cpu:process.cpuUsage(active.cpu)})+'\n');fs.appendFileSync(destination,JSON.stringify({kind:'process-total-cpu',hookSha256,pid:process.pid,exitCode:code,cpu:process.cpuUsage(),peakRSSKiB:process.resourceUsage().maxRSS})+'\n');});
}
