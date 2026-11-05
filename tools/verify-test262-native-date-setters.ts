import { verifyNativeScriptCases } from "./native-script-fixture.ts";
const operations = [
  { name: "setFullYear", args: [2025, 1, 28] },
  { name: "setMonth", args: [13, 0] },
  { name: "setDate", args: [0] },
  { name: "setHours", args: [25, 61, 61, 1001] },
  { name: "setMinutes", args: [90, 61, 1001] },
  { name: "setSeconds", args: [90, 1001] },
  { name: "setMilliseconds", args: [1001] },
  { name: "setYear", args: [99] },
] as const;
const cases = operations.map(({ name, args }) => {
  const date = new Date(2024, 0, 15, 12, 34, 56, 789),
    start = date.getTime();
  const method = Reflect.get(date, name);
  if (typeof method !== "function")
    throw new Error("Missing Node reference method: " + name);
  const expected = Reflect.apply(method, date, args);
  return `const d=new Date(${start});if(!Object.is(d.${name}(${args.join(",")}),${String(expected)})||!Object.is(d.getTime(),${String(expected)}))throw 1;`;
});
cases.push(
  `const d=new Date(0);const n={valueOf(){d.setTime(NaN);return 1;}};if(d.setSeconds(n)!==1000||d.getTime()!==1000)throw 1;d.setTime(NaN);const change={valueOf(){d.setTime(123);return 0;}};if(!Number.isNaN(d.setSeconds(change))||d.getTime()!==123)throw 2;`,
);
cases.push(
  `const d=new Date(NaN),year={valueOf(){d.setTime(123456789);return 2000;}};if(d.setFullYear(year)!==new Date(2000,0,1).getTime())throw 1;d.setTime(NaN);const marker={},hour={valueOf(){d.setTime(123);return NaN;}},minute={valueOf(){throw marker;}};let caught=false;try{d.setHours(hour,minute);}catch(e){caught=e===marker;}if(!caught||d.getTime()!==123)throw 2;`,
);
cases.push(
  `const d=new Date(0),month=d.getMonth(),day=d.getDate();d.setYear(99);if(d.getFullYear()!==1999||d.getMonth()!==month||d.getDate()!==day)throw 1;if(d.getYear()!==99)throw 2;const y={valueOf(){d.setTime(123);return NaN;}};if(!Number.isNaN(d.setYear(y))||!Number.isNaN(d.getTime()))throw 3;`,
);
const start = new Date(2024, 2, 10, 1, 30, 0, 123),
  changed = new Date(start.getTime());
changed.setHours(2);
cases.push(
  `const d=new Date(${start.getTime()});if(d.setHours(2)!==${changed.getTime()}||d.getTime()!==${changed.getTime()})throw 1;`,
);
verifyNativeScriptCases(cases, { nodeReference: false });
