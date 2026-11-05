import { verifyHostedFixture } from "./hosted-fixture.ts";
const numbers = [
  0,
  -0,
  0.1,
  1.2345678901234567,
  1e-7,
  1e21,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  NaN,
  Infinity,
  -Infinity,
];
const literals = numbers.map((n) =>
  Number.isNaN(n) ? "NaN" : Object.is(n, -0) ? "-0" : String(n),
);
verifyHostedFixture(
  `
function absent():number[]|undefined{return undefined;}
function separator(state:{n:number},values:number[]):string{state.n++;values.push(42);return "|";}
function source(state:{n:number},values:number[]):number[]{state.n=state.n*10+2;return values;}
export function run():number{
 const numbers=[${literals.join(",")}];
 if(numbers.join("|")!==${JSON.stringify(numbers.join("|"))})return 1;
 if(numbers.join()!==${JSON.stringify(numbers.join())}||numbers.join(undefined)!==${JSON.stringify(numbers.join())})return 2;
 const doubles=new Float64Array(numbers.length);for(let i=0;i<numbers.length;i++){const n=numbers[i];if(n!==undefined)doubles[i]=n;}
 if(doubles.join("|")!==${JSON.stringify(numbers.join("|"))})return 3;
 const bytes=new Uint8Array(2),wide=new Uint16Array(2),words=new Uint32Array(2);
 bytes[0]=255;wide[0]=65535;words[0]=4294967295;
 if(bytes.join()!=="255,0"||wide.join("")!=="655350"||words.join("-")!=="4294967295-0")return 4;
 const empty:number[]=[];if(empty.join()!==""||new Uint8Array(0).join()!=="")return 5;
 const sparse:(number|undefined)[]=[];sparse[3]=undefined;sparse[2]=42;
 if(sparse.join()!==",,42,"||sparse.join("")!=="42")return 6;
 const strings:(string|undefined)[]=[undefined,"","x"];
 if(strings.join()!==",,x")return 7;
 const values=[1,2],state={n:0};
 if(source(state,values).join(separator(state,values))!=="1|2|42"||state.n!==3)return 8;
 state.n=0;if(absent()?.join(separator(state,values))!==undefined||state.n!==0)return 9;
 return 42;
}`,
  "join",
);
