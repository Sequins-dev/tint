import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`for(const zone of ["UTC","+05:30","-02:00"]){const z=new Temporal.ZonedDateTime(0n,zone);for(const direction of ["next","previous"]){if(z.getTimeZoneTransition(direction)!==null||z.getTimeZoneTransition({direction})!==null)throw 1;}for(const value of [undefined,null,1,true]){let caught=false;try{z.getTimeZoneTransition(value);}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;}for(const value of ["",{},Object.create(null),{direction:undefined},{direction:""},{direction:1}]){let caught=false;try{z.getTimeZoneTransition(value);}catch(e){caught=e instanceof RangeError;}if(!caught)throw 3;}}`,
    String.raw`const a=Temporal.ZonedDateTime.from("2024-07-01T00:00[America/New_York]");const next=a.getTimeZoneTransition("next"),prev=a.getTimeZoneTransition("previous");if(next.epochNanoseconds!==1730613600000000000n||prev.epochNanoseconds!==1710054000000000000n)throw 1;if(prev.getTimeZoneTransition("next").epochNanoseconds!==next.epochNanoseconds)throw 2;if(new Temporal.ZonedDateTime(prev.epochNanoseconds+1n,"America/New_York").getTimeZoneTransition("previous").epochNanoseconds!==prev.epochNanoseconds)throw 3;`,
  ],
  { nodeReference: false },
);
