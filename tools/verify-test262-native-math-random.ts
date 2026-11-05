import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases([
  String.raw`let low=false,high=false;for(let i=0;i<512;i++){const n=Math.random();if(!(n>=0&&n<1)||!Number.isInteger(n*9007199254740992))throw 1;if(n<.5)low=true;else high=true;}if(!low||!high)throw 2;`,
  String.raw`const f=Math.random,d=Object.getOwnPropertyDescriptor(Math,"random");if(f.length!==0||f.name!=="random"||!d.writable||d.enumerable||!d.configurable)throw 1;const arg={valueOf(){throw 2;},toString(){throw 3;}};if(!(f.call(null,arg)>=0))throw 4;let caught=false;try{new f();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 5;`,
]);
