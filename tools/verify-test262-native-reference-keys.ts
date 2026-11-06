import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// A property Reference converts its computed key once: GetValue/PutValue store
// the ToPropertyKey result back into the Reference (ECMA-262 6.2.5.5-6), so
// compound, update and logical assignment observe one conversion. Simple
// assignment converts after its RHS; nullish bases throw before conversion.
// Node 24 converts compound/update keys twice (it fails unchanged Test262
// S11.13.2_A7.*_T4), so these cases have no Node reference.
const prelude = `var log=[];function key(n){return {toString(){log.push("key");return n;}};}function traced(v){return {get x(){log.push("get");return v;},set x(n){log.push("set");v=n;}};}function rhs(v){log.push("rhs");return v;}function order(e){if(log.join()!==e)throw new Error(log.join()+" !== "+e);log=[];}`;
verifyNativeScriptCases(
  [
    prelude +
      `var o=traced(6);o[key("x")]+=rhs(2);order("key,get,rhs,set");o[key("x")]^=rhs(1);order("key,get,rhs,set");o[key("x")]**=rhs(2);order("key,get,rhs,set");if(o.x!==81)throw 2;`,
    prelude +
      `var o=traced(1);if(o[key("x")]++!==1)throw 1;order("key,get,set");if(--o[key("x")]!==1)throw 2;order("key,get,set");`,
    prelude +
      `var o=traced(0);o[key("x")]||=rhs(4);order("key,get,rhs,set");o[key("x")]||=rhs(5);order("key,get");o[key("x")]&&=rhs(0);order("key,get,rhs,set");var n=traced(undefined);n[key("x")]??=rhs(7);order("key,get,rhs,set");`,
    prelude +
      `var v=1;var proto={get x(){log.push("get");return v;},set x(n){log.push("set");v=n;}};var home={__proto__:proto,m(){super[key("x")]+=rhs(2);return super[key("x")]++;}};if(home.m()!==3)throw 1;order("key,get,rhs,set,key,get,set");`,
    prelude +
      `var o=traced(1);var bad={toString(){log.push("key");throw new RangeError("k");}};try{o[bad]+=rhs(1);throw 1;}catch(e){if(!(e instanceof RangeError))throw e;}order("key");var b=null;try{b[key("x")]++;throw 2;}catch(e){if(!(e instanceof TypeError))throw e;}order("");try{b[key("x")]=rhs(1);throw 3;}catch(e){if(!(e instanceof TypeError))throw e;}order("rhs");o[key("x")]=rhs(2);order("rhs,key,set");`,
    prelude +
      `var o=traced(1);function* g(){o[key("x")]+=yield 0;}var it=g();it.next();order("key,get");it.next(41);order("set");var s=Symbol();var t={};t[s]=1;t[{toString(){log.push("key");return s;}}]+=41;if(t[s]!==42)throw 1;order("key");`,
  ],
  { nodeReference: false },
);
