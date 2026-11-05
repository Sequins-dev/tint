import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`for(const [text,want] of [["-PT1.03125H","-PT1H1M52.5S"],["PT0.999999999H","PT59M59.9999964S"],["P1DT0,5M","P1DT30S"],["pt71.50040904s","PT71.50040904S"]]){if(Temporal.Duration.from(text).toString()!==want)throw 1;}for(const text of ["P","PT","P1DT","PT1.5H0S","PT1.1234567890S","P1Y1Y","P1.5D"]){let ok=false;try{Temporal.Duration.from(text);}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;}const d=Temporal.Duration.from({hours:1,minutes:2,seconds:3,milliseconds:4});if(d.toString()!=="PT1H2M3.004S")throw 3;`,
    String.raw`let log="";const names=["days","hours","microseconds","milliseconds","minutes","months","nanoseconds","seconds","weeks","years"],bag={};for(const name of names)Object.defineProperty(bag,name,{get(){log+=name+";";return {valueOf(){log+="v;";return 1;}};}});Temporal.Duration.from(bag);if(log!==names.map(x=>x+";v;").join(""))throw 1;const d=new Temporal.Duration(1);for(const name of names)Object.defineProperty(d,name,{get(){throw 2;}});if(Temporal.Duration.from(d)===d||Temporal.Duration.from(d).years!==1)throw 3;class D extends Temporal.Duration{}if(D.from("P1Y") instanceof D)throw 4;for(const value of [{}, {days:undefined}, 2, null, {days:1,hours:-1}, {seconds:0.5}]){let ok=false;try{Temporal.Duration.from(value);}catch(e){ok=e instanceof TypeError||e instanceof RangeError;}if(!ok)throw 5;}`,
  ],
  { nodeReference: false },
);
