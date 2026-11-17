import { verifyNativeScriptCases } from "./native-script-fixture.ts";

/** Directed rounding modes choose the scientific, engineering and compact
 * exponent from the signed value, as V8/ICU do (checked against the Node
 * reference). ECMA-402 ComputeExponent step 2 rounds |x| instead; see
 * docs/intl-runtime.md. https://tc39.es/ecma402/#sec-computeexponent */
verifyNativeScriptCases([
  String.raw`const f=(n,m,v)=>new Intl.NumberFormat("en",{notation:n,roundingMode:m,maximumFractionDigits:0}).format(v);if(f("scientific","ceil",-9.1)!=="-9E0"||f("scientific","ceil",9.1)!=="1E1")throw 1;if(f("scientific","floor",-9.1)!=="-1E1"||f("scientific","floor",9.1)!=="9E0")throw 2;if(f("scientific","halfCeil",-9.5)!=="-9E0"||f("scientific","halfFloor",-9.5)!=="-1E1")throw 3;if(f("scientific","expand",-9.1)!=="-1E1"||f("scientific","trunc",-9.9)!=="-9E0"||f("scientific","halfExpand",-9.99)!=="-1E1")throw 4;if(f("scientific","floor",-0)!=="-0E0")throw 5;const p=new Intl.NumberFormat("en",{notation:"scientific",roundingMode:"ceil",maximumFractionDigits:0}).formatToParts(-9.1);if(p.length!==4||p[0].type!=="minusSign"||p[1].value!=="9"||p[3].type!=="exponentInteger"||p[3].value!=="0")throw 6;`,
  String.raw`const f=(m,v)=>new Intl.NumberFormat("en",{notation:"engineering",roundingMode:m,maximumFractionDigits:0}).format(v);if(f("ceil",-999.1)!=="-999E0"||f("ceil",999.1)!=="1E3"||f("floor",-999.1)!=="-1E3"||f("floor",999.1)!=="999E0")throw 1;if(f("halfCeil",-999.5)!=="-999E0"||f("halfFloor",-999.5)!=="-1E3"||f("trunc",-0)!=="-0E0")throw 2;const c=v=>new Intl.NumberFormat("en",{notation:"compact",roundingMode:"floor"}).format(v);if(c(-999.9)!=="-1K"||c(999.9)!=="999")throw 3;`,
]);
