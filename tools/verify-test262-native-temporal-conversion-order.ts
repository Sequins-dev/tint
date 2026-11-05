import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDate(2020,1,1);for(const value of ["T15:23:30","t152330","T15:23:30[u-ca=iso8601]","2021-12","--02-29"]){if(d.withCalendar(value).calendarId!=="iso8601")throw 1;}`,
    String.raw`const i=new Temporal.Instant(0n);let touched=false,ok=false;try{i.toString({smallestUnit:"auto",get timeZone(){touched=true;return "UTC";}});}catch(e){ok=e instanceof RangeError;}if(!ok||!touched)throw 1;touched=false;ok=false;try{i.toString({smallestUnit:"auto",get timeZone(){touched=true;return 1;}});}catch(e){ok=e instanceof TypeError;}if(!ok||!touched)throw 2;`,
    String.raw`const i=new Temporal.Instant(0n);let touched=false,ok=false;try{i.toString({smallestUnit:"femtosecond",get timeZone(){touched=true;return "UTC";}});}catch(e){ok=e instanceof RangeError;}if(!ok||touched)throw 1;`,
  ],
  { nodeReference: false },
);
