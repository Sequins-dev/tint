import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=Temporal.PlainDate.from("2046-10-30[u-ca=hebrew]"),b=Temporal.PlainDateTime.from("2046-10-30T12:34[u-ca=hebrew]");for(const d of[a,b])if(d.year!==5807||d.monthCode!=="M01"||d.day!==30)throw 1;if(Temporal.PlainDate.from({calendar:"hebrew",year:5807,month:1,day:1}).toString({calendarName:"never"})!=="2046-10-01")throw 2;`,
    String.raw`const valid=["2D3","2C5","2D5","2C7","3R5","3R7","5R7","5C1","5D1","5C3","7D1","7C3","7D3","7C5"];for(let year=3700;year<=5800;year++){const first=Temporal.PlainDate.from({calendar:"hebrew",year,monthCode:"M01",day:1}),pesach=Temporal.PlainDate.from({calendar:"hebrew",year,monthCode:"M07",day:15});const length=first.daysInYear,kind=length%10===3?"D":length%10===4?"R":"C",pattern=String(first.dayOfWeek%7+1)+kind+String(pesach.dayOfWeek%7+1);if(!valid.includes(pattern))throw 1;}`,
    String.raw`for(const year of[3705,5806,5807,5808,-114911,-102335,-3839,88370,186866,193151]){const a=Temporal.PlainDate.from({calendar:"hebrew",year,month:1,day:1}),b=a.add({years:1});if(![353,354,355,383,384,385].includes(a.daysInYear)||!a.add(a.until(b,{largestUnit:"year"})).equals(b)||!b.add(b.until(a,{largestUnit:"year"})).equals(a))throw 1;}`,
  ],
  { nodeReference: false },
);
