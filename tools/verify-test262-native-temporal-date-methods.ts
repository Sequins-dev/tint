import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDate(2000,2,29);if(!d.equals("2000-02-29")||d.equals({year:2001,month:2,day:28})||!d.equals(new Temporal.PlainDateTime(2000,2,29,12)))throw 1;const copy=d.withCalendar("2000-01-01[u-ca=iso8601]");if(copy===d||!copy.equals(d))throw 2;const y=d.toPlainYearMonth(),m=d.toPlainMonthDay();if(y.toString()!=="2000-02"||y.toString({calendarName:"always"})!=="2000-02-01[u-ca=iso8601]"||m.toString({calendarName:"always"})!=="1972-02-29[u-ca=iso8601]")throw 3;`,
    String.raw`class D extends Temporal.PlainDate{}const d=new D(2020,3,2);Object.defineProperty(d,"constructor",{get(){throw 1;}});for(const name of ["year","month","monthCode","day","calendarId"])Object.defineProperty(d,name,{get(){throw 2;}});if(d.withCalendar("iso8601") instanceof D||d.toPlainYearMonth().year!==2020||d.toPlainMonthDay().day!==2||!d.equals("2020-03-02"))throw 3;const methods=["equals","withCalendar","toPlainYearMonth","toPlainMonthDay"];for(const name of methods){let called=false,ok=false;try{Temporal.PlainDate.prototype[name].call({}, {get calendar(){called=true;return "iso8601";}});}catch(e){ok=e instanceof TypeError;}if(!ok||called)throw 4;}let ok=false;try{d.withCalendar();}catch(e){ok=e instanceof TypeError;}if(!ok)throw 5;`,
  ],
  { nodeReference: false },
);
