
import {compileRegExp,executeRegExp} from "engine";
import {monotonicMilliseconds as clock} from "clock";
import {openSync,writeSync,closeSync} from "fs";
function emit(phase:string,ms:number,end:number):void {
 const bytes=new TextEncoder().encode(phase+" ms="+ms+" end="+end+"\n");
 const fd=openSync("/Users/stephenbelanger/.t3/worktrees/tint/t3-4d4e597b/.tint-bootstrap/j-cached-regexp-pressure-baseline"+"-"+phase+".txt","wx");
 writeSync(fd,bytes,0,bytes.length,null);closeSync(fd);
}
export function run():number {
 const slash=String.fromCharCode(92);
 const patterns=["^"+slash+"p{gc=Decimal_Number}+$","^"+slash+"P{sc=Greek}+$","^["+slash+"p{gc=Letter}&&"+slash+"p{sc=Greek}]+$","^[["+slash+"p{sc=Greek}]--["+slash+"p{gc=Lowercase_Letter}]]+$","^"+slash+"P{Lowercase_Letter}$","^"+slash+"P{Lowercase_Letter}$","^"+slash+"p{sc=Katakana_Or_Hiragana}$","^"+slash+"P{sc=Katakana_Or_Hiragana}$","^"+slash+"p{RGI_Emoji}$"];
 const flags=["u","u","v","v","iu","iv","u","u","v"];
 const inputs=["09𝟠","Latin!","αβ","ΑΩ","a","a","x","x","👨‍👩‍👧"];
 const expected=[true,true,true,true,true,false,false,true,true];
 for(let i=0;i<patterns.length;i++) {
  const pattern=patterns[i],flag=flags[i],input=inputs[i];
  if(pattern===undefined||flag===undefined||input===undefined)return 1;
  const program=compileRegExp(pattern,flag);if(!program.ok)return 2;
  const result=executeRegExp(program.value,input);
  if(result.kind!==(expected[i]?"match":"no-match"))return 3;
  if(result.kind==="match"&&result.match.end!==input.length)return 4;
 }
 const positive=compileRegExp("^"+slash+"p{General_Category=Decimal_Number}+$","u");
 const negative=compileRegExp("^"+slash+"P{General_Category=Decimal_Number}+$","u");
 if(!positive.ok||!negative.ok)return 5;
 for(let pass=0;pass<2;pass++) {
  const count=pass===0?100000:1000000;
  const digits="0".repeat(count),letters="a".repeat(count);
  let start=clock();const a=executeRegExp(positive.value,digits);
  if(a.kind!=="match"||a.match.end!==count)return 6;
  emit("positive-"+count,clock()-start,a.match.end);
  start=clock();const b=executeRegExp(negative.value,letters);
  if(b.kind!=="match"||b.match.end!==count)return 7;
  emit("negative-"+count,clock()-start,b.match.end);
 }
 return 42;
}