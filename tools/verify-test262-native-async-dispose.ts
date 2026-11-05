import { verifyNativeScriptCases } from "./native-script-fixture.ts";
const sources = [
  `const proto=Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf((async function*(){})())));const dispose=proto[Symbol.asyncDispose];for(const result of [undefined,null,42,Promise.resolve(9),{then(resolve){resolve(7);}}]){let calls=0;const receiver={return(){if(this!==receiver||arguments.length)throw 1;calls++;return result;}};const promise=dispose.call(receiver);if(!(promise instanceof Promise)||calls!==1||await promise!==undefined)throw 2;}`,
  `const dispose=Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf((async function*(){})())))[Symbol.asyncDispose];for(const receiver of [{},{return:null},1,"x",true,Symbol(),1n]){if(await dispose.call(receiver)!==undefined)throw 1;}for(const receiver of [null,undefined,{return:1}]){const promise=dispose.call(receiver);if(!(promise instanceof Promise))throw 2;let caught=false;try{await promise;}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;}`,
  `const dispose=Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf((async function*(){})())))[Symbol.asyncDispose],marker={};for(const receiver of [{get return(){throw marker;}},{return(){throw marker;}},{return(){return Promise.reject(marker);}},{return(){return {get then(){throw marker;}};}}]){const promise=dispose.call(receiver);let caught;try{await promise;}catch(e){caught=e;}if(caught!==marker)throw 1;}`,
  `let closed=0;async function* g(){try{yield 1;}finally{await 0;closed++;}}const i=g();await i.next();if(await i[Symbol.asyncDispose]()!==undefined||closed!==1||!(await i.next()).done)throw 1;`,
  `const dispose=Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf((async function*(){})())))[Symbol.asyncDispose];let calls=0;const result=Promise.resolve(42);Object.defineProperty(result,"then",{get(){throw 1;}});const receiver={return(){calls++;return result;}};if(await dispose.call(receiver)!==undefined||await dispose.call(receiver)!==undefined||calls!==2)throw 2;`,
];
verifyNativeScriptCases(
  sources.map(
    (source) =>
      `(async()=>{${source}})().then(()=>print("Test262:AsyncTestComplete"),()=>print("Test262:AsyncTestFailure:Error:disposal"));`,
  ),
  { nodeReference: false, asynchronous: true },
);
