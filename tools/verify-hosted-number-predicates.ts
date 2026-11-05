import { verifyHostedFixture } from "./hosted-fixture.ts";
// Deterministic Node oracle for full-width products whose binary64 product loses low bits.
const products: number[] = [];
let seed = 0x91e10da5;
for (let i = 0; i < 256; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const a = seed;
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const b = seed;
  products.push(a, b, Math.imul(a, b));
}
const leadingZeros: number[] = [];
for (let i = 0; i < products.length; i += 3) {
  const value = products[i]!;
  leadingZeros.push(value, Math.clz32(value));
}
for (let bit = 0; bit < 32; bit++) {
  const value = 2 ** bit;
  leadingZeros.push(value, Math.clz32(value), value - 1, Math.clz32(value - 1));
}
const roundInputs = [
  0,
  -0,
  0.49999999999999994,
  0.5,
  0.5000000000000001,
  -0.49999999999999994,
  -0.5,
  -0.5000000000000001,
  1.5,
  -1.5,
  4503599627370495.5,
  -4503599627370495.5,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
];
const roundCases = roundInputs
  .flatMap((x) => [x, Math.round(x)])
  .map((x) => (Object.is(x, -0) ? "-0" : String(x)))
  .join(",");
const sqrtCases = [
  0,
  -0,
  1,
  2,
  4,
  0.25,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  1e-300,
  1e300,
]
  .flatMap((x) => [x, Math.sqrt(x)])
  .map((x) => (Object.is(x, -0) ? "-0" : String(x)))
  .join(",");
