import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// ES2025 CreateRegExpStringIterator uses GeneratorResume: reject re-entry and
// remain completed after an abrupt completion. Node 24.12 still recurses here.
// https://262.ecma-international.org/16.0/#sec-createregexpstringiterator
verifyNativeScriptCases(
  [
    `const foreign=$262.createRealm().global;const foreignIterator=new foreign.RegExp("a","g")[Symbol.matchAll]("a");const foreignNext=Object.getPrototypeOf(foreignIterator).next;const own=/a/[Symbol.matchAll]("a");const first=foreignNext.call(own),second=foreignNext.call(own),third=foreignNext.call(own);if(Object.getPrototypeOf(first)!==Object.prototype||Object.getPrototypeOf(second)!==Object.prototype||Object.getPrototypeOf(third)!==foreign.Object.prototype||first.done||!second.done||!third.done)throw 1;`,
    `let iterator,calls=0,reentered=false;const rx={flags:"g",lastIndex:0,constructor:{[Symbol.species]:function(){return {lastIndex:0,exec(){calls++;try{iterator.next();}catch(e){reentered=e instanceof TypeError;}return null;}};}}};iterator=RegExp.prototype[Symbol.matchAll].call(rx,"a");if(!iterator.next().done||!reentered||calls!==1||!iterator.next().done)throw 1;const marker={};rx.constructor[Symbol.species]=function(){return {lastIndex:0,exec(){throw marker;}};};const other=RegExp.prototype[Symbol.matchAll].call(rx,"a");try{other.next();throw 2;}catch(e){if(e!==marker)throw 3;}if(!other.next().done)throw 4;`,
  ],
  { nodeReference: false },
);
