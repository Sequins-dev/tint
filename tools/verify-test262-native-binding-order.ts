import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// ResolveBinding precedes GetV/default/CopyDataProperties per ECMA-262.
// Node 24 resolves these with-environment destinations too late.
verifyNativeScriptCases(
  [
    `var target=0;var holder={};var source={get p(){holder.target=19;return 42;}};with(holder){var {p:target}=source;}if(target!==42||holder.target!==19)throw 1;`,
    `var target=0;var holder={};function fallback(){holder.target=19;return 42;}with(holder){var {p:target=fallback()}={};}if(target!==42||holder.target!==19)throw 1;`,
    `var target;var holder={};var source={get p(){holder.target=19;return 42;}};with(holder){var {...target}=source;}if(target.p!==42||holder.target!==19)throw 1;`,
    `var log=[];var sourceKey={toString(){log.push("key");return "p";}};var source={get p(){log.push("get");return undefined;}};var env=new Proxy({},{has(t,k){log.push("has:"+k);return false;}});var fallback=42;var target;with(env){var {[sourceKey]:target=fallback}=source;}if(log.join()!=="has:source,has:sourceKey,key,has:target,get,has:fallback"||target!==42)throw 1;`,
  ],
  { nodeReference: false },
);
