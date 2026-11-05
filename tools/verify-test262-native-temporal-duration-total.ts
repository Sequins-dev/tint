import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const d=new Temporal.Duration(0,0,0,1,12);if(d.total("hour")!==36||d.total("day")!==1.5||d.negated().total("day")!==-1.5)throw 1;const x=new Temporal.Duration(0,0,0,0,0,0,0,0,0,9007199254740993);if(x.total("nanosecond")!==9007199254740992)throw 2;`,
    String.raw`const a=new Temporal.Duration(1);if(a.total({unit:"day",relativeTo:"2020-01-01"})!==366||a.total({unit:"day",relativeTo:"2021-01-01"})!==365)throw 1;const b=new Temporal.Duration(0,0,0,45);if(b.total({unit:"month",relativeTo:"2019-01-01"})!==1.5)throw 2;`,
    String.raw`let log="";const d=new Temporal.Duration(0,0,0,0,1);const bag={get calendar(){log+="c";return "iso8601";},get day(){log+="d";return 1;},get hour(){log+="h";return 5;},get microsecond(){log+="u";return 0;},get millisecond(){log+="l";return 0;},get minute(){log+="i";return 30;},get month(){log+="m";return 1;},get monthCode(){log+="M";return "M01";},get nanosecond(){log+="n";return 0;},get offset(){log+="o";return "+05:30";},get second(){log+="s";return 0;},get timeZone(){log+="z";return "+05:30";},get year(){log+="y";return 1970;}};if(d.total({get relativeTo(){log+="r";return bag;},get unit(){log+="U";return "minute";}})!==60||log!=="rcdhulimMnoszyU")throw 1;`,
    String.raw`const d=new Temporal.Duration(0,0,0,0,1);const date=new Temporal.PlainDateTime(2020,2,29,23,59);Object.defineProperty(date,"year",{get(){throw 1;}});if(d.total({unit:"hour",relativeTo:date})!==1)throw 2;const z=new Temporal.ZonedDateTime(0n,"UTC");Object.defineProperty(z,"epochNanoseconds",{get(){throw 3;}});if(d.total({unit:"minute",relativeTo:z})!==60)throw 4;`,
    String.raw`const d=new Temporal.Duration(1);let ok=false;try{d.total("day");}catch(e){ok=e instanceof RangeError;}if(!ok)throw 1;ok=false;try{d.total({unit:"day",relativeTo:"2020-01-01T00:00Z"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;const t=new Temporal.Duration(0,0,0,0,0,0,0,0,1,500);if(t.total({unit:"microsecond",relativeTo:new Temporal.ZonedDateTime(0n,"UTC")})!==1.5)throw 3;`,
  ],
  { nodeReference: false },
);
