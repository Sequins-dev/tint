import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.PlainDateTime(2020,2,29,12,34,56,987,654,321);if(d.year!==2020||d.month!==2||d.day!==29||d.hour!==12||d.minute!==34||d.second!==56||d.millisecond!==987||d.microsecond!==654||d.nanosecond!==321||d.dayOfYear!==60||!d.inLeapYear)throw 1;if(d.toString()!=="2020-02-29T12:34:56.987654321"||d.toJSON()!==d.toString())throw 2;if(Temporal.PlainDate.from(d).toString()!=="2020-02-29"||Temporal.PlainDate.from({year:1976,month:11,day:18,calendar:d}).year!==1976)throw 3;`,
    String.raw`for(const args of [[-271821,4,19],[275760,9,14],[2020,2,30],[2020,1,1,24],[2020,1,1,0,60],[2020,1,1,0,0,60],[2020,1,1,0,0,0,1000]]){let caught=false;try{new Temporal.PlainDateTime(...args);}catch(e){caught=e instanceof RangeError;}if(!caught)throw 1;}if(new Temporal.PlainDateTime(-271821,4,19,0,0,0,0,0,1).nanosecond!==1||new Temporal.PlainDateTime(275760,9,13,23,59,59,999,999,999).hour!==23)throw 2;`,
    String.raw`class D extends Temporal.PlainDateTime{}const d=new D(2000,5,2,12);if(!(d instanceof D)||d.toString()!=="2000-05-02T12:00:00")throw 1;for(const name of ["year","hour"]){const getter=Object.getOwnPropertyDescriptor(Temporal.PlainDateTime.prototype,name).get;let caught=false;try{getter.call(new Proxy(d,{}));}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;}for(const name of ["year","month","day","calendarId"])Object.defineProperty(d,name,{get(){throw 3;}});if(Temporal.PlainDate.from(d).toString()!=="2000-05-02")throw 4;let caught=false;try{Temporal.PlainDateTime();}catch(e){caught=e instanceof TypeError;}if(!caught)throw 5;`,
  ],
  { nodeReference: false },
);
