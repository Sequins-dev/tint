import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Date(-1);if(d.getTime()!==-1||d.getUTCFullYear()!==1969||d.getUTCMonth()!==11||d.getUTCDate()!==31||d.getUTCDay()!==3||d.getUTCHours()!==23||d.getUTCMinutes()!==59||d.getUTCSeconds()!==59||d.getUTCMilliseconds()!==999)throw 1;if(Object.prototype.toString.call(d)!=="[object Date]")throw 2;`,
    String.raw`if(Date.UTC(99,12,0,24)!==Date.UTC(2000,0,1))throw 1;const d=new Date(8640000000000000);if(d.getUTCFullYear()!==275760||d.getUTCMonth()!==8||d.getUTCDate()!==13)throw 2;if(!Number.isNaN(new Date(8640000000000001).valueOf()))throw 3;`,
    String.raw`const d=new Date(-0.5);if(!Object.is(d.getTime(),0))throw 1;d.valueOf=()=>{throw 2;};const e=new Date(d);if(e.getTime()!==0)throw 3;let caught=false;try{Date.prototype.getTime.call(new Proxy(e,{}));}catch(e){caught=e instanceof TypeError;}if(!caught)throw 4;caught=false;try{Date.prototype.getTime();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 5;`,
    String.raw`const d=new Date(0);if(d.setTime(1.9)!==1||d.getTime()!==1)throw 1;let order="";const n={valueOf(){order+="y";return NaN;}},m={valueOf(){order+="m";return 0;}};if(!Number.isNaN(Date.UTC(n,m))||order!=="ym")throw 2;`,
    String.raw`const d=new Date(NaN);if(!Number.isNaN(d.setUTCMonth(1)))throw 1;if(d.setUTCFullYear(2000,1,29)!==Date.UTC(2000,1,29))throw 2;if(d.setUTCDate(0)!==Date.UTC(2000,0,31))throw 3;if(d.setUTCHours(25,61,61,1001)!==Date.UTC(2000,1,1,2,2,2,1))throw 4;`,
    String.raw`const d=new Date(0);const x={valueOf(){d.setTime(1000000000000);return 2;}};if(d.setUTCSeconds(x)!==2000||d.getTime()!==2000)throw 1;let order="";d.setTime(NaN);d.setUTCHours({valueOf(){order+="h";return NaN;}},{valueOf(){order+="m";return 1;}});if(order!=="hm")throw 2;d.setTime(NaN);const change={valueOf(){d.setTime(123);return 0;}};if(!Number.isNaN(d.setUTCMonth(change))||d.getTime()!==123)throw 3;`,
  ],
  { nodeReference: false },
);
