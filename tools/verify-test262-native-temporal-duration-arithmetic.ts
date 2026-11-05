import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.Duration(0,0,0,1,23),b=new Temporal.Duration(0,0,0,0,2);const d=a.add(b);if(d.days!==2||d.hours!==1)throw 1;const x=new Temporal.Duration(0,0,0,0,23).add(b);if(x.days!==0||x.hours!==25)throw 2;`,
    String.raw`const d=new Temporal.Duration(0,0,0,1).subtract({hours:25});if(d.days!==0||d.hours!==-1)throw 1;let ok=false;try{new Temporal.Duration(1).add({days:1});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;`,
    String.raw`const a=new Temporal.Duration(0,0,0,0,0,0,0,0,18446744073709552,616),b=a.add({microseconds:1});if(b.microseconds!==18446744073709552||b.nanoseconds!==616)throw 1;`,
  ],
  { nodeReference: false },
);
