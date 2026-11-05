import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  String.raw`if(escape("AZaz09@*_+-./")!=="AZaz09@*_+-./"||escape(" !~'()é€😀")!=="%20%21%7E%27%28%29%E9%u20AC%uD83D%uDE00"||escape("\ud800\0")!=="%uD800%00")throw 1;for(let i=0;i<65536;i++){const text=String.fromCharCode(i);if(unescape(escape(text))!==text)throw i;}`,
  String.raw`if(unescape("%u0041%ff%uD800%00")!=="Aÿ\ud800\0"||unescape("%%41")!=="%A"||unescape("%u%41")!=="%uA"||unescape("%u1F600")!=="\u1f600")throw 1;for(const text of ["%","%0","%GG","%u","%u123","%u12Z4","%U0041"])if(unescape(text)!==text)throw text;`,
  String.raw`for(const fn of [escape,unescape]){let count=0;const value={[Symbol.toPrimitive](hint){if(hint!=="string")throw 1;count++;return "42";}};if(fn(value)!=="42"||count!==1||fn()!=="undefined"||fn(null)!=="null"||fn(42n)!=="42")throw 2;let caught=false;try{fn(Symbol());}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;const marker={};let error;try{fn({toString(){throw marker;}});}catch(e){error=e;}if(error!==marker)throw 4;}`,
  String.raw`for(const name of ["escape","unescape"]){const fn=globalThis[name],d=Object.getOwnPropertyDescriptor(globalThis,name);if(fn.name!==name||fn.length!==1||d.enumerable||!d.writable||!d.configurable)throw 1;let caught=false;try{new fn("x");}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;}`,
]);
