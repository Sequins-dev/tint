import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  String.raw`for(const row of [[9,.5,3],[16,.25,2],[4,-.5,.5],[2,1.5,2.8284271247461903],[1e300,.5,1e150],[1e-300,.5,1e-150],[Number.MIN_VALUE,.5,2.2227587494850775e-162]]){const a=Math.pow(row[0],row[1]),b=row[0]**row[1];if(a!==b||Math.abs(a-row[2])>2e-12*Math.abs(row[2])+Number.MIN_VALUE)throw 1;}`,
  String.raw`if(Math.pow(NaN,0)!==1||!Number.isNaN(Math.pow(1,Infinity))||!Number.isNaN(Math.pow(-2,.25)))throw 1;if(!Object.is(Math.pow(-0,3),-0)||Math.pow(-0,-3)!==-Infinity||Math.pow(-Infinity,-3)!==0||!Object.is(Math.pow(-Infinity,-3),-0))throw 2;if(Math.pow(1e300,1.5)!==Infinity||Math.pow(1e-300,1.5)!==0)throw 3;`,
  String.raw`let calls="";const a={valueOf(){calls+="a";return 9;}},b={valueOf(){calls+="b";return .5;}};if(Math.pow(a,b)!==3||calls!=="ab")throw 1;calls="";if(a**b!==3||calls!=="ab")throw 2;for(const f of [()=>Math.pow(1n,.5),()=>1n**.5,()=>Math.pow(NaN,Symbol())]){let caught=false;try{f();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 3;}`,
]);
