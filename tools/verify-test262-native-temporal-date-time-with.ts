import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDateTime(2020,2,29,12,34,56,987,654,321);if(d.with({year:2021}).toString()!=="2021-02-28T12:34:56.987654321"||d.with({monthCode:"M03",microsecond:2}).toString()!=="2020-03-29T12:34:56.987002321"||d.with({hour:99,nanosecond:-1}).toString()!=="2020-02-29T23:34:56.987654")throw 1;let ok=false;try{d.with({hour:24},{overflow:"reject"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;class D extends Temporal.PlainDateTime{}if(new D(2020,1,1).with({minute:1}) instanceof D)throw 3;`,
    String.raw`const d=new Temporal.PlainDateTime(2020,1,1);let log="";const fields=new Proxy({day:2,hour:3,microsecond:4,millisecond:5,minute:6,month:7,monthCode:"M07",nanosecond:8,second:9,year:2021},{get(t,k){log+=k+";";return t[k];}});const x=d.with(fields,{get overflow(){log+="overflow;";return "reject";}});if(log!=="calendar;timeZone;day;hour;microsecond;millisecond;minute;month;monthCode;nanosecond;second;year;overflow;"||x.toString()!=="2021-07-02T03:06:09.005004008")throw 1;`,
    String.raw`const d=new Temporal.PlainDateTime(2020,1,1);for(const fields of [{},{hour:undefined},d,{calendar:"iso8601",hour:2},{timeZone:"UTC",hour:2}]){let ok=false;try{d.with(fields);}catch(e){ok=e instanceof TypeError;}if(!ok)throw 1;}let ok=false;try{new Temporal.PlainDateTime(-271821,4,19,0,0,0,0,0,1).with({nanosecond:0});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;`,
  ],
  { nodeReference: false },
);
