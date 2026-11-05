import { verifyNativeScriptCases } from "./native-script-fixture.ts";
const parts: readonly (readonly number[])[] = [
  [2024, 0, 1, 12, 34, 56, 789],
  [99, 12, 0, 24],
  [2000, -1, 32, -1, 61, -1, 1001],
  [-271821, 3, 20],
  [275760, 8, 13],
  [275760, 8, 13, 0, 0, 0, 1],
  [1e100, 0],
  [2024, 2, 10, 2, 30, 0, 123],
  [2024, 10, 3, 1, 30, 0, 999],
];
const cases = parts.map((parts) => {
  const args = parts.map(String).join(","),
    expected = new Date(
      parts[0] ?? NaN,
      parts[1] ?? NaN,
      parts[2] ?? 1,
      parts[3] ?? 0,
      parts[4] ?? 0,
      parts[5] ?? 0,
      parts[6] ?? 0,
    ).getTime();
  return `if(!Object.is(new Date(${args}).getTime(),${String(expected)}))throw 1;`;
});
const expected = new Date(1970, 0, 1, 0, 0, 0, 123).getTime();
cases.push(
  `if(Date.parse("1970-01-01T00:00:00.123")!==${expected}||new Date("1970-01-01T00:00:00.123").getTime()!==${expected}||Date.parse("1970-01-01")!==0)throw 1;`,
);
cases.push(
  `let log="";function value(key,n){return{valueOf(){log+=key;return n;}};}const d=new Date(value("y",NaN),value("m",0),value("d",1),value("h",0),value("n",0),value("s",0),value("i",0));if(log!=="ymdhnsi"||!Number.isNaN(d.getTime()))throw 1;`,
);
cases.push(
  `class D extends Date{}const d=new D(2024,0,1);if(Object.getPrototypeOf(d)!==D.prototype||!(d instanceof Date)||d.getTime()!==new Date(2024,0,1).getTime())throw 1;for(let i=0;i<1024;i++){const x=new Date(2024,i%12,i%28+1,12,0,0,i%1000);if(Date.parse(x.toISOString())!==x.getTime())throw 2;}`,
);
verifyNativeScriptCases(cases);
