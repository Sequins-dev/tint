import { verifyNativeScriptCases } from "./native-script-fixture.ts";
const cases = [
  0, 946684800000, 1735689600000, 1720000000000, 1710053999000, 1710054000000,
  -1,
].map((time) => {
  const date = new Date(time);
  const expected = [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getDay(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
    date.getTimezoneOffset(),
  ];
  return `const d=new Date(${time}),actual=[d.getFullYear(),d.getMonth(),d.getDate(),d.getDay(),d.getHours(),d.getMinutes(),d.getSeconds(),d.getMilliseconds(),d.getTimezoneOffset()],expected=${JSON.stringify(expected)};for(let i=0;i<expected.length;i++)if(actual[i]!==expected[i])throw i+1;`;
});
cases.push(
  `if(!Number.isNaN(new Date(NaN).getTimezoneOffset()))throw 1;let caught=false;try{Date.prototype.getHours.call(new Proxy(new Date(0),{}));}catch(e){caught=e instanceof TypeError;}if(!caught)throw 2;`,
);
verifyNativeScriptCases(cases);
