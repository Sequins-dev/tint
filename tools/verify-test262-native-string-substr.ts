import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `if("abcdef".substr(-3,2)!=="de"||"abc".substr(-Infinity,Infinity)!=="abc"||"abc".substr(Infinity)!==""||"abc".substr(NaN,1.9)!=="a"||"abc".substr(1,undefined)!=="bc")throw 1;`,
  String.raw`if("a😀z".substr(1,1)!=="\ud83d"||"a😀z".substr(2,1)!=="\ude00"||"a😀z".substr(1,2)!=="😀")throw 1;`,
  `let order="";const receiver={toString(){order+="s";return "abc";}},start={valueOf(){order+="a";return 1;}},length={valueOf(){order+="l";return 1;}};if(String.prototype.substr.call(receiver,start,length)!=="b"||order!=="sal")throw 1;`,
  `const marker={};for(const start of [0,Infinity,-Infinity]){let caught;try{"".substr(start,{valueOf(){throw marker;}});}catch(e){caught=e;}if(caught!==marker)throw 1;}let calls=0;for(const receiver of [null,undefined]){let caught=false;try{String.prototype.substr.call(receiver,{valueOf(){calls++;return 0;}});}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;}if(calls!==0)throw 3;`,
  `for(const bad of [Symbol(),1n])for(const args of [[bad],[0,bad]]){let caught=false;try{String.prototype.substr.apply("abc",args);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;}const d=Object.getOwnPropertyDescriptor(String.prototype,"substr");if(d.enumerable||!d.writable||!d.configurable||d.value.length!==2||d.value.name!=="substr")throw 2;let caught=false;try{new d.value();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;`,
]);
