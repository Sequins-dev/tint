import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {compileRegExp,executeRegExp} from "engine";
export function run():number {
 const program=compileRegExp("(a|(b))+","");if(!program.ok)return 1;
 const matched=executeRegExp(program.value,"aba");if(matched.kind!=="match"||matched.match.start!==0||matched.match.end!==3)return 2;
 const last=matched.match.captures[1];if(last===undefined||last.start!==2||last.end!==3||matched.match.captures[2]!==undefined)return 3;
 const behind=compileRegExp("(?<=([ab]+)([bc]+))$","");if(!behind.ok)return 4;
 const reverse=executeRegExp(behind.value,"abc");if(reverse.kind!=="match")return 5;
 const first=reverse.match.captures[1],second=reverse.match.captures[2];if(first===undefined||second===undefined||first.start!==0||first.end!==1||second.start!==1||second.end!==3)return 6;
 const slash=String.fromCharCode(92);
 const named=compileRegExp("(?<x>a)"+slash+"k<x>","");if(!named.ok)return 7;
 const reference=executeRegExp(named.value,"baa");if(reference.kind!=="match"||reference.match.start!==1||reference.match.end!==3)return 8;
 const sets=compileRegExp("[[a-z]--[aeiou]]+","v");if(!sets.ok)return 9;
 const consonants=executeRegExp(sets.value,"abcz");if(consonants.kind!=="match"||consonants.match.start!==1||consonants.match.end!==4)return 10;
 const strings=compileRegExp("["+slash+"q{ab|a|}]b","v");if(!strings.ok)return 11;
 const backtracked=executeRegExp(strings.value,"ab");if(backtracked.kind!=="match"||backtracked.match.end!==2)return 12;
 const sticky=compileRegExp("a+","y");if(!sticky.ok)return 13;
 if(executeRegExp(sticky.value,"baaa").kind!=="no-match"||executeRegExp(sticky.value,"baaa",1).kind!=="match")return 14;
 const bounded=compileRegExp("(a+)+b","");if(!bounded.ok)return 15;
 if(executeRegExp(bounded.value,"aaaaaaaaaaaaaaaa",0,false,100).kind!=="limit")return 16;
 const empty=compileRegExp("(?:){3,5}","");if(!empty.ok||executeRegExp(empty.value,"x").kind!=="match")return 17;
 const unicode=compileRegExp(".","uy");if(!unicode.ok)return 18;
 const pair=executeRegExp(unicode.value,"😀a",1);if(pair.kind!=="match"||pair.match.start!==0||pair.match.end!==2)return 19;
 const foldedPatterns=["[a-z]+","[a-z]","[a-z]","(k)"+slash+"1","(?i:a)(?-i:b)","["+slash+"q{ab|a}]b",slash+"P{ASCII}","[^"+slash+"P{ASCII}]","𐐀"];
 const foldedFlags=["i","iu","i","iu","","vi","vi","vi","iu"];
 const foldedInput=["ABC","K","K","kK","Ab","AB","K","K","𐐨"];
 for(let i=0;i<foldedPatterns.length;i++){
  const pattern=foldedPatterns[i],flags=foldedFlags[i],input=foldedInput[i];
  if(pattern===undefined||flags===undefined||input===undefined)return 20;
  const compiled=compileRegExp(pattern,flags);if(!compiled.ok)return 21;
  const result=executeRegExp(compiled.value,input);
  const expected=i===2||i===6?"no-match":"match";if(result.kind!==expected)return 22;
 }
 const properties=["Script=Han","scx=Hira","sc=Hira","scx=Common","General_Category=Letter","Emoji_Presentation","ID_Start"];
 const propertyInput=["𠮷","ー","ー","ー","中","😀","α"];
 for(let i=0;i<properties.length;i++){
  const property=properties[i],input=propertyInput[i];if(property===undefined||input===undefined)return 23;
  const compiled=compileRegExp(slash+"p{"+property+"}","u");if(!compiled.ok)return 24;
  const expected=i===2||i===3?"no-match":"match";
  if(executeRegExp(compiled.value,input).kind!==expected)return 25;
 }
 const complement=compileRegExp(slash+"P{Lowercase_Letter}","vi");
 if(!complement.ok||executeRegExp(complement.value,"a").kind!=="no-match")return 26;
 return 42;
}`,
  "regexp-engine",
  [["engine", "packages/foundation/src/regexp/engine/index.ts"]],
);
