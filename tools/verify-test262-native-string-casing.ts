import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`if("Straße ﬃΐ".toUpperCase()!=="STRASSE FFIΪ́")throw 1;`,
    String.raw`for(const pair of [["ΟΣ","ος"],["ΟΣΑ","οσα"],["ΟΣ\u0301","ος\u0301"],["ΟΣ\u0301Α","οσ\u0301α"],["Σ","σ"],["AΣ'A","aσ'a"],["𐐀Σ","𐐨ς"]])if(pair[0].toLowerCase()!==pair[1])throw 1;if("İ".toLowerCase()!=="i\u0307"||"𐐨".toUpperCase()!=="𐐀")throw 2;`,
    String.raw`if("\ud800a\udfff".toUpperCase()!=="\ud800A\udfff"||"\ud800A\udfff".toLowerCase()!=="\ud800a\udfff")throw 1;for(const name of ["toUpperCase","toLowerCase"]){const f=String.prototype[name],d=Object.getOwnPropertyDescriptor(String.prototype,name);if(f.name!==name||f.length!==0||d.enumerable||!d.writable||!d.configurable)throw 2;for(const value of [null,undefined,Symbol()]){let caught=false;try{f.call(value);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;}let calls=0;f.call({toString(){calls++;return "AbC";}});if(calls!==1||f.call(123n)!=="123")throw 4;}`,
    String.raw`for(let point=0;point<128;point++){const text=String.fromCharCode(point),upper=point>=97&&point<=122?String.fromCharCode(point-32):text,lower=point>=65&&point<=90?String.fromCharCode(point+32):text;if(text.toUpperCase()!==upper||text.toLowerCase()!==lower)throw 1;}if(encodeURI("\x00").toUpperCase()!=="%00")throw 2;`,
  ],
  { nodeReference: true },
);
