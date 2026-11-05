import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    String.raw`for(const zone of ["+00","-00","+12","-23","+0130","-01:30"]){if(Temporal.Instant.from("1976-11-18T15:23:30.123456789Z["+zone+"]").epochNanoseconds!==217178610123456789n||Temporal.PlainTime.from("12:34["+zone+"]").hour!==12||Temporal.PlainYearMonth.from("1976-11["+zone+"]").month!==11||Temporal.PlainMonthDay.from("02-29["+zone+"]").day!==29)throw 1;}`,
  ],
  { nodeReference: false },
);
