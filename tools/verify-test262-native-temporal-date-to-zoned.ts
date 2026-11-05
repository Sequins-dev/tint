import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainDate(1970,1,1);if(a.toZonedDateTime("+05:30").epochNanoseconds!==-19800000000000n||a.toZonedDateTime({timeZone:"+05:30",plainTime:"05:30:00.000000001"}).epochNanoseconds!==1n)throw 1;const z=new Temporal.ZonedDateTime(0n,"UTC");Object.defineProperty(z,"plainTime",{get(){throw 2;}});if(a.toZonedDateTime(z).epochNanoseconds!==0n)throw 3;`,
    String.raw`const a=new Temporal.PlainDate(1970,1,1);let log="";const b=a.toZonedDateTime({get timeZone(){log+="z";return "UTC";},get plainTime(){log+="t";return {get hour(){log+="h";return 1;}};}});if(log!=="zth"||b.hour!==1)throw 1;log="";let ok=false;try{a.toZonedDateTime({get timeZone(){log+="z";return 1;},get plainTime(){log+="t";throw 2;}});}catch(e){ok=e instanceof TypeError;}if(!ok||log!=="z")throw 3;`,
    String.raw`const a=new Temporal.PlainDate(275760,1,1).toZonedDateTime("UTC");let ok=false;try{a.add({months:5432,weeks:5432});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 1;class D extends Temporal.PlainDate{}const b=new D(1970,1,1).toZonedDateTime("UTC");if(!(b instanceof Temporal.ZonedDateTime))throw 2;`,
  ],
  { nodeReference: false },
);
