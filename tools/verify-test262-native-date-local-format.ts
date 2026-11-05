import { verifyNativeScriptCases } from "./native-script-fixture.ts";
const cases = [
  0, -2208988800000, -8640000000000000, 8640000000000000, 946684800000,
  1720000000000,
].map((time) => {
  const date = new Date(time),
    text = date.toString().split(" (")[0],
    clock = date.toTimeString().split(" (")[0];
  return `const d=new Date(${time});if(!d.toString().startsWith(${JSON.stringify(text)})||d.toDateString()!==${JSON.stringify(date.toDateString())}||!d.toTimeString().startsWith(${JSON.stringify(clock)}))throw 1;if(Date.parse(d.toString())!==${time}||new Date(d.toString()).getTime()!==${time})throw 2;`;
});
cases.push(
  `const before=Date.now(),text=Date({toString(){throw 1;}}),after=Date.now();if(typeof text!=="string")throw 2;const t=Date.parse(text);if(t<Math.floor(before/1000)*1000||t>after)throw 3;if(new Date(NaN).toDateString()!=="Invalid Date"||new Date(NaN).toTimeString()!=="Invalid Date")throw 4;`,
);
// Node supplies formatting expectations, but cannot round trip all of its own
// historical strings (offset seconds and negative years). Tint preserves those.
verifyNativeScriptCases(cases, { nodeReference: false });
