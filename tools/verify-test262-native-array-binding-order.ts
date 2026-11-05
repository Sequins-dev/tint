import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// ResolveBinding precedes IteratorStepValue/collection for binding identifiers.
// Node 24 resolves some with-environment destinations too late.
verifyNativeScriptCases(
  [
    `var target=0;const env={};const source={[Symbol.iterator](){return {next(){env.target=99;return {value:42,done:false};},return(){return {};}};}};with(env){var [target]=source;}if(target!==42||env.target!==99)throw 1;`,
    `var target=0;const env={};const source={[Symbol.iterator](){return {next(){return {get value(){env.target=99;return 42;},done:false};},return(){return {};}};}};with(env){var [target]=source;}if(target!==42||env.target!==99)throw 1;`,
    `var target=0;const env={};let n=0;const source={[Symbol.iterator](){return {next(){env.target=99;return n++===0?{value:42,done:false}:{done:true};}};}};with(env){var [...target]=source;}if(target.length!==1||target[0]!==42||env.target!==99)throw 1;`,
    `const marker={};let closed=0;const env=new Proxy({}, {has(t,k){if(k==="target")throw marker;return false;}});const source={[Symbol.iterator](){return {next(){throw 1;},return(){closed++;throw 2;}};}};let caught;try{with(env){var [target]=source;}}catch(e){caught=e;}if(caught!==marker||closed!==1)throw 3;`,
  ],
  { nodeReference: false },
);
