import { verifyNativeScriptCases } from "./native-script-fixture.ts";

/** ECMA-402 ComputeExponent selects the exponent from |x| (step 2); the signed
 * value is then rounded at that exponent. Node 24 (ICU) selects it from the
 * signed value under directed rounding, so the Node reference is disabled.
 * https://tc39.es/ecma402/#sec-computeexponent */
verifyNativeScriptCases(
  [
    String.raw`const f=(n,m,v)=>new Intl.NumberFormat("en",{notation:n,roundingMode:m,maximumFractionDigits:0}).format(v);if(f("scientific","ceil",-9.1)!=="-0E1"||f("scientific","ceil",9.1)!=="1E1")throw 1;if(f("scientific","floor",-9.1)!=="-10E0"||f("scientific","floor",9.1)!=="9E0")throw 2;if(f("scientific","halfCeil",-9.5)!=="-1E1"||f("scientific","halfFloor",-9.5)!=="-10E0")throw 3;if(f("scientific","expand",-9.1)!=="-1E1"||f("scientific","trunc",-9.9)!=="-9E0"||f("scientific","halfExpand",-9.99)!=="-1E1")throw 4;if(f("scientific","floor",-0)!=="-0E0")throw 5;const p=new Intl.NumberFormat("en",{notation:"scientific",roundingMode:"ceil",maximumFractionDigits:0}).formatToParts(-9.1);if(p.length!==4||p[0].type!=="minusSign"||p[1].value!=="0"||p[3].type!=="exponentInteger"||p[3].value!=="1")throw 6;`,
    String.raw`const f=(m,v)=>new Intl.NumberFormat("en",{notation:"engineering",roundingMode:m,maximumFractionDigits:0}).format(v);if(f("ceil",-999.1)!=="-0E3"||f("ceil",999.1)!=="1E3"||f("floor",-999.1)!=="-1,000E0"||f("floor",999.1)!=="999E0")throw 1;if(f("halfCeil",-999.5)!=="-1E3"||f("halfFloor",-999.5)!=="-1,000E0"||f("trunc",-0)!=="-0E0")throw 2;const c=v=>new Intl.NumberFormat("en",{notation:"compact",roundingMode:"floor"}).format(v);if(c(-999.9)!=="-1000"||c(999.9)!=="999")throw 3;`,
  ],
  { nodeReference: false },
);
