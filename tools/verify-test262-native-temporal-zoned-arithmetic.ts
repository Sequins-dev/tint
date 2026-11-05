import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=Temporal.ZonedDateTime.from("2020-01-31T23:30[+05:30]"),b=a.add({months:1,hours:2});if(b.month!==3||b.day!==1||b.hour!==1||b.minute!==30||b.timeZoneId!=="+05:30")throw 1;if(!a.add({nanoseconds:1}).subtract({nanoseconds:1}).equals(a))throw 2;let ok=false;try{a.add({months:1},{overflow:"reject"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 3;`,
    String.raw`class Z extends Temporal.ZonedDateTime{}const a=new Z(0n,"UTC");if(a.add("PT1.000000001S").epochNanoseconds!==1000000001n||a.subtract({hours:1}).epochNanoseconds!==-3600000000000n||a.add({hours:1}) instanceof Z)throw 1;let log="";a.add({get hours(){log+="h";return 1;}},{get overflow(){log+="o";return "constrain";}});if(log!=="ho")throw 2;`,
    String.raw`const upper=new Temporal.ZonedDateTime(8640000000000000000000n,"+01:00"),lower=new Temporal.ZonedDateTime(-8640000000000000000000n,"-01:00");for(const f of [()=>upper.add({nanoseconds:1}),()=>lower.subtract({nanoseconds:1}),()=>upper.add({nanoseconds:1},{overflow:"constrain"})]){let ok=false;try{f();}catch(e){ok=e instanceof RangeError;}if(!ok)throw 1;}if(upper.subtract({nanoseconds:1}).epochNanoseconds!==8639999999999999999999n)throw 2;`,
  ],
  { nodeReference: false },
);
