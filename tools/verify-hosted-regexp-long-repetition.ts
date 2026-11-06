import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {compileRegExp,executeRegExp} from "engine";
export function run():number {
 const compiled=compileRegExp("^a+$","");if(!compiled.ok)return 1;
 const result=executeRegExp(compiled.value,"a".repeat(1100000));
 if(result.kind!=="match"||result.match.end!==1100000)return 2;
 const zero=compileRegExp("^a*aa$","");if(!zero.ok||executeRegExp(zero.value,"aa").kind!=="match")return 3;
 const captured=compileRegExp("^(a*)aa$","");if(!captured.ok)return 4;
 const capturedResult=executeRegExp(captured.value,"aaaa");if(capturedResult.kind!=="match")return 5;
 const capture=capturedResult.match.captures[1];if(capture===undefined||capture.start!==0||capture.end!==2)return 6;
 const behind=compileRegExp("(?<=(^😀+))😀x","u");if(!behind.ok)return 7;
 const reverse=executeRegExp(behind.value,"😀😀😀x");if(reverse.kind!=="match"||reverse.match.start!==4||reverse.match.end!==7)return 8;
 const reverseCapture=reverse.match.captures[1];if(reverseCapture===undefined||reverseCapture.start!==0||reverseCapture.end!==4)return 9;
 const slash=String.fromCharCode(92);
 const sets=compileRegExp("["+slash+"p{Letter}--"+slash+"p{ASCII}]+α","v");if(!sets.ok||executeRegExp(sets.value,"ααα").kind!=="match")return 10;
 const modifiers=compileRegExp("(?i:a)+Ab","");if(!modifiers.ok||executeRegExp(modifiers.value,"aAaAb").kind!=="match")return 11;
 return 42;
}`,
  "regexp-long-repetition",
  [["engine", "packages/foundation/src/regexp/engine/index.ts"]],
  [],
  [],
  [],
  { managedBytes: 268435456, allocationCapacity: 8388608 },
);
