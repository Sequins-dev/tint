import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainDate(2020,1,1),b=new Temporal.PlainDate(2021,2,3);const d=a.until(b,{largestUnit:"year",smallestUnit:"week",roundingMode:"halfExpand"});if(d.years!==1||d.months!==1||d.weeks!==0||d.days!==0)throw 1;`,
    String.raw`const a=new Temporal.PlainDate(2019,1,1),b=new Temporal.PlainDate(2020,1,10);const d=a.until(b,{largestUnit:"year",smallestUnit:"month",roundingMode:"halfExpand"});if(d.years!==1||d.months!==0||d.days!==0)throw 1;`,
    String.raw`const a=new Temporal.PlainDate(2019,1,1),b=new Temporal.PlainDate(2019,2,15);const modes=["ceil","floor","expand","trunc","halfCeil","halfFloor","halfExpand","halfTrunc","halfEven"],positive=[2,1,2,1,2,1,2,1,2],negative=[-1,-2,-2,-1,-1,-2,-2,-1,-2];for(let i=0;i<modes.length;i++){if(a.until(b,{smallestUnit:"month",roundingMode:modes[i]}).months!==positive[i]||a.since(b,{smallestUnit:"month",roundingMode:modes[i]}).months!==negative[i])throw 1;}`,
  ],
  { nodeReference: false },
);
