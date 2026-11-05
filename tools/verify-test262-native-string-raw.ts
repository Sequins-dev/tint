import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `if(String.raw({raw:["a","b","c"]},19,23)!=="a19b23c"||String.raw({raw:"abc"},1)!=="a1bc")throw 1;if(String.raw({raw:["a","b"]},undefined)!=="aundefinedb")throw 2;`,
  `let order="";const template={get raw(){order+="r";return {get length(){order+="l";return 2;},get 0(){order+="a";return {toString(){order+="A";return "x";}};},get 1(){order+="b";return "y";}};}};const sub={toString(){order+="s";return "!";}};if(String.raw(template,sub)!=="x!y"||order!=="rlaAsb")throw 1;`,
  `const poison={toString(){throw 1;}};if(String.raw({raw:{length:-1,get 0(){throw 2;}}},poison)!==""||String.raw({raw:["x"]},poison)!=="x")throw 3;`,
  `const raw={length:3,0:"a",1:"b",2:"c"};const sub={toString(){raw.length=1;raw[1]="!";return ":";}};if(String.raw({raw},sub)!=="a:!c")throw 1;`,
  `const marker={};for(const template of [{get raw(){throw marker;}},{raw:{get length(){throw marker;}}},{raw:{length:1,get 0(){throw marker;}}}]){let caught;try{String.raw(template);}catch(e){caught=e;}if(caught!==marker)throw 1;}for(const template of [null,undefined,{raw:null},{raw:undefined},{raw:[Symbol()]}]){let caught=false;try{String.raw(template);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;}`,
  `const d=Object.getOwnPropertyDescriptor(String,"raw");if(d.enumerable||!d.writable||!d.configurable||String.raw.name!=="raw"||String.raw.length!==1)throw 1;let caught=false;try{new String.raw({raw:[]});}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
]);
