import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDateTime(2000,2,29,12,34,56,987,654,321);if(d.toPlainDate().toString()!=="2000-02-29"||d.toPlainTime().toString()!=="12:34:56.987654321"||!d.equals("2000-02-29T12:34:56.987654321")||d.equals("2000-02-29T12:34:56.987654320"))throw 1;const copy=d.withCalendar("2000-01-01[u-ca=iso8601]");if(copy===d||!copy.equals(d))throw 2;class D extends Temporal.PlainDateTime{}const sub=new D(2020,3,2,12);Object.defineProperty(sub,"constructor",{get(){throw 3;}});for(const name of ["year","month","day","hour","minute","second","calendarId"])Object.defineProperty(sub,name,{get(){throw 4;}});if(sub.withCalendar("iso8601") instanceof D||sub.toPlainTime().hour!==12||sub.toPlainDate().year!==2020)throw 5;`,
    String.raw`const names=["equals","withCalendar","toPlainDate","toPlainTime"];for(const name of names){let touched=false,ok=false;try{Temporal.PlainDateTime.prototype[name].call({}, {get calendar(){touched=true;return "iso8601";}});}catch(e){ok=e instanceof TypeError;}if(!ok||touched)throw 1;}if(Temporal.PlainTime.compare("23:59:59.999999999","00:00")!==1||Temporal.PlainDateTime.compare("1999-12-31T23:59:59.999999999","2000-01-01")!==-1)throw 2;`,
  ],
  { nodeReference: false },
);
