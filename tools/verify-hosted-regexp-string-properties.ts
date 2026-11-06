import { verifyHostedFixture } from "./hosted-fixture.ts";
verifyHostedFixture(
  `
import {compileRegExp,executeRegExp} from "engine";
export function run():number {
 const slash=String.fromCharCode(92);
 const patterns=["^"+slash+"p{Basic_Emoji}$","^"+slash+"p{Emoji_Keycap_Sequence}$","^"+slash+"p{RGI_Emoji_Modifier_Sequence}$","^"+slash+"p{RGI_Emoji_Flag_Sequence}$","^"+slash+"p{RGI_Emoji_Tag_Sequence}$","^"+slash+"p{RGI_Emoji_ZWJ_Sequence}$","^["+slash+"p{RGI_Emoji}--"+slash+"p{Basic_Emoji}]$","(?<="+slash+"p{RGI_Emoji})x","^"+slash+"p{RGI_Emoji}‍💻$"];
 const inputs=["😀","1️⃣","👍🏽","🇨🇦","🏴\\u{e0067}\\u{e0062}\\u{e0065}\\u{e006e}\\u{e0067}\\u{e007f}","👩‍💻","👩‍💻","👩‍💻x","👩‍💻"];
 for(let i=0;i<patterns.length;i++){
  const pattern=patterns[i],input=inputs[i];if(pattern===undefined||input===undefined)return 1;
  const compiled=compileRegExp(pattern,"v");if(!compiled.ok)return 2;
  if(executeRegExp(compiled.value,input).kind!=="match")return 3;
 }
 return 42;
}`,
  "regexp-string-properties",
  [["engine", "packages/foundation/src/regexp/engine/index.ts"]],
);
