import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const i=new Temporal.Instant(-1n);if(i.add({nanoseconds:1}).epochNanoseconds!==0n||i.subtract("PT0.000000001S").epochNanoseconds!==-2n||i.add("PT1.03125H").epochNanoseconds!==3712499999999n)throw 1;if(i.add({nanoseconds:9007199254740992,microseconds:1}).epochNanoseconds!==9007199254741991n)throw 2;`,
    String.raw`const max=new Temporal.Instant(8640000000000000000000n),min=new Temporal.Instant(-8640000000000000000000n);for(const thunk of [()=>max.add({nanoseconds:1}),()=>min.subtract({nanoseconds:1}),()=>max.add({days:1}),()=>max.add({hours:1,seconds:-1}),()=>max.add({seconds:0.5})]){let ok=false;try{thunk();}catch(e){ok=e instanceof RangeError;}if(!ok)throw 1;}class I extends Temporal.Instant{}const i=new I(0n);if(i.add({seconds:1}) instanceof I||i.subtract({seconds:-1}).epochNanoseconds!==1000000000n)throw 2;let touched=false,ok=false;try{Temporal.Instant.prototype.add.call({}, {get seconds(){touched=true;return 1;}});}catch(e){ok=e instanceof TypeError;}if(!ok||touched)throw 3;`,
  ],
  { nodeReference: false },
);
