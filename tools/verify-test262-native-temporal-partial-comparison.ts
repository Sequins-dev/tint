import { verifyNativeScriptCases } from "./native-script-fixture.ts";
// https://tc39.es/proposal-temporal/#sec-temporal.plainyearmonth.compare
// Node's bootstrap runtime does not provide Temporal.
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.PlainYearMonth(2000,1,"iso8601",1),b=new Temporal.PlainYearMonth(2000,1,"iso8601",2);if(Temporal.PlainYearMonth.compare(a,b)!==-1||Temporal.PlainYearMonth.compare(b,a)!==1||Temporal.PlainYearMonth.compare(a,a)!==0||a.equals(b)||!a.equals("2000-01"))throw 1;`,
    String.raw`const a=new Temporal.PlainMonthDay(2,29,"iso8601",1972),b=new Temporal.PlainMonthDay(2,29,"iso8601",1976);if(a.equals(b)||!a.equals("02-29")||!a.equals(new Temporal.PlainMonthDay(2,29)))throw 1;`,
    String.raw`const a=new Temporal.PlainYearMonth(2000,1);for(const k of ["calendar","year","month","monthCode","day"])Object.defineProperty(a,k,{get(){throw 1;}});if(!a.equals(a)||Temporal.PlainYearMonth.compare(a,a)!==0)throw 2;const md=new Temporal.PlainMonthDay(1,1);for(const k of ["calendar","year","month","monthCode","day"])Object.defineProperty(md,k,{get(){throw 3;}});if(!md.equals(md))throw 4;`,
    String.raw`for(const C of [Temporal.PlainYearMonth,Temporal.PlainMonthDay]){let touched=false;try{C.prototype.equals.call({}, {get calendar(){touched=true;throw 1;}});throw 2;}catch(e){if(!(e instanceof TypeError)||touched)throw 3;}}const log=[];const one={get calendar(){log.push("one");throw 42;}},two={get calendar(){log.push("two");throw 43;}};try{Temporal.PlainYearMonth.compare(one,two);throw 1;}catch(e){if(e!==42||log.join()!=="one")throw 2;}`,
    String.raw`for(const [a,b] of [["-271821-04","+275760-09"],["1999-12","2000-01"],["2000-01","2000-02"]]){if(Temporal.PlainYearMonth.compare(a,b)!==-1||Temporal.PlainYearMonth.compare(b,a)!==1)throw 1;}for(const C of [Temporal.PlainYearMonth,Temporal.PlainMonthDay]){const a=C===Temporal.PlainYearMonth?new C(2000,1):new C(1,1);for(const value of [undefined,null,1,true,{},new Proxy(a,{})]){let ok=false;try{a.equals(value);}catch(e){ok=e instanceof TypeError;}if(!ok)throw 2;}}`,
  ],
  { nodeReference: false },
);
