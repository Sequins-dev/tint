import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { debugserverLaunchCommand } from "../../tools/native-debugger-session.ts";

const root = resolve(".tint-bootstrap/g-staging-selfbuild-v7");
mkdirSync(root);
const frozen = resolve(".tint-bootstrap/node-toolchain-g-staging-v7");
const node = "/Users/stephenbelanger/.nvm/versions/node/v24.12.0/bin/node";
const records: unknown[] = [];
const started = Date.now();
let phase = "initializing";
let childPid: number | undefined;
const heartbeat = setInterval(() => {
  const sample = childPid === undefined ? "queued" : spawnSync("ps", ["-o", "pid,ppid,state,%cpu,time,rss,command", "-p", String(childPid)], {encoding:"utf8"}).stdout.trim();
  console.error(new Date().toISOString(), phase, Math.round((Date.now()-started)/1000), sample);
}, 30000);
async function run(label: string, command: string, args: string[], cwd?: string) {
  phase = label;
  console.error(new Date().toISOString(), label, command, args);
  const child = spawn(command, args, {cwd, stdio:["ignore","pipe","pipe"]});
  childPid = child.pid;
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {output += chunk; process.stderr.write(chunk);});
  const code = await new Promise<number|null>((done, reject) => {child.on("error",reject); child.on("close",done);});
  childPid = undefined;
  writeFileSync(join(root,label+".log"),output);
  records.push({label, command, args, cwd, exitStatus:code});
  assert.equal(code,0,label);
}
async function native(label: string, binary: string, args: string[], expectedExit: number) {
  const session = mkdtempSync(join(tmpdir(),"tint-g-self-"));
  const initial = join(root,label+"-initial.json"), outcome = join(root,label+"-outcome.json");
  const inspect = [
    "import json",
    "p=lldb.debugger.GetSelectedTarget().GetProcess()",
    `open(${JSON.stringify(initial)},'w').write(json.dumps({'state':p.GetState(),'pid':p.GetProcessID()}))`,
    "assert p.GetState()==lldb.eStateStopped and p.GetProcessID()>0",
    "p.Continue()",
    `open(${JSON.stringify(outcome)},'w').write(json.dumps({'state':p.GetState(),'exitStatus':p.GetExitStatus(),'pid':p.GetProcessID()}))`,
    `assert p.GetState()==lldb.eStateExited and p.GetExitStatus()==${expectedExit}`,
  ].join("\n");
  await run(label,"/usr/bin/lldb",["--batch",binary,"-o",debugserverLaunchCommand(binary,session,args,30000,"direct"),"-o","script exec("+JSON.stringify(inspect)+")"]);
  const result=JSON.parse(readFileSync(outcome,"utf8"));
  assert.equal(result.state,10); assert.equal(result.exitStatus,expectedExit);
  assert.equal(JSON.parse(readFileSync(initial,"utf8")).state,5);
  records.push({label,session,initial,outcome});
}
function identity(path:string) { const bytes=readFileSync(path); return {path,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")}; }
try {
  const stage1=join(root,"stage1"), stage2=join(root,"stage2"), sources=join(root,"sources");
  await run("bootstrap",node,[join(frozen,"tools/bootstrap-compiler.ts"),stage1,"--source-root",frozen,"--snapshot",sources,"--debug-symbols"]);
  await native("selfbuild",stage1,[sources,stage2,"--debug-symbols"],0);
  assert.ok(readFileSync(stage1).equals(readFileSync(stage2)),"stage image equality");
  await run("prepare-smoke",node,[join(frozen,"tools/prepare-compiler-smoke.ts"),"--debug-symbols"],frozen);
  const smokeSource=join(frozen,".tint-bootstrap/smoke-project"), smokeNode=join(frozen,".tint-bootstrap/smoke-node"), smoke=join(root,"smoke");
  await native("compile-smoke",stage2,[smokeSource,smoke,"--debug-symbols"],0);
  assert.ok(readFileSync(smokeNode).equals(readFileSync(smoke)),"smoke image equality");
  await native("execute-smoke",smoke,[],42);
  for(const [label,path] of [["stage1",stage1],["stage2",stage2],["smoke",smoke]]) {
    await run(label+"-signature","/usr/bin/codesign",["--verify","--strict","--verbose=2",path]);
    await run(label+"-dwarf","/usr/bin/dwarfdump",["--verify",path]);
    const sections=spawnSync("/usr/bin/otool",["-l",path],{encoding:"utf8"});
    assert.equal(sections.status,0); writeFileSync(join(root,label+"-sections.log"),sections.stdout);
    for(const name of ["__debug_info","__debug_line"]) {
      const match=new RegExp("sectname "+name+"[\\s\\S]*?size (0x[0-9a-f]+)").exec(sections.stdout);
      assert.ok(match && Number(match[1])>0,name);
    }
  }
  writeFileSync(join(root,"acceptance.json"),JSON.stringify({kind:"native-self-build-acceptance",complete:true,records,images:[stage1,stage2,smokeNode,smoke].map(identity),stageImagesEqual:true,smokeImagesEqual:true,smokeExit:42},null,2)+"\n");
} finally {clearInterval(heartbeat); writeFileSync(join(root,"commands.json"),JSON.stringify(records,null,2)+"\n");}
