import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`const a=new Temporal.Duration(0,0,0,0,0,0,0,0,18446744073709552,616),b=new Temporal.Duration(0,0,0,0,0,0,0,0,18446744073709552,617);if(Temporal.Duration.compare(a,b)!==-1||Temporal.Duration.compare(b,a)!==1||Temporal.Duration.compare(a,a)!==0)throw 1;`,
    String.raw`if(Temporal.Duration.compare({years:1},{days:366},{relativeTo:"2020-01-01"})!==0||Temporal.Duration.compare({years:1},{days:366},{relativeTo:"2021-01-01"})!==-1||Temporal.Duration.compare({years:1},{years:1})!==0)throw 1;let ok=false;try{Temporal.Duration.compare({years:1},{days:365});}catch(e){ok=e instanceof RangeError;}if(!ok)throw 2;`,
    String.raw`let log="";const a={get hours(){log+="a";return 1;}},b={get minutes(){log+="b";return 60;}};if(Temporal.Duration.compare(a,b,{get relativeTo(){log+="r";return new Temporal.ZonedDateTime(0n,"UTC");}})!==0||log!=="abr")throw 1;`,
  ],
  { nodeReference: false },
);
