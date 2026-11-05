import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  String.raw`if((1.5).toString(2)!=="1.1"||(-.5).toString(16)!=="-0.8"||(.1).toString(16)!=="0.1999999999999a"||(.1).toString(32)!=="0.36cpj6cpj6d")throw 1;if(Number.MIN_VALUE.toString(2)!=="0."+"0".repeat(1073)+"1")throw 2;if((-0).toString(8)!=="0")throw 3;`,
]);
