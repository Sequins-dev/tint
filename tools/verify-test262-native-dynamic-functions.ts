import { verifyNativeScriptCases } from "./native-script-fixture.ts";
const constructors = [
  "Function",
  "(function*(){}).constructor",
  "(async function(){}).constructor",
  "(async function*(){}).constructor",
];
const cases: string[] = [];
for (const expression of constructors) {
  for (const invocation of ["C", "new C"]) {
    for (const argumentsText of [
      '"/*","*/ ) {"',
      '"a) {}); (function anonymous(b",""',
      '"","} ); (function anonymous() {"',
      '"a: number","return a;"',
      '"a = 1","\\"use strict\\";return a;"',
      '"a","let a;"',
      '"...a,",""',
      '"super.x;"',
    ]) {
      cases.push(
        `const C=${expression};let caught=false;try{${invocation}(${argumentsText});}catch(e){caught=e instanceof SyntaxError;}if(!caught)throw 1;`,
      );
    }
    cases.push(
      `const C=${expression};let log="",caught=false;const p={toString(){log+="p";return "a: number";}},body={toString(){log+="b";return "";}};try{${invocation}(p,body);}catch(e){caught=e instanceof SyntaxError;}if(!caught||log!=="pb")throw 1;`,
    );
  }
  cases.push(
    `const C=${expression};let read=0,caught=false;const target=new Proxy(function(){},{get(t,key,r){if(key==="prototype"){read++;throw 42;}return Reflect.get(t,key,r);}});try{Reflect.construct(C,["a: number",""],target);}catch(e){caught=e instanceof SyntaxError;}if(!caught||read!==0)throw 1;`,
  );
}
verifyNativeScriptCases(cases);
