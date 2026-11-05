import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`let log="";const d=new Temporal.Duration(0,0,0,0,1,59,59,900);const result=d.toString({get fractionalSecondDigits(){log+="f";return 0;},get roundingMode(){log+="r";return "expand";},get smallestUnit(){log+="s";return undefined;}});if(result!=="PT2H0S"||log!=="frs")throw 1;if(d.negated().toString({fractionalSecondDigits:0,roundingMode:"expand"})!=="-PT2H0S")throw 2;`,
    String.raw`const d=new Temporal.Duration(1,11,0,30,23,59,59,999,999,999);if(d.toString({fractionalSecondDigits:8,roundingMode:"expand"})!=="P1Y11M31DT0.00000000S")throw 1;if(new Temporal.Duration(1).toString({fractionalSecondDigits:3})!=="P1YT0.000S")throw 2;if(new Temporal.Duration(0,0,0,0,0,0,59,900).toString({smallestUnit:"second",roundingMode:"expand"})!=="PT60S")throw 3;`,
    String.raw`let count=0;for(const options of [null,true,1,"second",{smallestUnit:"minute"},{smallestUnit:"hour"},{smallestUnit:"auto"},{fractionalSecondDigits:10},{fractionalSecondDigits:-1}]){try{new Temporal.Duration().toString(options);}catch(e){if(e instanceof TypeError||e instanceof RangeError)count++;}}if(count!==9)throw count;`,
  ],
  { nodeReference: false },
);
