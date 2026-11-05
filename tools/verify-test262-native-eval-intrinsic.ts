import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  `if(eval.name!=="eval"||eval.length!==1||eval.hasOwnProperty("prototype"))throw 1;const g=Object.getOwnPropertyDescriptor(globalThis,"eval"),n=Object.getOwnPropertyDescriptor(eval,"name"),l=Object.getOwnPropertyDescriptor(eval,"length");if(!g.writable||g.enumerable||!g.configurable||n.writable||n.enumerable||!n.configurable||l.writable||l.enumerable||!l.configurable)throw 2;`,
  `for(const value of [undefined,null,false,42,Symbol(),{},new String("source")]){if(eval(value)!==value)throw 1;}if(eval()!==undefined)throw 2;let count=0;const value={toString(){count++;throw 1;},[Symbol.toPrimitive](){count++;throw 2;}};if(eval(value)!==value||count!==0)throw 3;`,
  `let caught=false;try{new eval();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 1;const evaluate=eval;if(evaluate(42)!==42)throw 2;`,
  `const source=Function.prototype.toString.call(eval);Object.defineProperty(eval,"name",{value:"changed"});if(Function.prototype.toString.call(eval)!==source||!source.includes("eval"))throw 1;`,
]);
