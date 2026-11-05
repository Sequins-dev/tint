import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  String.raw`for(const value of [NaN,Infinity,-Infinity,-0,0])if(!Object.is(Math.cbrt(value),value))throw 1;for(let root=-100;root<=100;root++)if(Math.cbrt(root*root*root)!==root)throw 2;`,
  String.raw`for(const pair of [[Number.MIN_VALUE,1.7031839360032603e-108],[Number.MAX_VALUE,5.643803094122362e102],[1e-300,1e-100],[1e300,1e100],[2,1.2599210498948732]]){const actual=Math.cbrt(pair[0]);if(Math.abs(actual/pair[1]-1)>3*Number.EPSILON||Math.cbrt(-pair[0])!==-actual)throw 1;}`,
  String.raw`let calls=0;const value={valueOf(){calls++;return 27;}};if(Math.cbrt(value)!==3||calls!==1||Math.cbrt("-8")!==-2||Math.cbrt(null)!==0||!Number.isNaN(Math.cbrt()))throw 1;const marker={};let caught;try{Math.cbrt({valueOf(){throw marker;}});}catch(e){caught=e;}if(caught!==marker)throw 2;for(const value of [1n,Symbol()]){let error=false;try{Math.cbrt(value);}catch(e){error=e instanceof TypeError;}if(!error)throw 3;}`,
  String.raw`const d=Object.getOwnPropertyDescriptor(Math,"cbrt");if(d.enumerable||!d.writable||!d.configurable||Math.cbrt.name!=="cbrt"||Math.cbrt.length!==1)throw 1;let error=false;try{new Math.cbrt();}catch(e){error=e instanceof TypeError;}if(!error)throw 2;`,
]);
