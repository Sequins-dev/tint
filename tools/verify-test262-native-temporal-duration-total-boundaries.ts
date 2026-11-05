import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`if(new Temporal.Duration(0,1,0,0,10).total({unit:"month",relativeTo:new Temporal.PlainDate(2020,1,31)})!==1.0134408602150538)throw 1;`,
    String.raw`const d=new Temporal.Duration();if(d.total({unit:"day",relativeTo:"+275760-09-12T00:00:00+00:00[UTC]"})!==0)throw 1;let ok=false;try{d.total({unit:"day",relativeTo:"+275760-09-12T00:00:01+00:00[UTC]"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;`,
  ],
  { nodeReference: false },
);
