import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDate(2020,2,29);if(d.add({years:1}).toString()!=="2021-02-28"||d.add({years:1,months:1},{overflow:"reject"}).toString()!=="2021-03-29"||d.subtract({days:1,hours:47}).toString()!=="2020-02-27"||d.add({hours:23}).toString()!=="2020-02-29")throw 1;let ok=false;try{d.add({years:1},{overflow:"reject"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;class D extends Temporal.PlainDate{}if(new D(2020,1,1).add("P1D") instanceof D)throw 3;`,
    String.raw`const d=new Temporal.PlainDateTime(2020,1,31,23,59,59,999,999,999);if(d.add({months:1,nanoseconds:1}).toString()!=="2020-03-01T00:00:00"||new Temporal.PlainDateTime(2020,3,1).subtract({nanoseconds:1}).toString()!=="2020-02-29T23:59:59.999999999")throw 1;if(new Temporal.PlainDateTime(2020,1,1,12).add({hours:-24}).toString()!=="2019-12-31T12:00:00")throw 2;`,
    String.raw`let log="",ok=false;try{new Temporal.PlainDate(2020,2,29).add({get years(){log+="y;";return 1;}},{get overflow(){log+="o;";return "reject";}});}catch(e){ok=e instanceof RangeError;}if(!ok||log!=="y;o;")throw 1;for(const d of [new Temporal.PlainDate(275760,9,13),new Temporal.PlainDateTime(275760,9,13,23,59,59,999,999,999)]){ok=false;try{d.add({days:1});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;}`,
  ],
  { nodeReference: false },
);
