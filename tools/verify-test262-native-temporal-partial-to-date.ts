import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.prototype.toplaindate
// The bootstrap Node runtime does not provide Temporal.
verifyNativeScriptCases(
  [
    String.raw`const ym=new Temporal.PlainYearMonth(2023,2,"iso8601",7);const d=ym.toPlainDate({day:29});if(d.toString()!=="2023-02-28"||Object.getPrototypeOf(d)!==Temporal.PlainDate.prototype)throw 1;const md=new Temporal.PlainMonthDay(2,29);if(md.toPlainDate({year:2023}).toString()!=="2023-02-28"||md.toPlainDate({year:2024}).toString()!=="2024-02-29")throw 2;`,
    String.raw`const log=[];const fields={get day(){log.push("day");return{valueOf(){log.push("number");return 2.9;}}},get year(){throw 1;},get month(){throw 2;},get calendar(){throw 3;}};if(new Temporal.PlainYearMonth(2000,1).toPlainDate(fields).day!==2||log.join()!=="day,number")throw 4;const md=new Temporal.PlainMonthDay(5,2);if(md.toPlainDate({get year(){return 2001.9;},get day(){throw 5;},get calendar(){throw 6;}}).year!==2001)throw 7;`,
    String.raw`const lo=new Temporal.PlainYearMonth(-271821,4),hi=new Temporal.PlainYearMonth(275760,9);if(lo.toPlainDate({day:19}).day!==19||hi.toPlainDate({day:13}).day!==13)throw 1;for(const [ym,day]of[[lo,18],[hi,14]]){let ok=false;try{ym.toPlainDate({day});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;}for(const C of[Temporal.PlainYearMonth,Temporal.PlainMonthDay]){let touched=false,ok=false;try{C.prototype.toPlainDate.call({}, {get day(){touched=true;return 1;},get year(){touched=true;return 2000;}});}catch(e){ok=e instanceof TypeError;}if(!ok||touched)throw 3;const x=C===Temporal.PlainYearMonth?new C(2000,1):new C(1,1);for(const value of[undefined,null,1,true,"2000-01-01",{}]){let rejected=false;try{x.toPlainDate(value);}catch(e){rejected=e instanceof TypeError;}if(!rejected)throw 4;}}`,
  ],
  { nodeReference: false },
);