const source = `
function shadow(NaN:number,Infinity:number,Number:{EPSILON:number},Math:{PI:number}):number{return NaN+Infinity+Number.EPSILON+Math.PI;}
function word(values:Uint32Array,index:number):number{return values[index]??0;}
function sumWords(x:number,y:number):number{return ((x>>>0)+(y>>>0)+(x>>>0))>>>0;}
function maybeSum(values:Uint32Array,i:number):number{const x=values[i]??(0/0);return (x+x+x)>>>0;}
function wideSum(x:number):number{return (9007199254740991+(x>>>0))>>>0;}
function general(value:unknown):number {
 let result=0;if(Number.isFinite(value))result+=1;if(Number.isInteger(value))result+=2;if(Number.isSafeInteger(value))result+=4;if(Number.isNaN(value))result+=8;return result;
}
function primitive(value:number|string|boolean):number {
 let result=0;if(Number.isFinite(value))result+=1;if(Number.isInteger(value))result+=2;if(Number.isSafeInteger(value))result+=4;if(Number.isNaN(value))result+=8;return result;
}
function guarded(box:{readonly value:number|string|boolean}):boolean {
 return typeof box.value!=="number"||Number.isFinite(box.value);
}
function optional(value:number|undefined):boolean{return Number.isNaN(value);}
function observed(state:{value:number}):undefined{state.value++;return undefined;}
export function run():number {
 const object:{value:number}={value:42};
 if(primitive(42)!==7||primitive(-0)!==7||primitive(0.5)!==1)return 1;
 if(general(42)!==7||general(-0)!==7||general(0.5)!==1)return 2;
 if(primitive("42")!==0||primitive(true)!==0||general("42")!==0||general(true)!==0||general(undefined)!==0||general(object)!==0)return 3;
 if(primitive(0/0)!==8||primitive(1/0)!==0||general(0/0)!==8||general(-1/0)!==0)return 4;
 if(primitive(9007199254740992)!==3||general(9007199254740992)!==3)return 5;
 if(!guarded({value:42})||guarded({value:1/0}))return 6;
 const inputs=[0,0.5,-0,1/0,0/0,4294967295,-2147483648];
 for(let i=0;i<inputs.length;i++){const x=inputs[i]??0;if(!Number.isInteger(x|0)||!Number.isInteger(x>>>0)||!Number.isInteger(~x))return 7;if((~x^x)!==-1||((x>>>0)&255)!==((x|0)&255))return 16;}
 if(!Number.isInteger(42)||Number.isInteger(1.5)||Number.isInteger(1/0)||Number.isInteger(0/0))return 8;
 const nan=inputs[4];if(nan===undefined||nan===nan)return 13;
 if(1/(inputs[2]??1)!==(-1/0))return 14;
 const sparse:number[]=[];sparse[5]=42;if(sparse[0]!==undefined||sparse[5]!==42||sparse[6]!==undefined)return 15;
 const words=new Uint32Array(2);words[0]=4294967295;words[1]=2147483648;
 for(let i=0;i<4;i++){
  const returned=word(words,i);if(!Number.isInteger(returned)||(returned|0)!==(i===0?-1:i===1?-2147483648:0))return 12;
  const x=words[i];if(Number.isInteger(x)!==(i<2))return 9;
  const numeric=x??(0/0);if(Number.isInteger(numeric)!==(i<2))return 10;
  const converted=numeric|0;if(converted!==(i===0?-1:i===1?-2147483648:0))return 11;
 }
 const ints=new Uint32Array(8);
 for(let i=0;i<ints.length;i++)ints[i]=i+1;
 for(let i=0;i<8;i++)if(ints[i]!==i+1)return 17;
 let n=0;for(let i=4294967294;i<4294967295;i++)n++;
 if(n!==1)return 18;
 for(let i=0.5;i<2;i++)if(ints[i]!==undefined)return 19;
 let escape=0;for(;escape<1;escape++){escape=4294967295;}
 if(escape!==4294967296)return 20;
 if(sumWords(4294967295,4294967295)!==4294967293)return 21;
 if(sumWords(-2147483648,1)!==1)return 22;
 if(sumWords(1/0,7)!==7)return 23;
 if(maybeSum(words,0)!==4294967293||maybeSum(words,8)!==0)return 24;
 if(wideSum(4294967295)!==4294967294)return 25;
 if(optional(undefined)||optional(1/0)||optional(0)||!optional(0/0))return 26;
 if(primitive("NaN")!==0||general("NaN")!==0||Number.isNaN(false)||Number.isNaN(true))return 27;
 const calls={value:0};if(Number.isNaN(observed(calls))||calls.value!==1)return 28;
 if(Math.trunc(1.9)!==1||Math.trunc(-1.9)!==-1||1/Math.trunc(-0.5)!==-1/0||1/Math.trunc(0.5)!==1/0)return 29;
 if(Math.trunc(1/0)!==1/0||Math.trunc(-1/0)!==-1/0||!Number.isNaN(Math.trunc(0/0)))return 30;
 if(Math.abs(-42)!==42||Math.abs(42)!==42||1/Math.abs(-0)!==1/0||Math.abs(-1/0)!==1/0||!Number.isNaN(Math.abs(0/0)))return 31;
 if(Math.sign(-42)!==-1||Math.sign(42)!==1||1/Math.sign(-0)!==-1/0||1/Math.sign(0)!==1/0)return 32;
 if(Math.sign(-1/0)!==-1||Math.sign(1/0)!==1||!Number.isNaN(Math.sign(0/0)))return 33;
 let mathCalls=0;function next():number{mathCalls++;return -1.5;}
 if(Math.abs(next())!==1.5||Math.sign(next())!==-1||Math.trunc(next())!==-1||mathCalls!==3)return 34;
 if(Math.imul(4294967295,4294967295)!==1||Math.imul(2147483648,-1)!==-2147483648||Math.imul(-1,-1)!==1)return 35;
 if(Math.imul(1/0,2)!==0||Math.imul(0/0,3)!==0||Math.imul(3.9,-2.9)!==-6||1/Math.imul(-0,5)!==1/0)return 36;
 if(Math.imul(next(),next())!==1||mathCalls!==5)return 37;
 const products=${JSON.stringify(products)};
 for(let i=0;i<products.length;i+=3){if(Math.imul(products[i]??0,products[i+1]??0)!==(products[i+2]??0))return 38;}
 if(Math.clz32(0)!==32||Math.clz32(-0)!==32||Math.clz32(-1)!==0||Math.clz32(4294967296)!==32)return 39;
 if(Math.clz32(0/0)!==32||Math.clz32(1/0)!==32||Math.clz32(-1/0)!==32||Math.clz32(1.9)!==31||Math.clz32(-1.9)!==0)return 40;
 if(Math.clz32(next())!==0||mathCalls!==6)return 41;
 const leadingZeros=${JSON.stringify(leadingZeros)};
 for(let i=0;i<leadingZeros.length;i+=2){if(Math.clz32(leadingZeros[i]??0)!==(leadingZeros[i+1]??0))return 43;}
 if(Math.round(1/0)!==1/0||Math.round(-1/0)!==-1/0||!Number.isNaN(Math.round(0/0)))return 44;
 if(Math.round(next())!==-1||mathCalls!==7)return 45;
 const rounds=[${roundCases}];
 for(let i=0;i<rounds.length;i+=2){const actual=Math.round(rounds[i]??0),expected=rounds[i+1]??0;if(actual!==expected||(actual===0&&1/actual!==1/expected))return 46;}
 if(Math.sqrt(1/0)!==1/0||!Number.isNaN(Math.sqrt(-1/0))||!Number.isNaN(Math.sqrt(-1))||!Number.isNaN(Math.sqrt(0/0)))return 47;
 if(!Number.isNaN(Math.sqrt(next()))||mathCalls!==8)return 48;
 const roots=[${sqrtCases}];
 for(let i=0;i<roots.length;i+=2){const actual=Math.sqrt(roots[i]??0),expected=roots[i+1]??0;if(actual!==expected||(actual===0&&1/actual!==1/expected))return 49;}
 if(!Number.isNaN(NaN)||!Number.isNaN(Number.NaN)||Infinity!==1/0||Number.POSITIVE_INFINITY!==Infinity||Number.NEGATIVE_INFINITY!==-Infinity)return 50;
 if(Number.MAX_SAFE_INTEGER!==9007199254740991||Number.MIN_SAFE_INTEGER!==-9007199254740991||Number.MAX_VALUE!==1.7976931348623157e308||Number.MIN_VALUE!==5e-324||Number.EPSILON!==2.220446049250313e-16)return 51;
 if(Math.PI!==3.141592653589793||Math.E!==2.718281828459045||Math.LN2!==0.6931471805599453||Math.LN10!==2.302585092994046)return 52;
 if(Math.LOG2E!==1.4426950408889634||Math.LOG10E!==0.4342944819032518||Math.SQRT2!==1.4142135623730951||Math.SQRT1_2!==0.7071067811865476)return 53;
 if(shadow(1,2,{EPSILON:3},{PI:4})!==10)return 54;
 return 42;
}`;
verifyHostedFixture(source, "number-predicates");
