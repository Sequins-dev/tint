import { verifyNativeScriptCases } from "./native-script-fixture.ts";
verifyNativeScriptCases(
  [
    `const f=new Intl.NumberFormat("en",{style:"currency",currency:"usd"});if(f.format("1.005")!=="$1.01"||f.format(9007199254740993n)!=="$9,007,199,254,740,993.00")throw 1;const o=f.resolvedOptions();if(o.currency!=="USD"||o.currencyDisplay!=="symbol"||o.currencySign!=="standard"||o.minimumFractionDigits!==2||o.maximumFractionDigits!==2)throw 2;`,
    `const a=new Intl.NumberFormat("en",{style:"currency",currency:"USD",currencySign:"accounting"});if(a.format(-12)!=="($12.00)"||a.format(-0)!=="($0.00)")throw 1;const p=new Intl.NumberFormat("en",{style:"currency",currency:"USD",currencySign:"accounting",signDisplay:"always"});if(p.format(12)!=="+$12.00")throw 2;const parts=a.formatToParts(-12);if(parts.map(x=>x.value).join("")!==a.format(-12)||parts[1].type!=="currency")throw 3;`,
    `for(const [code,n] of [["JPY",0],["BHD",3],["CLF",4],["ZZZ",2]]){const f=new Intl.NumberFormat("en",{style:"currency",currency:code});if(f.resolvedOptions().maximumFractionDigits!==n)throw 1;}if(new Intl.NumberFormat("en",{style:"currency",currency:"ZZZ"}).format(12)!=="ZZZ 12.00")throw 2;`,
    `const d=new Intl.NumberFormat("de",{style:"currency",currency:"EUR"});if(d.format(-1234.5)!=="-1.234,50 €")throw 1;const narrow=new Intl.NumberFormat("en",{style:"currency",currency:"CAD",currencyDisplay:"narrowSymbol"});if(narrow.format(12)!=="$12.00")throw 2;const code=new Intl.NumberFormat("en",{style:"currency",currency:"USD",currencyDisplay:"code"});if(code.format(12)!=="USD 12.00")throw 3;`,
    `if((12).toLocaleString("en",{style:"currency",currency:"USD"})!=="$12.00"||(12n).toLocaleString("en",{style:"currency",currency:"JPY"})!=="¥12")throw 1;const f=new Intl.NumberFormat("en",{style:"currency",currency:"USD"});const p=f.formatRangeToParts(1,2);if(p.map(x=>x.value).join("")!==f.formatRange(1,2)||p[0].source!=="startRange"||p[p.length-1].source!=="endRange")throw 2;`,
    `let n=0;const c={toString(){n++;return "usd";}},d={toString(){n++;return "code";}};const f=new Intl.NumberFormat("en",{style:"currency",currency:c,currencyDisplay:d});if(n!==2||f.format(12)!=="USD 12.00")throw 1;try{new Intl.NumberFormat("en",{style:"currency",currency:"ßP"});throw 2;}catch(e){if(!(e instanceof RangeError))throw e;}`,
  ],
  { nodeReference: false },
);
