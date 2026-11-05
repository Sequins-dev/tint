import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=Date.now(),d=new Date(),b=Date.now();if(!Number.isInteger(a)||a<1700000000000||a>2200000000000||d.getTime()<a||d.getTime()>b)throw 1;const child=$262.createRealm();const now=child.global.Date.now();if(Math.abs(now-b)>10000)throw 2;`,
    String.raw`const d=new Date();if(!Number.isFinite(d.getTime()))throw 1;const p=Object.getPrototypeOf(d);if(p!==Date.prototype)throw 2;if(new Date(undefined).getTime()===0)throw 3;`,
  ],
  { nodeReference: false },
);
