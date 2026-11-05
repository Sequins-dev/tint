import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// ES2025 AddEntriesFromIterable propagates IteratorStepValue failures directly.
// Node 24.12 closes in these cases; the pinned Test262 suite expects no close.
verifyNativeScriptCases(
  [
    `let closed=0;const source={[Symbol.iterator](){return {next(){throw 42;},return(){closed++;return {};}};}};let caught=false;try{Object.fromEntries(source);}catch(e){caught=e===42;}if(!caught||closed!==0)throw 1;`,
    `let closed=0;const source={[Symbol.iterator](){return {next(){return {get done(){throw 42;}};},return(){closed++;return {};}};}};let caught=false;try{Object.fromEntries(source);}catch(e){caught=e===42;}if(!caught||closed!==0)throw 1;`,
    `let closed=0;const source={[Symbol.iterator](){return {next(){return {done:false,get value(){throw 42;}};},return(){closed++;return {};}};}};let caught=false;try{Object.fromEntries(source);}catch(e){caught=e===42;}if(!caught||closed!==0)throw 1;`,
  ],
  { nodeReference: false },
);
