import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
interface Text {text:string|number;count:number;}
function conditional(flag:boolean):string{const x=(flag?{text:" a "}:{text:" b "}) satisfies {text:string|number};return x.text.trim();}
function add(a:number,b:number):number{return a+b;}
function effect(state:{n:number}):number{state.n++;return 42;}
export function run():number{
 const item={text:" hi ",count:1} satisfies Text;
 if(item.text.trim()!=="hi"||item.count!==1)return 1;
 if((1+2 satisfies number)*3!==9)return 2;
 if((add satisfies (a:number,b:number)=>number)(20,22)!==42)return 3;
 const state={n:0};if((effect(state) satisfies number)!==42||state.n!==1)return 4;
 const alias=state satisfies {n:number};alias.n=42;if(state.n!==42)return 5;
 const exact=42 satisfies number;const selected:42=exact;if(selected!==42)return 6;
 const callback=((n)=>n+1) satisfies (n:number)=>number;if(callback(41)!==42)return 7;
 const optional:{n:number}|undefined=undefined;
 if((optional?.n satisfies number|undefined)!==undefined)return 8;
 const values=["x"] satisfies readonly (number|string)[];
 values.push("y");if(values[0]?.trim()!=="x"||values.join()!=="x,y")return 9;
 const empty=[] satisfies readonly number[];
 empty.length=3;if(empty.at(0)!==undefined||empty.join()!==",,"||empty.shift()!==undefined||empty.length!==2)return 10;
 const nested={record:{text:" hi "},items:["x"]} satisfies {record:{text:string|number},items:(number|string)[]};
 nested.items.push("y");if(nested.record.text.trim()!=="hi"||nested.items.join()!=="x,y")return 11;
 const deep=[["hi"]] satisfies readonly (readonly (number|string)[])[];
 const first=deep[0];if(first===undefined)return 12;first.push("x");if(first.join()!=="hi,x")return 13;
 if(conditional(true)!=="a"||conditional(false)!=="b")return 14;
 const unknownObject={text:" hi "} satisfies unknown;
 const unknownEmpty=[] satisfies unknown;unknownEmpty.length=1;
 const booleans=[true,false] satisfies unknown;
 if(unknownObject.text.trim()!=="hi"||unknownEmpty.at(0)!==undefined||booleans[0]!==true||booleans[1]!==false)return 15;
 return 42;
}`,
  "satisfies",
);
