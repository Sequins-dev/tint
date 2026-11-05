import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  String.raw`if(Math.exp(0)!==1||Math.exp(-0)!==1||Math.exp(Infinity)!==Infinity||Math.exp(-Infinity)!==0||!Number.isNaN(Math.exp(NaN)))throw 1;for(const value of [-0,0,NaN,Infinity])if(!Object.is(Math.expm1(value),value))throw 2;if(Math.expm1(-Infinity)!==-1)throw 3;`,
  String.raw`for(const pair of [[1,2.718281828459045],[-1,0.36787944117144233],[700,1.0142320547350045e304],[-700,9.85967654375977e-305],[-745,Number.MIN_VALUE]]){const actual=Math.exp(pair[0]);if(Math.abs(actual-pair[1])>4*Number.EPSILON*pair[1]+Number.MIN_VALUE)throw 1;}if(Math.exp(710)!==Infinity||Math.exp(-746)!==0)throw 2;`,
  String.raw`for(const value of [Number.MIN_VALUE,-Number.MIN_VALUE,1e-100,-1e-100,1e-20,-1e-20])if(Math.expm1(value)!==value)throw 1;for(const pair of [[0.5,0.6487212707001282],[-0.5,-0.3934693402873666]])if(Math.abs(Math.expm1(pair[0])/pair[1]-1)>4*Number.EPSILON)throw 2;`,
  String.raw`for(const name of ["exp","expm1"]){const f=Math[name],d=Object.getOwnPropertyDescriptor(Math,name);if(f.name!==name||f.length!==1||d.enumerable||!d.configurable||!d.writable)throw 1;for(const value of [1n,Symbol()]){let caught=false;try{f(value);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;}let calls=0;f({valueOf(){calls++;return 1;}});if(calls!==1)throw 3;}`,
]);
