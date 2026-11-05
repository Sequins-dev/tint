import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    `const f=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});if(f.formatRange(3,5)!=="$3 – $5"||f.formatRange(2.9,3.1)!=="~$3")throw 1;const p=f.formatRangeToParts(3,5);if(p.length!==5||p[0].source!=="startRange"||p[2].value!==" – "||p[2].source!=="shared"||p[3].source!=="endRange")throw 2;for(const x of p){if(Object.getPrototypeOf(x)!==Object.prototype||!Object.getOwnPropertyDescriptor(x,"source").enumerable)throw 3;}`,
    `const f=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",signDisplay:"always"});if(f.formatRange(2.9,3.1)!=="+$2.90–3.10")throw 1;const p=f.formatRangeToParts(2.9,3.1);if(p[0].type!=="plusSign"||p[1].type!=="currency"||p[0].source!=="shared"||p[1].source!=="shared")throw 2;`,
    `const f=new Intl.NumberFormat("pt-PT",{style:"currency",currency:"EUR",maximumFractionDigits:0});if(f.formatRange(3,5)!=="3 - 5 €")throw 1;const p=f.formatRangeToParts(3,5);if(p[p.length-1].type!=="currency"||p[p.length-1].source!=="shared"||p[p.length-2].source!=="shared")throw 2;`,
    `const f=new Intl.NumberFormat("en");if(f.formatRange(-3,-1)!=="-3 – -1"||f.formatRange(3,-1)!=="3–-1"||f.formatRange(-3,1)!=="-3 – 1")throw 1;if(f.formatRange("987654321987654321","987654321987654322")!=="987,654,321,987,654,321–987,654,321,987,654,322")throw 2;const hidden=new Intl.NumberFormat("en",{signDisplay:"never"});if(hidden.formatRange(-Infinity,Infinity)!=="~∞")throw 3;`,
    `const f=new Intl.NumberFormat("en",{style:"currency",currency:"USD",currencySign:"accounting",maximumFractionDigits:0});if(f.formatRange(-3,-5)!=="($3–5)")throw 1;const p=f.formatRangeToParts(-3,5);if(p.map(x=>x.value).join("")!=="($3) – $5")throw 2;if(!p.some(x=>x.type==="literal"&&x.value===")"&&x.source==="startRange")||!p.some(x=>x.type==="literal"&&x.value===" – "&&x.source==="shared"))throw 3;`,
    `const f=new Intl.NumberFormat("en",{style:"unit",unit:"percent",unitDisplay:"long",maximumFractionDigits:0});if(f.formatRange(-3,-1)!=="-3 percent–-1 percent")throw 1;const thin=new Intl.NumberFormat("mk");if(thin.formatRange(-3,-1)!=="-3 – -1")throw 2;`,
  ],
  { nodeReference: false },
);
