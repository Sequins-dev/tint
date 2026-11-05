import { verifyHostedFixture } from "./hosted-fixture.ts";
const source = `
function unicode():number{const café=10,café=20;const \\u{10400}=12;return café+café+𐐀;}
function receiver(state:{n:number}):string{state.n=state.n*10+1;return "abc";}
function absent():string|undefined{return undefined;}
function position(state:{n:number}):number{state.n=state.n*10+2;return -1;}
export function run():number{
  const state={n:0};
  if(receiver(state).at(position(state))!=="c"||state.n!==12)return 3;
  if("abc".charAt()!=="a"||"abc".at()!=="a")return 4;
  if("abc".charAt(undefined)!=="a"||"abc".at(undefined)!=="a")return 5;
  if("abc".charAt(-1)!==""||"abc".at(-1)!=="c"||"abc".at(-4)!==undefined)return 6;
  if("abc".charAt(3)!==""||"abc".at(3)!==undefined)return 7;
  if("abc".charAt(0/0)!=="a"||"abc".at(0/0)!=="a")return 8;
  if("abc".charAt(1/0)!==""||"abc".at(1/0)!==undefined||"abc".at(-1/0)!==undefined)return 9;
  if("abc".charAt(1.9)!=="b"||"abc".at(-1.9)!=="c"||"abc".charAt(-0.9)!=="a")return 10;
  if("".charAt(0)!==""||"".at(0)!==undefined)return 11;
  if("😀".charAt(0)!==String.fromCharCode(55357)||"😀".at(-1)!==String.fromCharCode(56832))return 12;
  if("😀".codePointAt()!==128512||"😀".codePointAt(1)!==56832)return 13;
  if("abc".codePointAt(-1)!==undefined||"abc".codePointAt(3)!==undefined||"".codePointAt()!==undefined)return 14;
  if("abc".codePointAt(undefined)!==97||"abc".codePointAt(0/0)!==97||"abc".codePointAt(1.9)!==98)return 15;
  if("abc".codePointAt(1/0)!==undefined||"abc".codePointAt(-1/0)!==undefined)return 16;
  const high=String.fromCharCode(55296),low=String.fromCharCode(56320);
  if(high.codePointAt()!==55296||(high+"a").codePointAt()!==55296||low.codePointAt()!==56320)return 17;
  if((high+low).codePointAt()!==65536||String.fromCharCode(56319,57343).codePointAt()!==1114111)return 18;
  if(String.fromCharCode(55295,56320).codePointAt()!==55295||String.fromCharCode(55296,57344).codePointAt()!==55296)return 19;
  if("abcd".substring(3,1)!=="bc"||"abcd".substring(-3,2)!=="ab"||"abcd".substring(9,1)!=="bcd")return 20;
  if("abcd".substring()!=="abcd"||"abcd".substring(undefined,undefined)!=="abcd"||"abcd".substring(1,undefined)!=="bcd")return 21;
  if("abcd".substring(0/0,2.9)!=="ab"||"abcd".substring(1/0,-1/0)!=="abcd"||"abcd".substring(2,0/0)!=="ab")return 22;
  if("😀".substring(1,0)!==String.fromCharCode(55357))return 23;
  const bytes=new Uint8Array(131072);bytes.fill(97);
  bytes[0]=239;bytes[1]=187;bytes[2]=191;
  bytes[131068]=240;bytes[131069]=159;bytes[131070]=152;bytes[131071]=128;
  const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
  if(text.length!==131067||text.slice(0,1)!=="a"||text.slice(-2)!=="😀")return 1;
  const encoded=new TextEncoder().encode(text);
  if(encoded.length!==131069||encoded[0]!==97||encoded[131068]!==128)return 2;
  state.n=0;
  if(receiver(state).substring(position(state),position(state))!==""||state.n!==122)return 24;
  if(!"abc".endsWith("bc",undefined)||"abc".endsWith("bc",0/0))return 25;
  if("abc"[0]!=="a"||"abc"[-0]!=="a"||"abc"[2]!=="c"||"abc"[-1]!==undefined||"abc"[3]!==undefined)return 26;
  if("abc"[0.5]!==undefined||"abc"[0/0]!==undefined||"abc"[1/0]!==undefined||"abc"[-1/0]!==undefined)return 27;
  if("😀"[0]!==String.fromCharCode(55357)||"😀"[1]!==String.fromCharCode(56832)||""[0]!==undefined)return 28;
  state.n=0;if(absent()?.[position(state)]!==undefined||state.n!==0)return 29;
  if(receiver(state)[position(state)]!==undefined||state.n!==12)return 30;
  let joined="",count=0;
  for(const part of "a😀b"){joined+=part;count++;}
  if(joined!=="a😀b"||count!==3)return 31;
  joined="";for(const part of "a😀b!c"){if(part==="😀")continue;if(part==="!")break;joined+=part;}
  if(joined!=="ab")return 32;
  count=0;for(const part of ""){count+=part.length;}if(count!==0)return 33;
  joined="";for(const part of high+"a"+low){joined+=part;count++;}
  if(joined!==high+"a"+low||count!==3)return 34;
  let iterable="abc";joined="";for(const part of iterable){iterable="x";joined+=part;}if(joined!=="abc")return 35;
  let captured:()=>string=()=>"";count=0;
  for(const part of "😀b"){if(count===0)captured=()=>part;count++;}
  if(captured()!=="😀"||count!==2)return 36;
  if(unicode()!==42)return 37;
  return 42;
}`;
verifyHostedFixture(source, "text");
