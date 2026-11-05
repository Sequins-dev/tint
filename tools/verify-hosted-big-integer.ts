import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {parseInteger,formatInteger,add,subtract,multiply,divide,compare,bitwise,bitwiseNot,shift,power,fromNumber,toNumber,compareNumber,type Integer} from "integer";
function parse(text:string):Integer {
 const value=parseInteger(text,10);if(value===undefined)throw 91;return value;
}
export function run():number {
 const a=parse("1267650600228229401496703205375");
 const b=parse("67108865");
 if(formatInteger(add(a,b),10)!=="1267650600228229401496770314240")return 1;
 const product=multiply(a,b),division=divide(product,b);
 if(division===undefined||compare(division.quotient,a)!==0||formatInteger(division.remainder,10)!=="0")return 2;
 const multi=parse("-18446744073709551617");
 const divided=divide(a,multi);
 if(divided===undefined||formatInteger(divided.quotient,10)!=="-68719476735"||formatInteger(divided.remainder,10)!=="18446744004990074880")return 3;
 if(formatInteger(subtract(a,a),10)!=="0")return 4;
 const hex=parseInteger("-fffffffffffffffffffffffff",16);
 if(hex===undefined||compare(hex,subtract(parse("0"),a))!==0)return 5;
 const binary=formatInteger(a,2);if(binary===undefined||binary.length!==100)return 6;
 if(divide(a,parse("0"))!==undefined)return 7;
 if(formatInteger(bitwiseNot(a),10)!=="-1267650600228229401496703205376")return 8;
 if(formatInteger(bitwise(a,multi,"&"),10)!=="1267650600209782657422993653759")return 9;
 if(formatInteger(bitwise(a,multi,"|"),10)!=="-1")return 10;
 const shifted=shift(parse("-3"),parse("-100000000000000000000000000000000000000"),1);
 if(shifted===undefined||formatInteger(shifted,10)!=="-1")return 11;
 const raised=power(parse("2"),parse("200"),8);
 if(raised===undefined||formatInteger(raised,10)!=="1606938044258990275541962092341162602522202993782792835301376")return 12;
 const shiftedLeft=shift(parse("1"),parse("200"),8);
 if(shiftedLeft===undefined||compare(raised,shiftedLeft)!==0)return 13;
 if(power(parse("2"),parse("100000000000000000000000000000000000000"),8)!==undefined)return 14;
 if(shift(parse("1"),parse("26"),1)!==undefined)return 15;
 const numeric=fromNumber(1267650600228229401496703205376);
 if(numeric===undefined||compare(numeric,add(a,parse("1")))!==0)return 16;
 if(toNumber(parse("9007199254740993"))!==9007199254740992||toNumber(parse("9007199254740995"))!==9007199254740996)return 17;
 const maximum=fromNumber(1.7976931348623157e308);
 if(maximum===undefined||toNumber(maximum)!==1.7976931348623157e308)return 18;
 if(compareNumber(parse("9007199254740993"),9007199254740992)!==1||compareNumber(parse("-1"),-0.5)!==-1)return 19;
 if(fromNumber(0.5)!==undefined||compareNumber(a,NaN)!==undefined)return 20;
 return 42;
}`,
  "big-integer",
  [["integer", "packages/foundation/src/numeric/big-integer.ts"]],
);
