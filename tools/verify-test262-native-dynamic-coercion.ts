import { verifyNativeScriptCases } from "./native-script-fixture.ts";

const constructors = [
  "Function",
  "(function*(){}).constructor",
  "(async function(){}).constructor",
  "(async function*(){}).constructor",
];
const cases: string[] = [];
for (const expression of constructors) {
  for (const construct of [false, true]) {
    const invoke = construct ? "new C" : "C";
    cases.push(
      `const C=${expression};let log="",caught=false;const a={toString(){log+="a";return "x";}},b={toString(){log+="b";throw 42;}},c={toString(){log+="c";return "return 1;";}};try{${invoke}(a,b,c);}catch(e){caught=e===42;}if(!caught||log!=="ab")throw 1;`,
    );
    cases.push(
      `const C=${expression};let log="",caught=false;const a={toString(){log+="a";return "x";}},body={toString(){log+="b";throw 42;}};try{${invoke}(a,body);}catch(e){caught=e===42;}if(!caught||log!=="ab")throw 1;`,
    );
    cases.push(
      `const C=${expression};let caught=0;try{${invoke}(Symbol());}catch(e){if(e instanceof TypeError)caught++;}try{${invoke}(Symbol(),"return 1;");}catch(e){if(e instanceof TypeError)caught++;}if(caught!==2)throw 1;`,
    );
    cases.push(
      `const C=${expression};let hint="",caught=false;const body={[Symbol.toPrimitive](value){hint=value;throw 42;}};try{${invoke}(body);}catch(e){caught=e===42;}if(!caught||hint!=="string")throw 1;`,
    );
  }
}
verifyNativeScriptCases(cases);
