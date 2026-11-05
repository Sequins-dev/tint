import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
function parameter(x:number):number{var x:number;if(x!==7)return -1;var x:number=8;return x;}
function writeBefore():number{x=3;var x:number;return x;}
function branches(flag:boolean):number{if(flag){var n:number=1;}else{var n:number=2;}return n;}
function optional():number{const read:()=>number=()=>x??0;const before=read();var x:number|undefined=42;var x:number|undefined;return before+read();}
function loop():number{for(var i:number=0;i<3;i++){}var i:number;return i;}
function shared():number{let read:()=>number=()=>-1;for(var i:number|undefined=0;(i??0)<3;i=(i??0)+1){read=()=>i??-1;}return read();}
function inferred():number{var x;var x=42;var x;return x;}
function strictShared():number{let read:()=>number=()=>-1;for(var i=0;i<3;i++){read=()=>i;}return read();}
function iteration():string{let read:()=>string=()=>"";let n=0;for(var text of "ab"){if(n===0)read=()=>text??"";n++;}return read();}
function empty():boolean{for(var value of new Uint32Array(0)){}return value===undefined;}
function discard():number{let count=0;function effect():void{count++;}function fail():number{throw new TypeError("expected");}
 const absent=void effect();if(absent!==undefined||count!==1)return -1;
 if(typeof(void (count++,"text"))!=="undefined"||count!==2)return -2;
 try{void fail();return -3;}catch(error){if(error instanceof TypeError)return count;}return -4;}
function unconditionalFor():number{let n=0;for(;;){n++;if(n===3)return 42;continue;}}
function unconditionalWhile():number{let n=0;while(true){n++;if(n===3)return 42;}}
function unconditionalDo():number{let n=0;do{n++;if(n===3)return 42;}while(true);}
function finalizerReturn():number{for(;;){try{break;}finally{return 42;}}}
export function run():number{
 if(parameter(7)!==8)return 1;
 if(writeBefore()!==3)return 2;
 if(branches(true)!==1||branches(false)!==2)return 3;
 if(optional()!==42)return 4;
 if(loop()!==3)return 5;
 if(shared()!==3)return 6;
 if(iteration()!=="b"||!empty())return 7;
 if(inferred()!==42||strictShared()!==3)return 8;
 if(discard()!==2)return 9;
 if(unconditionalFor()!==42||unconditionalWhile()!==42||unconditionalDo()!==42)return 10;
 if(finalizerReturn()!==42)return 11;
 return 42;
}
`,
  "bindings",
);
