import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// Locale strings share the real Intl formatter; receiver validation comes first.
verifyNativeScriptCases(
  [
    String.raw`const formatter=new Intl.NumberFormat("en");for(const value of [0,-0,1,-1,1234.5,NaN,Infinity,-Infinity,Number.MIN_VALUE,Number.MAX_VALUE]){if(value.toLocaleString("en")!==formatter.format(value)||new Number(value).toLocaleString("en")!==formatter.format(value))throw 1;}if((1234.5).toLocaleString("de")!=="1.234,5")throw 2;let observed=false;const poison={get length(){observed=true;throw 3;}};try{Number.prototype.toLocaleString.call({},poison);throw 4;}catch(e){if(!(e instanceof TypeError)||observed)throw e;}`,

    String.raw`const f=Number.prototype.toLocaleString,d=Object.getOwnPropertyDescriptor(Number.prototype,"toLocaleString");if(f.name!=="toLocaleString"||f.length!==0||d.enumerable||!d.writable||!d.configurable)throw 1;for(const value of [null,undefined,true,"12",1n,Symbol(),{},new Proxy(new Number(12),{})]){let caught=false;try{f.call(value);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;}let caught=false;try{new f();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;`,
  ],
  { nodeReference: false },
);
