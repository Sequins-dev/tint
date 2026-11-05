import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainDateTime(1970,1,1,5,30,0,0,0,1);const b=a.toZonedDateTime("+05:30");if(b.epochNanoseconds!==1n||b.timeZoneId!=="+05:30"||b.hour!==5)throw 1;const z=new Temporal.ZonedDateTime(0n,"+05:30");Object.defineProperty(z,"timeZoneId",{get(){throw 2;}});if(a.toZonedDateTime(z).epochNanoseconds!==1n)throw 3;`,
    String.raw`const a=new Temporal.PlainDateTime(1970,1,1);let log="";const b=a.toZonedDateTime("UTC",{get disambiguation(){log+="d";return {toString(){log+="s";return "later";}};},get offset(){throw 1;},get overflow(){throw 2;}});if(log!=="ds"||b.epochNanoseconds!==0n)throw 3;let ok=false;try{a.toZonedDateTime("UTC",{disambiguation:"invalid"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 4;`,
    String.raw`class D extends Temporal.PlainDateTime{}const a=new D(1970,1,1);if(!(a.toZonedDateTime("UTC") instanceof Temporal.ZonedDateTime))throw 1;const b=new Temporal.PlainDateTime(275760,9,13,23,59);if(b.toZonedDateTime("+23:59").epochNanoseconds!==8640000000000000000000n)throw 2;let ok=false;try{b.toZonedDateTime("UTC");}catch(e){ok=e instanceof RangeError;}if(!ok)throw 3;`,
  ],
  { nodeReference: false },
);
