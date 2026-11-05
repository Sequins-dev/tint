import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDate(2020,2,29);if(d.with({year:2021}).toString()!=="2021-02-28"||d.with({monthCode:"M03"}).toString()!=="2020-03-29"||d.with({month:4,day:31}).toString()!=="2020-04-30"||d.toString()!=="2020-02-29")throw 1;for(const fields of [{year:2021},{month:3,monthCode:"M04"},{monthCode:"M02L"}]){let ok=false;try{d.with(fields,{overflow:"reject"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;}class D extends Temporal.PlainDate{}if(new D(2020,1,1).with({day:2}) instanceof D)throw 3;`,
    String.raw`const d=new Temporal.PlainDate(2020,1,1);let log="";const fields={get calendar(){log+="c;";},get timeZone(){log+="z;";},get day(){log+="d;";return 2;},get month(){log+="m;";return 3;},get monthCode(){log+="M;";return "M03";},get year(){log+="y;";return 2021;}};const result=d.with(fields,{get overflow(){log+="o;";return "reject";}});if(log!=="c;z;d;m;M;y;o;"||result.toString()!=="2021-03-02")throw 1;log="";let ok=false;try{d.with({monthCode:"M03L"},{get overflow(){log+="o";return "constrain";}});}catch(e){ok=e instanceof RangeError;}if(!ok||log!=="o")throw 2;`,
    String.raw`const d=new Temporal.PlainDate(2020,1,1);for(const x of [null,1,"2021-01-01",{},d,new Temporal.PlainTime(1),{calendar:"iso8601",day:2},{timeZone:"UTC",day:2},{day:undefined}]){let ok=false;try{d.with(x);}catch(e){ok=e instanceof TypeError;}if(!ok)throw 1;}let calls=0;try{Temporal.PlainDate.prototype.with.call({}, {get calendar(){calls++;} });}catch(e){if(!(e instanceof TypeError))throw 2;}if(calls!==0)throw 3;`,
  ],
  { nodeReference: false },
);
