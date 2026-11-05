import { verifyNativeScriptCases } from "./native-script-fixture.ts";

verifyNativeScriptCases([
  `let caught=false;try{new Error(function(){});}catch{caught=true;}if(caught)throw 1;`,
  `if(Math.pow(2,0.5)!==Math.SQRT2)throw 1;`,
  `if(2**0.5!==Math.SQRT2)throw 1;`,
]);
