import { verifyHostedFixture } from "./hosted-fixture.ts";

// Derive the oracle and neighboring non-whitespace cases from the host runtime.
const points = new Set<number>([
  0, 0x85, 0x180e, 0x200b, 0x2060, 0xd800, 0xdc00,
]);
for (let code = 0; code <= 0xffff; code++) {
  if (String.fromCharCode(code).trim() === "") {
    points.add(code - 1);
    points.add(code);
    points.add(code + 1);
  }
}
const cases = [
  "",
  "plain",
  "  a b  ",
  "\t\r\n",
  "\ufeff😀\u3000",
  " \ud800 ",
  " \udc00 ",
];
for (const code of points) {
  const unit = String.fromCharCode(code);
  cases.push(unit, unit + "x" + unit, " " + unit + " ");
}
let checks = "";
for (const input of cases) {
  for (const method of ["trim", "trimStart", "trimEnd"] as const) {
    checks += `if(${JSON.stringify(input)}.${method}()!==${JSON.stringify(input[method]())})return 1;\n`;
  }
}
verifyHostedFixture(
  `
function receive(state:{n:number}):string{state.n++;return " a ";}
function absent():string|undefined{return undefined;}
function optional(state:{n:number}):string|undefined{state.n++;return " a ";}
function position(state:{n:number}):number{state.n=state.n*10+2;return 1;}
function nullable(mode:number,state:{n:number}):string|null|undefined{state.n++;if(mode===0)return null;if(mode===1)return undefined;if(mode===2)return "";return " a ";}
function piece(state:{n:number},part:string):string{state.n=state.n*10+2;return part;}
export function run():number{
  ${checks}
  const state={n:0};
  if(receive(state).trim()!=="a"||state.n!==1)return 2;
  state.n=0;
  if(absent()?.substring(position(state)).trim()!==undefined||state.n!==0)return 3;
  if(optional(state)?.substring(position(state)).trim()!=="a"||state.n!==12)return 4;
  if(absent()?.trim().length!==undefined)return 5;
  state.n=0;if(optional(state)?.trim().length!==1||state.n!==1)return 6;
  state.n=0;if(absent()?.startsWith("a",position(state))!==undefined||state.n!==0)return 7;
  if(optional(state)?.charAt(position(state))!=="a"||state.n!==12)return 8;
  if(absent()?.codePointAt()!==undefined)return 9;
  if(optional(state)?.codePointAt(1)!==97)return 10;
  if(absent()?.split(",")?.length!==undefined)return 11;
  if(optional(state)?.split(" ")?.length!==3)return 12;
  if(absent()?.at(0)?.trim()!==undefined)return 13;
  if(optional(state)?.at(0)?.trim()!=="")return 14;
  state.n=0;
  if(nullable(0,state)?.substring(position(state)).trim()!==undefined||state.n!==1)return 15;
  state.n=0;if(nullable(1,state)?.trim()!==undefined||state.n!==1)return 16;
  if(nullable(2,state)?.length!==0||nullable(2,state)?.trim()!=="")return 17;
  state.n=0;if(nullable(3,state)?.substring(position(state)).trim()!=="a"||state.n!==12)return 18;
  if(nullable(0,state)?.length!==undefined)return 19;
  if("abc".concat()!=="abc"||"".concat("a","b","")!=="ab")return 20;
  if("😀".concat(String.fromCharCode(55296),String.fromCharCode(56320))!=="😀𐀀")return 21;
  state.n=0;if(optional(state)?.concat(piece(state,"b"),piece(state,"c"))!==" a bc"||state.n!==122)return 22;
  state.n=0;if(nullable(0,state)?.concat(piece(state,"b"))!==undefined||state.n!==1)return 23;
  return 42;
}`,
  "trim",
);
