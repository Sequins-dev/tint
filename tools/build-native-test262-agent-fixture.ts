import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    `var secret = 123;
$262.agent.start("$262.agent.report(typeof secret); $262.agent.leaving();");
var report; while((report=$262.agent.getReport())===null)$262.agent.sleep(1);
if(report!=="undefined")throw new Error("agent global leaked");`,
    `var sab = new SharedArrayBuffer(8), view = new Int32Array(sab);
$262.agent.start(\`$262.agent.receiveBroadcast(function(sab,id){
var a=new Int32Array(sab);var result=Atomics.wait(a,0,0,10000);
$262.agent.report(result+":"+id);$262.agent.leaving();});\`);
$262.agent.broadcast(sab,-9223372036854775809n);
while(Atomics.notify(view,0,1)===0)$262.agent.sleep(1);
var report;while((report=$262.agent.getReport())===null)$262.agent.sleep(1);
if(report!=="ok:-9223372036854775809")throw new Error("cross-agent wait or id changed");`,
    `$262.agent.start("$262.agent.report('x\\u0000\\ud800');$262.agent.report('second');$262.agent.leaving();");
var a,b;while((a=$262.agent.getReport())===null)$262.agent.sleep(1);
while((b=$262.agent.getReport())===null)$262.agent.sleep(1);
if(a.length!==3||a.charCodeAt(0)!==120||a.charCodeAt(1)!==0||a.charCodeAt(2)!==0xd800||b!=="second")throw new Error("copied report changed");`,
    `var count=0;
$262.agent.start({toString:function(){count++;return "$262.agent.report({toString:function(){return 'converted';}});$262.agent.leaving();";}});
var report;while((report=$262.agent.getReport())===null)$262.agent.sleep(1);
if(count!==1||report!=="converted")throw new Error("coercion changed");`,
  ],
  { nodeReference: false },
);
