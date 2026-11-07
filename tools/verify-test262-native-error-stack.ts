import { startNativeHeartbeat } from "./test262-native-heartbeat.ts";
import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// Node's legacy own stack properties do not implement this pinned proposal.
// Semantics: https://tc39.es/proposal-error-stack-accessor/.
const cases = [
  `var d=Object.getOwnPropertyDescriptor(Error.prototype,'stack');if(d.enumerable||!d.configurable||d.get.name!=='get stack'||d.get.length!==0||d.set.name!=='set stack'||d.set.length!==1)throw 1;var constructors=[Error,EvalError,RangeError,ReferenceError,SyntaxError,TypeError,URIError,AggregateError,SuppressedError];for(var C of constructors){var e=C===AggregateError?new C([],'m'):C===SuppressedError?new C(1,2,'m'):new C('m');if(typeof d.get.call(e)!=='string'||Object.hasOwn(e,'stack')||d.get.call(C.prototype)!==undefined||d.get.call(Object.create(e))!==undefined)throw 2;}`,
  `var d=Object.getOwnPropertyDescriptor(Error.prototype,'stack'),calls=0,p=new Proxy({}, {getOwnPropertyDescriptor(){calls++;throw 1;}});for(var v of [undefined,null,false,1,'',Symbol('x'),1n]){var caught=false;try{d.get.call(v);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;}for(var v of [undefined,null,false,1,{},Object('x'),1n]){var caught=false;try{d.set.call(p,v);}catch(e){caught=e instanceof TypeError;}if(!caught||calls)throw 3;}`,
  `var d=Object.getOwnPropertyDescriptor(Error.prototype,'stack');function origin(){return new Error('message');}function outer(){var result=origin();return result;}var e=outer(),trace=d.get.call(e);if(trace.indexOf('origin')<0||trace.indexOf('outer')<0)throw 1;Object.defineProperty(origin,'name',{get(){throw 2;}});if(d.get.call(e)!==trace)throw 3;e.stack='override';if(e.stack!=='override'||d.get.call(e)!==trace)throw 4;delete e.stack;if(e.stack!==trace)throw 5;function gone(){throw new Error('gone');}try{gone();}catch(x){}if((new Error()).stack.indexOf('gone')>=0)throw 6;`,
  `var d=Object.getOwnPropertyDescriptor(Error.prototype,'stack'),o=$262.createRealm().global,e=new o.Error('foreign');if(typeof d.get.call(e)!=='string')throw 1;d.set.call(e,'foreign');var p=Object.getOwnPropertyDescriptor(e,'stack');if(p.value!=='foreign'||!p.writable||!p.enumerable||!p.configurable)throw 2;var caught=false;try{d.set.call(o.Error.prototype,'x');}catch(x){caught=x instanceof o.TypeError&&!(x instanceof TypeError);}if(!caught)throw 3;`,
  `var d=Object.getOwnPropertyDescriptor(Error.prototype,'stack'),e=new Error();Object.defineProperty(e,'stack',{value:'first',writable:true,enumerable:false,configurable:false});d.set.call(e,'second');var p=Object.getOwnPropertyDescriptor(e,'stack');if(p.value!=='second'||p.enumerable||p.configurable)throw 1;Object.defineProperty(e,'stack',{writable:false});var caught=false;try{d.set.call(e,'third');}catch(x){caught=x instanceof TypeError;}if(!caught||e.stack!=='second')throw 2;var seen;var a={set stack(v){seen=v;}};d.set.call(a,'sentinel');if(seen!=='sentinel')throw 3;`,
  `var d=Object.getOwnPropertyDescriptor(Error.prototype,'stack'),log=[],target={},p=new Proxy(target,{getOwnPropertyDescriptor(t,k){log.push('getOwn');return Reflect.getOwnPropertyDescriptor(t,k);},defineProperty(t,k,v){log.push('define');return Reflect.defineProperty(t,k,v);},set(t,k,v,r){log.push('set');return true;}});d.set.call(p,'one');if(log.join(',')!=='getOwn,define'||target.stack!=='one')throw 1;log.length=0;d.set.call(p,'two');if(log.join(',')!=='getOwn,set')throw 2;var q=new Proxy(new Error(),{get(){throw 3;},getOwnPropertyDescriptor(){throw 4;}});if(d.get.call(q)!==undefined)throw 5;`,
  `var d=Object.getOwnPropertyDescriptor(Error.prototype,'stack'),sentinel={},p=new Proxy({}, {getOwnPropertyDescriptor(){throw sentinel;}}),caught=false;try{d.set.call(p,'text');}catch(x){caught=x===sentinel;}if(!caught)throw 1;var closed=Object.preventExtensions({});caught=false;try{d.set.call(closed,'text');}catch(x){caught=x instanceof TypeError;}if(!caught)throw 2;Object.freeze(Error.prototype);var e=new Error();d.set.call(e,'text');if(e.stack!=='text')throw 3;caught=false;try{d.set.call(Error.prototype,'text');}catch(x){caught=x instanceof TypeError;}if(!caught)throw 4;`,
];
const heartbeat = startNativeHeartbeat("bespoke Error stack fixture");
heartbeat.counts({
  total: cases.length,
  done: 0,
  pass: 0,
  fail: 0,
  unsupported: 0,
  infra: 0,
});
try {
  heartbeat.phase("compiling Error stack fixture");
  verifyNativeScriptCases(cases, { nodeReference: false });
} finally {
  await heartbeat.close();
}
