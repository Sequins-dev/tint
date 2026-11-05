import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const t=new Temporal.PlainTime(12,34,56,123,456,789);const x=t.with({minute:42,microsecond:999});if(x.toString()!=="12:42:56.123999789"||t.toString()!=="12:34:56.123456789"||t.with({hour:99}).hour!==23)throw 1;class T extends Temporal.PlainTime{}const s=new T(12);if(s.with({minute:3}) instanceof T)throw 2;let ok=false;try{t.with({hour:24},{overflow:"reject"});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 3;`,
    String.raw`let log="";const t=new Temporal.PlainTime(12);const bag={get calendar(){log+="c;";return undefined;},get timeZone(){log+="z;";return undefined;},get hour(){log+="h;";return {valueOf(){log+="hv;";return 5;}};},get microsecond(){log+="u;";return undefined;},get millisecond(){log+="l;";return undefined;},get minute(){log+="m;";return 30;},get nanosecond(){log+="n;";return undefined;},get second(){log+="s;";return undefined;}};const x=t.with(bag,{get overflow(){log+="o;";return "constrain";}});if(log!=="c;z;h;hv;u;l;m;n;s;o;"||x.hour!==5||x.minute!==30)throw 1;`,
    String.raw`const t=new Temporal.PlainTime(12);for(const value of [null,1,"12:00",{},new Temporal.PlainTime(1),new Temporal.PlainDate(2020,1,1),{hour:1,calendar:"iso8601"},{hour:1,timeZone:"UTC"}]){let ok=false;try{t.with(value);}catch(e){ok=e instanceof TypeError;}if(!ok)throw 1;}let touched=false,ok=false;try{t.with({}, {get overflow(){touched=true;return "constrain";}});}catch(e){ok=e instanceof TypeError;}if(!ok||touched)throw 2;const proxy=new Proxy(new Temporal.PlainTime(1),{get(target,key){if(key==="hour")return 4;return undefined;}});if(t.with(proxy).hour!==4)throw 3;`,
  ],
  { nodeReference: false },
);
